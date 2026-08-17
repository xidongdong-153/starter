import type { HonoEnv } from "@api/shared/hono-env.js";
import type { MiddlewareHandler } from "hono";
import { ApiErrorCodes } from "@starter/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";

import { AppError } from "@api/shared/app-error.js";
import { createSuccessResponse } from "@api/shared/response.js";

import {
  getAiUsageAuditRoute,
  listAiUsageAuditRoute,
} from "./usage-audit.openapi.js";
import type { createAiUsageAuditService } from "./usage-audit.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;

export function createAiUsageAuditRoute(deps: {
  service: ReturnType<typeof createAiUsageAuditService>;
  requireAuth: AiRouteMiddleware;
  requireUsageRead: AiRouteMiddleware;
}) {
  const { service, requireAuth, requireUsageRead } = deps;

  return new OpenAPIHono<HonoEnv>()
    .openapi(
      {
        ...listAiUsageAuditRoute,
        middleware: [requireAuth, requireUsageRead],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.listModelCalls(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...getAiUsageAuditRoute,
        middleware: [requireAuth, requireUsageRead],
      },
      (c) => {
        const item = service.getModelCall(c.req.valid("param").callId);
        if (!item) {
          throw new AppError(
            ApiErrorCodes.COMMON_NOT_FOUND,
            "未找到这条模型调用记录",
            404,
          );
        }
        return c.json(createSuccessResponse(item, c.var.requestId), 200);
      },
    );
}
