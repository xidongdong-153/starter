import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";

import type { HonoEnv } from "@api/shared/hono-env.js";
import { createSuccessResponse } from "@api/shared/response.js";

import {
  createAdminPipelineRoute,
  getAdminPipelineRoute,
  listAdminPipelinesRoute,
  updateAdminPipelineRoute,
  updateAdminPipelineStatusRoute,
} from "./definition.openapi.js";
import type { AiPipelineDefinitionService } from "./definition.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;

export function createAiPipelineDefinitionRoute(deps: {
  service: AiPipelineDefinitionService;
  requireAuth: AiRouteMiddleware;
  requireRead: AiRouteMiddleware;
  requireManage: AiRouteMiddleware;
}) {
  const { service, requireAuth, requireRead, requireManage } = deps;

  return new OpenAPIHono<HonoEnv>()
    .openapi(
      { ...listAdminPipelinesRoute, middleware: [requireAuth, requireRead] },
      (c) =>
        c.json(
          createSuccessResponse(
            service.listAdmin(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...getAdminPipelineRoute,
        middleware: [requireAuth, requireRead],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.getAdmin(c.req.valid("param").pipelineId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...createAdminPipelineRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.create(c.req.valid("json"), c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateAdminPipelineRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.update(
              c.req.valid("param").pipelineId,
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateAdminPipelineStatusRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.updateStatus(
              c.req.valid("param").pipelineId,
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    );
}
