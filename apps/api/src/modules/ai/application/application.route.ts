import type { MiddlewareHandler } from 'hono'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { createSuccessResponse } from '@api/shared/response.js'
import {
  createAiApplicationRoute,
  listAiApplicationsRoute,
  revokeAiApplicationRoute,
  rotateAiApplicationRoute,
  updateAiApplicationPolicyRoute,
} from './application.openapi.js'
import type { createAiApplicationService } from './application.service.js'

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>

export function createAiApplicationRouteGroup(deps: {
  service: ReturnType<typeof createAiApplicationService>
  requireAuth: AiRouteMiddleware
  requireManage: AiRouteMiddleware
}) {
  const { service, requireAuth, requireManage } = deps
  const middleware = [requireAuth, requireManage]

  const app = new OpenAPIHono<HonoEnv>()
    .openapi({ ...listAiApplicationsRoute, middleware }, (c) =>
      c.json(createSuccessResponse(service.list(), c.var.requestId), 200),
    )
    .openapi({ ...createAiApplicationRoute, middleware }, (c) =>
      c.json(
        createSuccessResponse(
          service.create(c.req.valid('json'), c.var.currentUserId, c.var.requestId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...rotateAiApplicationRoute, middleware }, (c) =>
      c.json(
        createSuccessResponse(
          service.rotate(c.req.valid('param').appId, c.var.currentUserId, c.var.requestId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...revokeAiApplicationRoute, middleware }, (c) =>
      c.json(
        createSuccessResponse(
          service.revoke(c.req.valid('param').appId, c.var.currentUserId, c.var.requestId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...updateAiApplicationPolicyRoute, middleware }, (c) =>
      c.json(
        createSuccessResponse(
          service.updatePolicy(c.req.valid('param').appId, c.req.valid('json'), c.var.currentUserId, c.var.requestId),
          c.var.requestId,
        ),
        200,
      ),
    )

  return app
}
