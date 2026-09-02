import type { MiddlewareHandler } from 'hono'
import { OpenAPIHono } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'

import type { HonoEnv } from '@api/shared/hono-env.js'
import { createSuccessResponse } from '@api/shared/response.js'
import { completionResultSchema } from '@starter/contracts'
import { toRuntimeAccessContext } from '@api/modules/ai/principal.js'

import { createCompletionRoute } from './completion.openapi.js'
import type { AiCompletionService } from './completion.service.js'

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>

export function createAiCompletionRoute(deps: { service: AiCompletionService; requireAuth: AiRouteMiddleware }) {
  const { service, requireAuth } = deps
  const access = (c: { var: HonoEnv['Variables'] }) => toRuntimeAccessContext(c.var.principal, c.var.resourceScope)

  return new OpenAPIHono<HonoEnv>().openapi({ ...createCompletionRoute, middleware: requireAuth }, async (c) => {
    const request = c.req.valid('json')
    const requestId = c.var.requestId
    const accessContext = access(c)

    // Accept 分流：显式 application/json 且不含 text/event-stream 走同步 JSON；
    // 缺省、*/* 或仅 text/event-stream 走 SSE，与 Run 启动端点同一判定。
    const accept = c.req.header('accept') ?? ''
    if (accept.includes('application/json') && !accept.includes('text/event-stream')) {
      const result = await service.complete(accessContext, request, requestId, c.req.raw.signal)
      return c.json(createSuccessResponse(completionResultSchema.parse(result), requestId), 200)
    }

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
      let sequence = 0
      try {
        for await (const event of service.stream(accessContext, request, requestId, abortController.signal)) {
          sequence += 1
          await stream.writeSSE({
            id: String(sequence),
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      } catch (error) {
        const event = service.toStreamError(error, requestId)
        if (!stream.aborted) {
          sequence += 1
          await stream.writeSSE({
            id: String(sequence),
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      } finally {
        clearInterval(heartbeat)
        c.req.raw.signal.removeEventListener('abort', abort)
      }
    })
  })
}
