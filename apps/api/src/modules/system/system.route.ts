import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { PermissionKeys } from "@starter/contracts";
import {
  apiSuccessResponse,
  forbiddenResponse,
  invalidRequestResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";
import { createRequireAuth } from "@api/modules/auth/index.js";
import { createRequirePermission } from "@api/modules/authorization/index.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createSystemService } from "./system.service.js";
import {
  healthSchema,
  serviceInfoSchema,
  systemLogsQuerySchema,
  systemLogsResponseSchema,
} from "./system.openapi.js";

const rootRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["System"],
  responses: {
    200: apiSuccessResponse(
      serviceInfoSchema,
      "服务信息",
      "ServiceInfoResponse",
    ),
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  responses: {
    200: apiSuccessResponse(healthSchema, "健康检查结果", "HealthResponse"),
  },
});

const systemLogsRoute = createRoute({
  method: "get",
  path: "/api/system/logs",
  tags: ["System"],
  security: [{ cookieAuth: [] }],
  request: {
    query: systemLogsQuerySchema,
  },
  responses: {
    200: apiSuccessResponse(
      systemLogsResponseSchema,
      "系统日志列表",
      "SystemLogsResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

export function createSystemRoute(runtime: AppRuntime) {
  const requireAuth = createRequireAuth(runtime.auth);
  const requireLogsRead = createRequirePermission(
    runtime.db,
    PermissionKeys.SYSTEM_LOGS_READ,
  );
  const service = createSystemService(runtime.env.LOGS_DIR);
  return new OpenAPIHono<HonoEnv>()
    .openapi(rootRoute, (c) =>
      c.json(
        createSuccessResponse(
          { name: "@starter/api", status: "ok" },
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(healthRoute, (c) =>
      c.json(createSuccessResponse({ ok: true }, c.var.requestId), 200),
    )
    .openapi(
      { ...systemLogsRoute, middleware: [requireAuth, requireLogsRead] },
      async (c) =>
        c.json(
          createSuccessResponse(
            service.queryLogs(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    );
}
