import { z } from "zod";

const encryptionKeySchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string()
    .refine((value) => {
      if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) return false;
      const decoded = Buffer.from(value, "base64");
      return decoded.byteLength === 32 && decoded.toString("base64") === value;
    }, "AI_CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节密钥的 base64 编码")
    .optional(),
);

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_INSTANCE_ID: z.string().default("local"),
  APP_RELEASE: z.string().default("dev"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  LOGS_DIR: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(7788),
  DATABASE_PATH: z.string().default("./data/app.db"),
  AGENT_SESSION_DATABASE_PATH: z.string().default("./data/agent-sessions.db"),
  FILES_DIR: z.string().default("./data/files"),
  AI_ATTACHMENTS_DIR: z.string().default("./data/ai-attachments"),
  AI_CREDENTIAL_ENCRYPTION_KEY: encryptionKeySchema,
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  AI_RUN_MAX_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(120_000),
  AI_PRIVATE_CIDR_ALLOWLIST: z.string().default(""),
  AI_TEST_TOOLS_ENABLED: z.stringbool().default(false),
  AI_WEBHOOK_ENABLED: z.stringbool().default(false),
  AI_WEBHOOK_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(5_000),
  AI_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(10_000),
  AI_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  AI_WEBHOOK_BACKOFF_MS: z.string().default("0,30000,120000,600000,1800000"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().default("http://localhost:7788"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:2333,http://localhost:4399"),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  AUTH_BOOTSTRAP_ADMIN_EMAIL: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === ""
        ? undefined
        : typeof value === "string"
          ? value.trim()
          : value,
    z.email().optional(),
  ),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default(""),
  ADMIN_BASE_URL: z.string().url().default("http://localhost:2333"),
  OPENAPI_ENABLED: z.stringbool().default(true),
});

export type AppEnv = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  aiPrivateCidrs: string[];
  /** AI_WEBHOOK_BACKOFF_MS 解析后的退避序列，至少一项。 */
  aiWebhookBackoffMs: number[];
};

export function parseEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const values = envSchema.parse(input);
  if (values.SMTP_HOST && !values.SMTP_FROM) {
    throw new Error("配置 SMTP_HOST 时必须同时配置 SMTP_FROM");
  }

  const backoffParts = values.AI_WEBHOOK_BACKOFF_MS.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const aiWebhookBackoffMs = backoffParts.map(Number);
  if (
    backoffParts.length === 0 ||
    aiWebhookBackoffMs.some((ms) => !Number.isInteger(ms) || ms < 0)
  ) {
    throw new Error("AI_WEBHOOK_BACKOFF_MS 必须是至少一个非负整数，逗号分隔");
  }

  return {
    ...values,
    corsOrigins: values.CORS_ORIGINS.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    aiPrivateCidrs: values.AI_PRIVATE_CIDR_ALLOWLIST.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    aiWebhookBackoffMs,
  };
}
