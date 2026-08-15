import type { Logger as DrizzleLogger } from "drizzle-orm";
import type { Logger } from "pino";
import type { AppDatabase, DatabaseBundle } from "@api/infra/db/client.js";
import type { Mailer } from "@api/infra/mail/index.js";
import type { StorageDriver } from "@api/infra/storage/index.js";
import type { AiGateway, AiRuntime } from "@api/infra/ai/index.js";
import type { AppAuth } from "@api/modules/auth/auth.config.js";
import {
  createAiCrypto,
  createAiGateway,
  createAiRuntime,
} from "@api/infra/ai/index.js";
import { createDatabase } from "@api/infra/db/client.js";
import { createChildLogger, createLogger } from "@api/infra/log/index.js";
import { createMailer } from "@api/infra/mail/index.js";
import { LocalStorage } from "@api/infra/storage/index.js";
import { createAuth } from "@api/modules/auth/auth.config.js";
import { parseEnv, type AppEnv } from "@api/shared/env.js";

export interface AppRuntime {
  ai: AiRuntime;
  aiGateway: AiGateway;
  auth: AppAuth;
  database: DatabaseBundle;
  db: AppDatabase;
  env: AppEnv;
  logger: Logger;
  storage: StorageDriver;
}

export interface RuntimeDeps {
  /** 测试时替换 mailer，捕获发出的验证/重置邮件 */
  mailer?: Mailer;
  ai?: AiRuntime;
  aiGateway?: AiGateway;
}

export function createRuntime(
  input: NodeJS.ProcessEnv = process.env,
  deps: RuntimeDeps = {},
): AppRuntime {
  const env = parseEnv(input);
  const logger = createLogger({
    appEnv: env.APP_ENV,
    level: env.LOG_LEVEL,
    logsDir: env.LOGS_DIR,
    base: {
      env: env.APP_ENV,
      instance: env.APP_INSTANCE_ID,
      release: env.APP_RELEASE,
      service: "starter-api",
    },
  });
  const database = createDatabase(
    env.DATABASE_PATH,
    createDrizzleLogger(env, logger),
  );
  const storage = new LocalStorage(env.FILES_DIR);
  const ai =
    deps.ai ??
    createAiRuntime(
      database.db,
      createAiCrypto(env.AI_CREDENTIAL_ENCRYPTION_KEY),
    );
  const aiGateway =
    deps.aiGateway ??
    createAiGateway(
      ai.getModelsCollection(),
      env.AI_REQUEST_TIMEOUT_MS,
      ai.getProviderRequestEnv,
    );
  const mailer = deps.mailer ?? createMailer(env, logger);
  const auth = createAuth(
    database.db,
    env,
    createChildLogger(logger, "auth"),
    mailer,
  );

  return {
    ai,
    aiGateway,
    auth,
    database,
    db: database.db,
    env,
    logger,
    storage,
  };
}

/**
 * SQL 日志以 debug 级别输出，生产环境不接。
 * 只记参数个数不记参数值：参数是位置数组，redact.paths 匹配不到下标，
 * 直接打印会把密码哈希、session token 写进日志。
 */
function createDrizzleLogger(
  env: AppEnv,
  logger: Logger,
): DrizzleLogger | undefined {
  if (env.APP_ENV === "production") return undefined;

  const sqlLogger = createChildLogger(logger, "drizzle");
  return {
    logQuery(query, params) {
      sqlLogger.debug({ paramsCount: params.length, query }, "sql");
    },
  };
}
