import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AppDatabase } from "@api/infra/db/client.js";
import type { AppLogger } from "@api/infra/log/index.js";
import { profiles } from "@api/infra/db/schema/index.js";
import type { AppEnv } from "@api/shared/env.js";
import { generateId } from "@api/shared/id.js";

type AuthLogLevel = "debug" | "error" | "info" | "warn";

export function createAuth(db: AppDatabase, env: AppEnv, logger: AppLogger) {
  return betterAuth({
    appName: "Starter",
    basePath: "/api/auth",
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    logger: {
      disabled: env.APP_ENV === "test",
      disableColors: true,
      level: env.APP_ENV === "development" ? "debug" : "warn",
      log(level: AuthLogLevel, message: string, ...args: unknown[]) {
        const err = args.find((arg): arg is Error => arg instanceof Error);
        logger[level](
          { ...(err && { err }), event: "better_auth.log" },
          `Better Auth: ${message}`,
        );
      },
    },
    advanced: { database: { generateId } },
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    emailVerification: { sendVerificationEmail: async () => undefined },
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    trustedOrigins: env.corsOrigins,
    databaseHooks: {
      user: {
        create: {
          after: async (newUser) => {
            const now = new Date();
            await db
              .insert(profiles)
              .values({ userId: newUser.id, createdAt: now, updatedAt: now });
          },
        },
      },
    },
  });
}

export type AppAuth = ReturnType<typeof createAuth>;
