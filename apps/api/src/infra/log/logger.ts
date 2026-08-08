import { join } from "node:path";
import type { Logger } from "pino";
import pino from "pino";

export type AppLogger = Pick<Logger, "debug" | "error" | "info" | "warn">;

export interface CreateLoggerOptions {
  appEnv: "development" | "test" | "production";
  base?: Record<string, string>;
  level: string;
  logsDir?: string;
  redactPaths?: string[];
}

export const LOGGER_REDACT_PATHS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "clientSecret",
  "headers.authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.secret",
  "*.token",
  "*.clientSecret",
];

export function createLogger(options: CreateLoggerOptions): Logger {
  const {
    appEnv,
    base,
    level,
    logsDir,
    redactPaths = LOGGER_REDACT_PATHS,
  } = options;
  const redact = { censor: "[已隐藏]", paths: redactPaths };
  const pinoBase = base ?? null;
  const fileTarget = logsDir ? buildFileTarget(logsDir, level) : undefined;

  if (appEnv === "test") {
    return pino({ base: pinoBase, enabled: false, level: "silent", redact });
  }

  if (appEnv === "development") {
    const ignore = ["pid", "hostname", ...Object.keys(base ?? {})].join(",");
    const prettyTarget = {
      level,
      options: {
        colorize: true,
        ignore,
        singleLine: true,
        translateTime: "SYS:standard",
      },
      target: "pino-pretty",
    };
    return pino({
      base: pinoBase,
      level,
      redact,
      transport: fileTarget
        ? { targets: [prettyTarget, fileTarget] }
        : { options: prettyTarget.options, target: prettyTarget.target },
    });
  }

  // production 且不写文件：直接输出 JSON 到 stdout，不启 transport worker
  if (!fileTarget) {
    return pino({ base: pinoBase, level, redact });
  }

  return pino({
    base: pinoBase,
    level,
    redact,
    transport: {
      targets: [
        { level, options: { destination: 1 }, target: "pino/file" },
        fileTarget,
      ],
    },
  });
}

/** 创建带 module 标识的子 logger，每条日志自动附带 module 字段 */
export function createChildLogger(parent: Logger, module: string): AppLogger {
  return parent.child({ module });
}

function buildFileTarget(logsDir: string, level: string) {
  return {
    level,
    options: {
      dateFormat: "yyyy-MM-dd",
      file: join(logsDir, "app"),
      frequency: "daily",
      mkdir: true,
    },
    target: "pino-roll",
  };
}
