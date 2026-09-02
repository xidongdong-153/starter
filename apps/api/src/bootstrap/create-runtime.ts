import type { Logger as DrizzleLogger } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { AppDatabase, DatabaseBundle } from '@api/infra/db/client.js'
import type { Mailer } from '@api/infra/mail/index.js'
import type { StorageDriver } from '@api/infra/storage/index.js'
import type { AgentSessionStore } from '@api/infra/agent/pi-session-store.js'
import type { TelemetryContext } from '@earendil-works/pi-telemetry'
import { createAiTelemetryContext } from '@api/infra/telemetry/index.js'
import type { ActiveRunRegistry, PiAgentExecutor } from '@api/infra/agent/index.js'
import { createActiveRunRegistry } from '@api/infra/agent/index.js'
import type { AiGateway, AiRuntime } from '@api/infra/ai/index.js'
import type { AiToolRegistry } from '@api/modules/ai/tool/tool-registry.js'
import { createAiToolRegistry } from '@api/modules/ai/tool/tool-registry.js'
import type { AiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'
import { createAiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'
import { createTestAiTools } from '@api/modules/ai/tool/test-tools.js'
import type { AppAuth } from '@api/modules/auth/auth.config.js'
import type { AiWebhookDispatcher } from '@api/modules/ai/webhook/webhook.dispatcher.js'
import { createAiCrypto, createAiGateway, createAiRuntime } from '@api/infra/ai/index.js'
import { createDatabase } from '@api/infra/db/client.js'
import { createChildLogger, createLogger } from '@api/infra/log/index.js'
import { createMailer } from '@api/infra/mail/index.js'
import { LocalStorage } from '@api/infra/storage/index.js'
import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import { createAuth } from '@api/modules/auth/auth.config.js'
import { parseEnv, type AppEnv } from '@api/shared/env.js'

export interface AppRuntime {
  ai: AiRuntime
  aiGateway: AiGateway
  aiTools: AiToolRegistry
  aiOutputContracts: AiOutputContractRegistry
  /** AI Runtime 的 telemetry 根上下文，已包隔离层。 */
  aiTelemetry: TelemetryContext
  agentSessionStore: AgentSessionStore
  activeRunRegistry: ActiveRunRegistry
  /** Run 模块可注入的 executor；未注入时由 ai.route 层创建。 */
  piAgentExecutor?: PiAgentExecutor
  /** Webhook 投递器；AI_WEBHOOK_ENABLED=true 时由 ai.route 层创建并启动。 */
  webhookDispatcher?: AiWebhookDispatcher
  auth: AppAuth
  database: DatabaseBundle
  db: AppDatabase
  env: AppEnv
  logger: Logger
  storage: StorageDriver
  /** AI 图片附件专用存储，与 FILES_DIR 的通用文件存储分离。 */
  attachmentStorage: StorageDriver
  close: () => Promise<void>
}

export interface RuntimeDeps {
  /** 测试时替换 mailer，捕获发出的验证/重置邮件 */
  mailer?: Mailer
  ai?: AiRuntime
  aiGateway?: AiGateway
  aiTools?: AiToolRegistry
  aiOutputContracts?: AiOutputContractRegistry
  /** 测试时注入 InMemory telemetry context，默认 no-op。 */
  telemetryContext?: TelemetryContext
  agentSessionStore?: AgentSessionStore
  /** 测试时替换 active Run registry，隔离 lane 冲突。 */
  activeRunRegistry?: ActiveRunRegistry
  /** 测试时注入 fake executor，控制模型/工具行为。 */
  piAgentExecutor?: PiAgentExecutor
}

export function createRuntime(input: NodeJS.ProcessEnv = process.env, deps: RuntimeDeps = {}): AppRuntime {
  const env = parseEnv(input)
  const logger = createLogger({
    appEnv: env.APP_ENV,
    level: env.LOG_LEVEL,
    logsDir: env.LOGS_DIR,
    base: {
      env: env.APP_ENV,
      instance: env.APP_INSTANCE_ID,
      release: env.APP_RELEASE,
      service: 'starter-api',
    },
  })
  const database = createDatabase(env.DATABASE_PATH, createDrizzleLogger(env, logger))
  const storage = new LocalStorage(env.FILES_DIR)
  const attachmentStorage = new LocalStorage(env.AI_ATTACHMENTS_DIR)
  const agentSessionStore =
    deps.agentSessionStore ??
    createPiSessionStore({
      databasePath: env.AGENT_SESSION_DATABASE_PATH,
      cwd: process.cwd(),
    })
  const ai =
    deps.ai ??
    createAiRuntime(database.db, createAiCrypto(env.AI_CREDENTIAL_ENCRYPTION_KEY), {
      appEnv: env.APP_ENV,
      allowedPrivateCidrs: env.aiPrivateCidrs,
    })
  const aiGateway =
    deps.aiGateway ?? createAiGateway(ai.getModelsCollection(), env.AI_REQUEST_TIMEOUT_MS, ai.getProviderRequestEnv)
  const mailer = deps.mailer ?? createMailer(env, logger)
  const aiTools = deps.aiTools ?? createAiToolRegistry(env.AI_TEST_TOOLS_ENABLED ? createTestAiTools() : [])
  const aiOutputContracts = deps.aiOutputContracts ?? createAiOutputContractRegistry()
  const aiTelemetry = createAiTelemetryContext(deps.telemetryContext, {
    onFailure: (failure) => createChildLogger(logger, 'ai-telemetry').warn(failure, 'AI telemetry 记录失败，已忽略'),
  })
  const activeRunRegistry = deps.activeRunRegistry ?? createActiveRunRegistry()
  const auth = createAuth(database.db, env, createChildLogger(logger, 'auth'), mailer)

  const runtime: AppRuntime = {
    ai,
    aiGateway,
    aiTools,
    aiOutputContracts,
    aiTelemetry,
    agentSessionStore,
    activeRunRegistry,
    piAgentExecutor: deps.piAgentExecutor,
    auth,
    database,
    db: database.db,
    env,
    logger,
    storage,
    attachmentStorage,
    close,
  }

  // webhookDispatcher 由 ai.route 层在 AI_WEBHOOK_ENABLED=true 时挂到 runtime 上，
  // close 统一停掉它，避免裸 timer 阻止进程退出。
  async function close(): Promise<void> {
    let closeError: unknown
    try {
      runtime.webhookDispatcher?.stop()
    } catch (error) {
      closeError = error
      logger.error({ err: error }, 'AI Webhook 投递器关闭失败')
    }

    try {
      await agentSessionStore.close()
    } catch (error) {
      closeError = error
      logger.error({ err: error }, 'Pi Session 存储关闭失败')
    }

    try {
      database.sqlite.close()
    } catch (error) {
      logger.error({ err: error }, 'Starter SQLite 关闭失败')
      closeError ??= error
    }

    if (closeError) throw closeError
  }

  return runtime
}

/**
 * SQL 日志以 debug 级别输出，生产环境不接。
 * 只记参数个数不记参数值：参数是位置数组，redact.paths 匹配不到下标，
 * 直接打印会把密码哈希、session token 写进日志。
 */
function createDrizzleLogger(env: AppEnv, logger: Logger): DrizzleLogger | undefined {
  if (env.APP_ENV === 'production') return undefined

  const sqlLogger = createChildLogger(logger, 'drizzle')
  return {
    logQuery(query, params) {
      sqlLogger.debug({ paramsCount: params.length, query }, 'sql')
    },
  }
}
