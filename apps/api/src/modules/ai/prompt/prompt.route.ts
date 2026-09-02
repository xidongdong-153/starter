import type { HonoEnv } from '@api/shared/hono-env.js'
import type { MiddlewareHandler } from 'hono'
import { OpenAPIHono } from '@hono/zod-openapi'

import { createSuccessResponse } from '@api/shared/response.js'

import {
  createPromptTemplateRoute,
  createSystemPromptRoute,
  deletePromptTemplateRoute,
  deleteSystemPromptRoute,
  getGlobalSystemPromptRoute,
  listPromptTemplatesRoute,
  listSystemPromptsRoute,
  updateGlobalSystemPromptRoute,
  updatePromptTemplateRoute,
  updateSystemPromptRoute,
} from './prompt.openapi.js'
import type { createAiPromptService } from './prompt.service.js'

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>

export function createAiPromptRoute(deps: {
  service: ReturnType<typeof createAiPromptService>
  requireAuth: AiRouteMiddleware
  requireRead: AiRouteMiddleware
  requireManage: AiRouteMiddleware
}) {
  const { service, requireAuth, requireRead, requireManage } = deps

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...listSystemPromptsRoute, middleware: [requireAuth, requireRead] }, (c) =>
      c.json(createSuccessResponse(service.listSystemPrompts(), c.var.requestId), 200),
    )
    .openapi({ ...createSystemPromptRoute, middleware: [requireAuth, requireManage] }, (c) =>
      c.json(
        createSuccessResponse(service.createSystemPrompt(c.req.valid('json'), c.var.currentUserId), c.var.requestId),
        200,
      ),
    )
    .openapi({ ...updateSystemPromptRoute, middleware: [requireAuth, requireManage] }, (c) =>
      c.json(
        createSuccessResponse(
          service.updateSystemPrompt(c.req.valid('param').id, c.req.valid('json'), c.var.currentUserId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...deleteSystemPromptRoute, middleware: [requireAuth, requireManage] }, (c) =>
      c.json(
        createSuccessResponse(
          {
            deleted: service.deleteSystemPrompt(c.req.valid('param').id),
          },
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      {
        ...getGlobalSystemPromptRoute,
        middleware: [requireAuth, requireRead],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            {
              systemPromptId: service.getGlobalSystemPromptId(),
            },
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateGlobalSystemPromptRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.setGlobalSystemPrompt(c.req.valid('json').systemPromptId, c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listPromptTemplatesRoute, middleware: requireAuth }, (c) =>
      c.json(createSuccessResponse(service.listTemplates(), c.var.requestId), 200),
    )
    .openapi(
      {
        ...createPromptTemplateRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(service.createTemplate(c.req.valid('json'), c.var.currentUserId), c.var.requestId),
          200,
        ),
    )
    .openapi(
      {
        ...updatePromptTemplateRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.updateTemplate(c.req.valid('param').id, c.req.valid('json'), c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...deletePromptTemplateRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            {
              deleted: service.deleteTemplate(c.req.valid('param').id),
            },
            c.var.requestId,
          ),
          200,
        ),
    )
}
