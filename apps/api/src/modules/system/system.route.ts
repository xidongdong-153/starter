import type { HonoEnv } from "@api/shared/hono-env.js";
import { apiSuccessResponse } from "@api/openapi/responses.js";
import { healthSchema, serviceInfoSchema } from "./system.openapi.js";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createSuccessResponse } from "@api/shared/response.js";

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

export function createSystemRoute() {
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
    );
}
