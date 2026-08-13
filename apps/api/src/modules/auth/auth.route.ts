import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { account } from "@api/infra/db/schema/index.js";
import {
  apiSuccessResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";
import {
  authConfigSchema,
  currentSessionSchema,
  registerAuthOpenApiComponents,
} from "./auth.openapi.js";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AuthConfig } from "@starter/contracts";
import { createSuccessResponse } from "@api/shared/response.js";
import { createRequireAuth } from "./auth.guard.js";
import { requireSession } from "./auth.service.js";

const authConfigRoute = createRoute({
  method: "get",
  path: "/api/config/auth",
  tags: ["Auth"],
  responses: {
    200: apiSuccessResponse(
      authConfigSchema,
      "可用的登录方式",
      "AuthConfigResponse",
    ),
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  tags: ["Auth"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: apiSuccessResponse(
      currentSessionSchema,
      "当前登录用户和 session",
      "CurrentSessionResponse",
    ),
    401: unauthorizedResponse,
  },
});

export function createAuthRoute(runtime: AppRuntime) {
  const requireAuth = createRequireAuth(runtime.auth);
  const app = new OpenAPIHono<HonoEnv>()
    .openapi(authConfigRoute, (c) => {
      const data: AuthConfig = {
        providers: {
          email: true,
          github: Boolean(
            runtime.env.GITHUB_CLIENT_ID && runtime.env.GITHUB_CLIENT_SECRET,
          ),
          google: Boolean(
            runtime.env.GOOGLE_CLIENT_ID && runtime.env.GOOGLE_CLIENT_SECRET,
          ),
        },
      };
      return c.json(createSuccessResponse(data, c.var.requestId), 200);
    })
    .openapi({ ...meRoute, middleware: requireAuth }, async (c) => {
      const session = await requireSession(runtime.auth, c.req.raw.headers);
      const providers = await runtime.db
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, session.user.id));
      return c.json(
        createSuccessResponse(
          {
            user: {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              emailVerified: session.user.emailVerified,
              image: session.user.image ?? null,
              status:
                session.user.status === "suspended" ? "suspended" : "active",
              createdAt: session.user.createdAt.toISOString(),
              updatedAt: session.user.updatedAt.toISOString(),
            },
            session: session.session,
            providers: providers.map((item) => item.providerId),
          },
          c.var.requestId,
        ),
        200,
      );
    });

  registerAuthOpenApiComponents(app);
  app.on(["GET", "POST"], "/api/auth/*", (c) =>
    runtime.auth.handler(c.req.raw),
  );

  return app;
}

export type { AppAuth } from "./auth.config.js";
export { createRequireAuth } from "./auth.guard.js";
export { getCurrentSession } from "./auth.service.js";
