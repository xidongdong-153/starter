import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { AuditActions, RoleKeys } from "@starter/contracts";
import type { AppDatabase } from "@api/infra/db/client.js";
import type { AppLogger } from "@api/infra/log/index.js";
import type { Mailer } from "@api/infra/mail/index.js";
import {
  buildResetPasswordEmail,
  buildVerificationEmail,
} from "./auth.mail.js";
import {
  profiles,
  roles,
  user,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { insertAuditEvent } from "@api/modules/authorization/authorization.audit.js";
import type { AppEnv } from "@api/shared/env.js";
import { generateId } from "@api/shared/id.js";
import { and, eq, isNull } from "drizzle-orm";

type AuthLogLevel = "debug" | "error" | "info" | "warn";

export function createAuth(
  db: AppDatabase,
  env: AppEnv,
  logger: AppLogger,
  mailer: Mailer,
) {
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
    user: {
      additionalFields: {
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ token, user }) => {
        const link = `${env.ADMIN_BASE_URL}/reset-password?token=${token}`;
        const body = buildResetPasswordEmail({ link, name: user.name });
        await mailer.sendMail({ ...body, to: user.email });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ token, user }) => {
        const link = `${env.ADMIN_BASE_URL}/verify-email?token=${token}`;
        const body = buildVerificationEmail({ link, name: user.name });
        await mailer.sendMail({ ...body, to: user.email });
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified: false,
      },
    },
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
      session: {
        create: {
          before: async (newSession) => {
            const target = db
              .select({ status: user.status })
              .from(user)
              .where(eq(user.id, newSession.userId))
              .get();
            if (target?.status === "suspended") {
              return false;
            }
          },
        },
      },
      user: {
        create: {
          after: async (newUser) => {
            const now = new Date();
            db.transaction((tx) => {
              const defaultRole = tx
                .select({ id: roles.id })
                .from(roles)
                .where(
                  and(
                    eq(roles.key, RoleKeys.OPERATOR),
                    isNull(roles.archivedAt),
                  ),
                )
                .get();
              if (!defaultRole) {
                throw new Error(
                  "默认角色 operator 不存在，请先执行数据库 migration",
                );
              }

              tx.insert(profiles)
                .values({ userId: newUser.id, createdAt: now, updatedAt: now })
                .run();
              tx.insert(userRoles)
                .values({
                  userId: newUser.id,
                  roleId: defaultRole.id,
                  assignedAt: now,
                  assignedBy: null,
                })
                .run();

              insertAuditEvent(tx, {
                actorType: "system",
                actorId: "better-auth:user.create",
                action: AuditActions.USER_ROLES_INITIALIZED,
                targetType: "user",
                targetId: newUser.id,
                before: { roleKeys: [] },
                after: { roleKeys: [RoleKeys.OPERATOR] },
                requestId: null,
              });
            });
          },
        },
      },
    },
  });
}

export type AppAuth = ReturnType<typeof createAuth>;
