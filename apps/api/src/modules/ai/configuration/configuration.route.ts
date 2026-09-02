import type { HonoEnv } from '@api/shared/hono-env.js'
import type { AiTestStreamEvent } from '@starter/contracts'
import type { MiddlewareHandler } from 'hono'
import { OpenAPIHono } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'

import { createSuccessResponse } from '@api/shared/response.js'

import {
  checkAiProviderRoute,
  clearAiProviderCredentialRoute,
  checkCustomAiProviderRoute,
  clearCustomAiProviderCredentialRoute,
  createCustomAiProviderRoute,
  deleteCustomAiProviderRoute,
  getCustomAiProviderRoute,
  listCustomAiProvidersRoute,
  replaceCustomAiProviderModelsRoute,
  updateCustomAiProviderCredentialRoute,
  updateCustomAiProviderRoute,
  updateCustomAiProviderStateRoute,
  getAiPreferenceRoute,
  listAdminAiModelsRoute,
  listAiProvidersRoute,
  listUserAiModelsRoute,
  refreshAiProviderRoute,
  replaceAdminAiModelsRoute,
  testAiModelRoute,
  updateAdminAiDefaultRoute,
  updateAiPreferenceRoute,
  updateAiProviderConfigRoute,
  updateAiProviderStateRoute,
} from './configuration.openapi.js'
import type { createAiService } from './configuration.service.js'

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>

export function createAiConfigurationRoute(deps: {
  service: ReturnType<typeof createAiService>
  requireAuth: AiRouteMiddleware
  requireRead: AiRouteMiddleware
  requireManage: AiRouteMiddleware
}) {
  const { service, requireAuth, requireRead, requireManage } = deps

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...listCustomAiProvidersRoute, middleware: [requireAuth, requireRead] }, async (c) =>
      c.json(createSuccessResponse(await service.listCustomProviders(), c.var.requestId), 200),
    )
    .openapi(
      {
        ...createCustomAiProviderRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.createCustomProvider(c.req.valid('json'), c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...getCustomAiProviderRoute, middleware: [requireAuth, requireRead] }, async (c) =>
      c.json(
        createSuccessResponse(await service.getCustomProvider(c.req.valid('param').providerId), c.var.requestId),
        200,
      ),
    )
    .openapi(
      {
        ...updateCustomAiProviderRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.updateCustomProvider(
              c.req.valid('param').providerId,
              c.req.valid('json'),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...deleteCustomAiProviderRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) => {
        await service.deleteCustomProvider(c.req.valid('param').providerId, c.req.valid('json'), c.var.currentUserId)
        return c.body(null, 204)
      },
    )
    .openapi(
      {
        ...checkCustomAiProviderRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.checkCustomProvider(
              c.req.valid('param').providerId,
              c.req.valid('json'),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateCustomAiProviderCredentialRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.updateCustomCredential(
              c.req.valid('param').providerId,
              c.req.valid('json'),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...clearCustomAiProviderCredentialRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.clearCustomCredential(c.req.valid('param').providerId, c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateCustomAiProviderStateRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.setCustomProviderState(
              c.req.valid('param').providerId,
              c.req.valid('json').enabled,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...replaceCustomAiProviderModelsRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.replaceCustomModels(
              c.req.valid('param').providerId,
              c.req.valid('json'),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listAiProvidersRoute, middleware: [requireAuth, requireRead] }, async (c) =>
      c.json(createSuccessResponse(await service.listProviders(), c.var.requestId), 200),
    )
    .openapi(
      {
        ...updateAiProviderConfigRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.updateProviderConfig(
              c.req.valid('param').providerId,
              c.req.valid('json'),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...clearAiProviderCredentialRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.clearProviderCredential(c.req.valid('param').providerId, c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...checkAiProviderRoute, middleware: [requireAuth, requireManage] }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.checkProvider(c.req.valid('param').providerId, c.var.currentUserId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      {
        ...updateAiProviderStateRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.setProviderState(
              c.req.valid('param').providerId,
              c.req.valid('json').enabled,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...refreshAiProviderRoute, middleware: [requireAuth, requireManage] }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.refreshProviderModels(c.req.valid('param').providerId, c.var.currentUserId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...listAdminAiModelsRoute, middleware: [requireAuth, requireRead] }, async (c) =>
      c.json(createSuccessResponse(await service.listAdminModels(), c.var.requestId), 200),
    )
    .openapi(
      {
        ...replaceAdminAiModelsRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.replaceEnabledModels(c.req.valid('json'), c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateAdminAiDefaultRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.setGlobalDefault(c.req.valid('json').model, c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listUserAiModelsRoute, middleware: requireAuth }, async (c) =>
      c.json(createSuccessResponse(await service.listUserModels(), c.var.requestId), 200),
    )
    .openapi({ ...getAiPreferenceRoute, middleware: requireAuth }, async (c) =>
      c.json(createSuccessResponse(await service.getPreference(c.var.currentUserId), c.var.requestId), 200),
    )
    .openapi({ ...updateAiPreferenceRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.setPreference(c.var.currentUserId, c.req.valid('json').model),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...testAiModelRoute, middleware: requireAuth }, async (c) => {
      const requestId = c.var.requestId
      const prepared = await service.prepareTest(c.var.currentUserId, c.req.valid('json'))
      c.header('Cache-Control', 'no-cache')
      c.header('X-Accel-Buffering', 'no')

      return streamSSE(c, async (stream) => {
        const abortController = new AbortController()
        const abort = () => abortController.abort()
        c.req.raw.signal.addEventListener('abort', abort, { once: true })
        stream.onAbort(abort)
        const heartbeat = setInterval(() => {
          void stream.write(': heartbeat\n\n').catch(abort)
        }, 15_000)
        const startedAt = Date.now()

        try {
          await writeEvent(stream, {
            type: 'start',
            requestId,
            model: prepared.model,
          })
          for await (const event of prepared.stream(requestId, abortController.signal)) {
            await writeEvent(stream, event)
            if (event.type === 'done') {
              c.var.logger.info(
                {
                  event: 'ai.test.completed',
                  providerId: prepared.model.providerId,
                  modelId: prepared.model.modelId,
                  requestId,
                  durationMs: Date.now() - startedAt,
                  stopReason: event.stopReason,
                  inputTokens: event.usage?.inputTokens,
                  outputTokens: event.usage?.outputTokens,
                },
                'AI 模型测试完成',
              )
            }
          }
        } catch (error) {
          const event = service.toStreamError(error, requestId)
          c.var.logger.warn(
            {
              event: 'ai.test.failed',
              providerId: prepared.model.providerId,
              modelId: prepared.model.modelId,
              requestId,
              durationMs: Date.now() - startedAt,
              code: event.type === 'error' ? event.code : undefined,
            },
            'AI 模型测试失败',
          )
          if (!stream.aborted) await writeEvent(stream, event)
        } finally {
          clearInterval(heartbeat)
          c.req.raw.signal.removeEventListener('abort', abort)
        }
      })
    })
}

async function writeEvent(
  stream: {
    writeSSE: (message: { data: string; event?: string }) => Promise<void>
  },
  event: AiTestStreamEvent,
): Promise<void> {
  await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
}
