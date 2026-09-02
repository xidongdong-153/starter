import type { AppRuntime } from '@api/bootstrap/create-runtime.js'
import type { AiModelRef } from '@starter/contracts'

import { createAiAgentDefinitionRepository, createAiAgentDefinitionService } from './agent/index.js'
import { createAuthorizationRepository } from '@api/modules/authorization/index.js'
import { createPiAgentExecutor } from '@api/infra/agent/index.js'
import { createAiApplicationRepository, createAiApplicationService } from './application/index.js'
import {
  createAiAttachmentRepository,
  createAiAttachmentResolver,
  createAiAttachmentService,
} from './attachment/index.js'
import { createAiCompletionService } from './completion/index.js'
import { createAiRepository } from './configuration/configuration.repository.js'
import { createAiCustomProviderRepository } from './configuration/custom-provider.repository.js'
import { createAiService } from './configuration/configuration.service.js'
import { createAiPromptRepository } from './prompt/prompt.repository.js'
import { createAiPromptService } from './prompt/prompt.service.js'
import { createAiSkillRepository } from './skill/skill.repository.js'
import { createAiSkillService } from './skill/skill.service.js'
import { createBuiltinAiToolRegistry } from './tool/tool-catalog.js'
import { createAiStructuredOutputRepository } from './output/structured-output.repository.js'

import { createAiUsageAuditRepository } from './usage-audit/usage-audit.repository.js'
import { createAiInvocationRunner, createAiUsageAuditService } from './usage-audit/usage-audit.service.js'
import { createAiUrlGuard } from '@api/infra/ai/index.js'
import {
  createAiWebhookDispatcher,
  createAiWebhookRepository,
  createAiWebhookService,
  createWebhookCrypto,
} from './webhook/index.js'
import {
  createAiAgentRunRepository,
  createAiRunEventRepository,
  createAiRunResolvedManifestRepository,
  createAiRunTraceRepository,
  createAiRunLifecycleRepository,
  createAiAgentRunService,
} from './run/index.js'
import { createAiAgentSessionRepository, createAiAgentSessionService } from './session/index.js'

/**
 * AI 模块 service 集合。产品模块（chat / flow）经 `modules/ai/index.ts`
 * 进程内调用这些 service，不再绕行 `/api/ai/*` HTTP 面。
 */
export interface AiServices {
  applicationService: ReturnType<typeof createAiApplicationService>
  webhookService: ReturnType<typeof createAiWebhookService>
  usageAuditService: ReturnType<typeof createAiUsageAuditService>
  configurationService: ReturnType<typeof createAiService>
  promptService: ReturnType<typeof createAiPromptService>
  skillService: ReturnType<typeof createAiSkillService>
  agentDefinitionService: ReturnType<typeof createAiAgentDefinitionService>
  sessionService: ReturnType<typeof createAiAgentSessionService>
  runService: ReturnType<typeof createAiAgentRunService>
  /**
   * AI readiness 门禁：Run 恢复扫描完成后 resolve。
   * startRun 在入口 await 它；诊断型 session 一致性检查不阻塞它。
   */
  readiness: Promise<void>
  completionService: ReturnType<typeof createAiCompletionService>
  attachmentService: ReturnType<typeof createAiAttachmentService>
  toolRegistry: ReturnType<typeof createBuiltinAiToolRegistry>
  invocationRunner: ReturnType<typeof createAiInvocationRunner>
}

/**
 * 创建 AI 模块全部 service。启动副作用（webhook dispatcher、
 * session 一致性检查、run 恢复扫描）与 service 实例绑定，
 * 由本函数触发且只触发一次；调用方负责只调用一次。
 */
export function createAiServices(runtime: AppRuntime): AiServices {
  const applicationService = createAiApplicationService({
    repository: createAiApplicationRepository(runtime.db),
    logger: runtime.logger.child({ module: 'ai-application' }),
  })
  const webhookRepository = createAiWebhookRepository(runtime.db)
  const webhookCrypto = createWebhookCrypto(runtime.env.AI_CREDENTIAL_ENCRYPTION_KEY)
  const webhookUrlGuard = createAiUrlGuard({
    appEnv: runtime.env.APP_ENV,
    allowedPrivateCidrs: runtime.env.aiPrivateCidrs,
    timeoutMs: runtime.env.AI_WEBHOOK_TIMEOUT_MS,
  })
  const webhookService = createAiWebhookService({
    repository: webhookRepository,
    applicationRepository: createAiApplicationRepository(runtime.db),
    crypto: webhookCrypto,
    urlGuard: webhookUrlGuard,
    logger: runtime.logger.child({ module: 'ai-webhook' }),
  })
  if (runtime.env.AI_WEBHOOK_ENABLED) {
    const webhookDispatcher = createAiWebhookDispatcher({
      db: runtime.db,
      crypto: webhookCrypto,
      urlGuard: webhookUrlGuard,
      logger: runtime.logger.child({ module: 'ai-webhook' }),
      settings: {
        sweepIntervalMs: runtime.env.AI_WEBHOOK_SWEEP_INTERVAL_MS,
        maxAttempts: runtime.env.AI_WEBHOOK_MAX_ATTEMPTS,
        backoffMs: runtime.env.aiWebhookBackoffMs,
      },
    })
    runtime.webhookDispatcher = webhookDispatcher
    webhookDispatcher.start()
  }
  const usageAuditService = createAiUsageAuditService(
    createAiUsageAuditRepository(runtime.db),
    runtime.logger.child({ module: 'ai-usage-audit' }),
  )
  const invocationRunner = createAiInvocationRunner(runtime.aiGateway, usageAuditService)
  const authorizationRepository = createAuthorizationRepository(runtime.db)
  const skillRepository = createAiSkillRepository(runtime.db)
  const toolRegistry = createBuiltinAiToolRegistry({
    injectedTools: runtime.aiTools.list(),
    skillRepository,
  })
  const outputContractRegistry = runtime.aiOutputContracts
  const structuredOutputRepository = createAiStructuredOutputRepository(runtime.db)
  const configurationService = createAiService(
    createAiRepository(runtime.db),
    runtime.ai,
    runtime.aiGateway,
    invocationRunner,
    runtime.env.AI_REQUEST_TIMEOUT_MS,
    createAiCustomProviderRepository(
      runtime.db,
      runtime.ai.providers.filter((provider) => provider.kind === 'built_in').map((provider) => provider.id),
    ),
  )
  const promptService = createAiPromptService(createAiPromptRepository(runtime.db))
  const skillService = createAiSkillService(skillRepository)
  const agentDefinitionService = createAiAgentDefinitionService({
    repository: createAiAgentDefinitionRepository(runtime.db),
    resolveModel: configurationService.resolveAgentModel,
    promptService,
    skillRepository,
    toolRegistry,
    outputContractRegistry,
  })
  const sessionRepository = createAiAgentSessionRepository(runtime.db)
  const sessionService = createAiAgentSessionService({
    repository: sessionRepository,
    sessionStore: runtime.agentSessionStore,
    logger: runtime.logger.child({ module: 'ai-session' }),
    structuredOutputRepository,
    outputContractRegistry,
  })
  void sessionService
    .checkConsistency()
    .then((report) => {
      const orphanCount = report.missingInPi.length + report.missingInMain.length
      if (orphanCount > 0) {
        runtime.logger.warn(
          {
            missingInPiCount: report.missingInPi.length,
            missingInMainCount: report.missingInMain.length,
          },
          'Agent Session 一致性检查发现孤儿记录',
        )
      }
    })
    .catch((error: unknown) => {
      runtime.logger.error({ err: error }, 'Agent Session 一致性检查失败')
    })
  const runExecutor =
    runtime.piAgentExecutor ??
    createPiAgentExecutor({
      sessionStore: runtime.agentSessionStore,
      models: runtime.ai.getModelsCollection(),
      hasPermission: authorizationRepository.hasPermission,
      getProviderRequestEnv: runtime.ai.getProviderRequestEnv,
      audit: usageAuditService.createAgentModelCallAudit(),
      toolAudit: usageAuditService.createAgentToolExecutionAudit(),
      lifecycle: createAiRunLifecycleRepository(runtime.db),
      logger: runtime.logger.child({ module: 'ai-executor' }),
      requestTimeoutMs: runtime.env.AI_REQUEST_TIMEOUT_MS,
      maxRunMs: runtime.env.AI_RUN_MAX_MS,
    })
  const attachmentRepository = createAiAttachmentRepository(runtime.db)
  const attachmentResolver = createAiAttachmentResolver({
    repository: attachmentRepository,
    storage: runtime.attachmentStorage,
  })
  /** 图片能力统一查 runtime 模型表，不区分内置 / 自定义 Provider；查不到按不支持处理。 */
  function modelSupportsImageInput(model: AiModelRef): boolean {
    return runtime.ai
      .listModels(model.providerId)
      .some((entry) => entry.modelId === model.modelId && entry.capabilities.supportsImageInput)
  }
  // readiness deferred：service 构造需要先拿到 promise，恢复扫描随后触发并 resolve。
  let markReadiness!: () => void
  const readiness = new Promise<void>((resolve) => {
    markReadiness = resolve
  })
  const runService = createAiAgentRunService({
    repository: createAiAgentRunRepository(runtime.db, sessionRepository),
    eventRepository: createAiRunEventRepository(runtime.db),
    traceRepository: createAiRunTraceRepository(runtime.db),
    resolvedManifestRepository: createAiRunResolvedManifestRepository(runtime.db),
    sessionRepository,
    sessionStore: runtime.agentSessionStore,
    agentService: agentDefinitionService,
    registry: runtime.activeRunRegistry,
    executor: runExecutor,
    logger: runtime.logger.child({ module: 'ai-run' }),
    telemetry: runtime.aiTelemetry,
    structuredOutputRepository,
    outputContractRegistry,
    resolveAttachments: attachmentResolver.resolveForRequest,
    supportsImageInput: modelSupportsImageInput,
    laneLeaseStore: runtime.laneLeaseStore,
    instanceId: runtime.env.APP_INSTANCE_ID,
    readiness,
  })
  const completionService = createAiCompletionService({
    invocationRunner,
    requireAllowedModel: configurationService.resolveAgentModel,
    resolveAttachments: attachmentResolver.resolveForRequest,
    supportsImageInput: modelSupportsImageInput,
    requestTimeoutMs: runtime.env.AI_REQUEST_TIMEOUT_MS,
    logger: runtime.logger.child({ module: 'ai-completion' }),
  })
  const attachmentService = createAiAttachmentService({
    storage: runtime.attachmentStorage,
    repository: attachmentRepository,
    sessionRepository,
  })
  void runService
    .recoverInterrupted()
    .then((report) => {
      if (report.scanned > 0) {
        runtime.logger.info({ report }, 'Agent Run 启动恢复扫描完成')
      }
    })
    .catch((error: unknown) => {
      runtime.logger.error({ err: error }, 'Agent Run 启动恢复扫描失败')
    })
    .finally(() => markReadiness())

  return {
    applicationService,
    webhookService,
    usageAuditService,
    configurationService,
    promptService,
    skillService,
    agentDefinitionService,
    sessionService,
    runService,
    readiness,
    completionService,
    attachmentService,
    toolRegistry,
    invocationRunner,
  }
}
