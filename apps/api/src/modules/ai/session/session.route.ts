import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";

import type { HonoEnv } from "@api/shared/hono-env.js";
import { createSuccessResponse } from "@api/shared/response.js";

import {
  createAgentSessionRoute,
  deleteAgentSessionRoute,
  getAgentSessionRoute,
  getAgentSessionTranscriptRoute,
  listAgentSessionsRoute,
  updateAgentSessionRoute,
} from "./session.openapi.js";
import type { createAiAgentSessionService } from "./session.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;
type AiAgentSessionService = ReturnType<typeof createAiAgentSessionService>;

export function createAiAgentSessionRoute(deps: {
  service: AiAgentSessionService;
  requireAuth: AiRouteMiddleware;
}) {
  const { service, requireAuth } = deps;

  return new OpenAPIHono<HonoEnv>()
    .openapi(
      { ...createAgentSessionRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.create(
              c.req.valid("json"),
              c.var.currentUserId,
              c.var.requestId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listAgentSessionsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.list(c.var.currentUserId, c.req.valid("query")),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getAgentSessionRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.get(c.var.currentUserId, c.req.valid("param").sessionId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      { ...updateAgentSessionRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.update(
              c.var.currentUserId,
              c.req.valid("param").sessionId,
              c.req.valid("json"),
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...deleteAgentSessionRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.archive(c.var.currentUserId, c.req.valid("param").sessionId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      { ...getAgentSessionTranscriptRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.transcript(
              c.var.currentUserId,
              c.req.valid("param").sessionId,
              c.req.valid("query"),
              c.var.requestId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    );
}
