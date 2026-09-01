import type { HonoEnv } from "@api/shared/hono-env.js";
import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";

import { createSuccessResponse } from "@api/shared/response.js";

import {
  createAdminAgentDefinitionRoute,
  getAdminAgentDefinitionRoute,
  getPublicAgentDefinitionRoute,
  listAdminAgentDefinitionsRoute,
  listAdminAiToolsRoute,
  listPublicAgentDefinitionsRoute,
  listPublicAiToolsRoute,
  updateAdminAgentDefinitionRoute,
  updateAdminAgentDefinitionStatusRoute,
} from "./agent.openapi.js";
import type { createAiAgentDefinitionService } from "./agent.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;

export function createAiAgentDefinitionRoute(deps: {
  service: ReturnType<typeof createAiAgentDefinitionService>;
  requireAuth: AiRouteMiddleware;
  requireRuntime: AiRouteMiddleware;
  requireRead: AiRouteMiddleware;
  requireManage: AiRouteMiddleware;
}) {
  const { service, requireAuth, requireRuntime, requireRead, requireManage } =
    deps;

  return new OpenAPIHono<HonoEnv>()
    .openapi(
      { ...listPublicAgentDefinitionsRoute, middleware: requireRuntime },
      (c) =>
        c.json(
          createSuccessResponse(
            service.listPublic(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...getPublicAgentDefinitionRoute, middleware: requireRuntime },
      (c) =>
        c.json(
          createSuccessResponse(
            service.getPublic(c.req.valid("param").agentId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...listAdminAgentDefinitionsRoute,
        middleware: [requireAuth, requireRead],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.listAdmin(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listPublicAiToolsRoute, middleware: [requireAuth] }, (c) =>
      c.json(createSuccessResponse(service.listTools(), c.var.requestId), 200),
    )
    .openapi(
      { ...listAdminAiToolsRoute, middleware: [requireAuth, requireRead] },
      (c) =>
        c.json(
          createSuccessResponse(service.listTools(), c.var.requestId),
          200,
        ),
    )
    .openapi(
      {
        ...getAdminAgentDefinitionRoute,
        middleware: [requireAuth, requireRead],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.getAdmin(c.req.valid("param").agentId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...createAdminAgentDefinitionRoute,
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
        ...updateAdminAgentDefinitionRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.update(
              c.req.valid("param").agentId,
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
        ...updateAdminAgentDefinitionStatusRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.updateStatus(
              c.req.valid("param").agentId,
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    );
}
