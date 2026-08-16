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
  FILES_DIR: z.string().default("./data/files"),
  AI_CREDENTIAL_ENCRYPTION_KEY: encryptionKeySchema,
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(60_000),
  AI_TEST_TOOLS_ENABLED: z.stringbool().default(false),
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

export type AppEnv = z.infer<typeof envSchema> & { corsOrigins: string[] };

export function parseEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const values = envSchema.parse(input);
  if (values.SMTP_HOST && !values.SMTP_FROM) {
    throw new Error("配置 SMTP_HOST 时必须同时配置 SMTP_FROM");
  }

  return {
    ...values,
    corsOrigins: values.CORS_ORIGINS.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}
