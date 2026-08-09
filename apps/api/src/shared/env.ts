import { z } from "zod";

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
  OPENAPI_ENABLED: z.stringbool().default(true),
});

export type AppEnv = z.infer<typeof envSchema> & { corsOrigins: string[] };

export function parseEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const values = envSchema.parse(input);
  return {
    ...values,
    corsOrigins: values.CORS_ORIGINS.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}
