import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { createSuccessResponse } from "@api/shared/response.js";
import type { createAiWebhookService } from "./webhook.service.js";
import {
  createAiWebhookEndpointRoute,
  deleteAiWebhookEndpointRoute,
  listAiWebhookDeliveriesRoute,
  listAiWebhookEndpointsRoute,
  rotateAiWebhookEndpointRoute,
  testAiWebhookEndpointRoute,
  updateAiWebhookEndpointRoute,
} from "./webhook.openapi.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;

export function createAiWebhookRouteGroup(deps: {
  service: ReturnType<typeof createAiWebhookService>;
  requireAuth: AiRouteMiddleware;
  requireRead: AiRouteMiddleware;
  requireManage: AiRouteMiddleware;
}) {
  const { service, requireAuth, requireRead, requireManage } = deps;
  const manageMiddleware = [requireAuth, requireManage];
  const readMiddleware = [requireAuth, requireRead];

  return new OpenAPIHono<HonoEnv>()
    .openapi(
      { ...listAiWebhookEndpointsRoute, middleware: readMiddleware },
      (c) =>
        c.json(
          createSuccessResponse(
            service.listEndpoints(c.req.valid("query").appId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...createAiWebhookEndpointRoute, middleware: manageMiddleware },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.createEndpoint(
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...updateAiWebhookEndpointRoute, middleware: manageMiddleware },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.updateEndpoint(
              c.req.valid("param").endpointId,
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...rotateAiWebhookEndpointRoute, middleware: manageMiddleware },
      (c) =>
        c.json(
          createSuccessResponse(
            service.rotateEndpoint(
              c.req.valid("param").endpointId,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...deleteAiWebhookEndpointRoute, middleware: manageMiddleware },
      (c) =>
        c.json(
          createSuccessResponse(
            service.deleteEndpoint(c.req.valid("param").endpointId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...testAiWebhookEndpointRoute, middleware: manageMiddleware },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.testEndpoint(c.req.valid("param").endpointId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...listAiWebhookDeliveriesRoute, middleware: readMiddleware },
      (c) =>
        c.json(
          createSuccessResponse(
            service.listDeliveries(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    );
}
