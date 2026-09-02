import type { AppRuntime } from '@api/bootstrap/create-runtime.js'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { OpenAPIHono } from '@hono/zod-openapi'

import { createRequireAuth } from '@api/modules/auth/index.js'
import type { AiServices } from '@api/modules/ai/index.js'
import { toRuntimeAccessContext } from '@api/modules/ai/principal.js'
import { writeRunEventStream } from '@api/modules/ai/run/run-sse.js'
import { createSuccessResponse } from '@api/shared/response.js'
import { startAgentRunJsonSchema } from '@starter/contracts'

import {
  abortFlowRunRoute,
  createFlowSessionRoute,
  getFlowRunRoute,
  getFlowRunStructuredOutputsRoute,
  getFlowSessionTranscriptRoute,
  listFlowAgentsRoute,
  startFlowRunRoute,
} from './flow.openapi.js'

/**
 * Flow 产品模块路由：/api/flow/* 薄代理。
 *
 * 鉴权走 starter_user cookie 会话，handler 把请求转发给
 * `modules/ai` 的 service 层，行为与对应 /api/ai/* 端点完全等价，
 * 同一份 contracts 契约；产品语义后续迭代再收进来。
 */
export function createFlowRoute(runtime: AppRuntime, services: AiServices) {
  const requireAuth = createRequireAuth(runtime.auth)
  const access = (c: { var: HonoEnv['Variables'] }) => toRuntimeAccessContext(c.var.principal, c.var.resourceScope)

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...listFlowAgentsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(services.agentDefinitionService.listPublic(c.req.valid('query')), c.var.requestId),
        200,
      ),
    )
    .openapi({ ...createFlowSessionRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await services.sessionService.create(c.req.valid('json'), access(c), c.var.requestId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getFlowSessionTranscriptRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await services.sessionService.transcript(
            access(c),
            c.req.valid('param').sessionId,
            c.req.valid('query'),
            c.var.requestId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...startFlowRunRoute, middleware: requireAuth }, async (c) => {
      const params = c.req.valid('param')
      const accessContext = access(c)
      const result = await services.runService.startRun({
        access: accessContext,
        sessionId: params.sessionId,
        input: c.req.valid('json'),
        requestId: c.var.requestId,
      })
      // Accept 分流：显式 application/json 且不含 text/event-stream 返回 JSON 启动模式；
      // 缺省、*/* 或仅 text/event-stream 维持 SSE，向后兼容既有客户端。
      const accept = c.req.header('accept') ?? ''
      if (accept.includes('application/json') && !accept.includes('text/event-stream')) {
        return c.json(
          createSuccessResponse(startAgentRunJsonSchema.parse({ runId: result.runId }), c.var.requestId),
          200,
        )
      }
      const runId = result.runId
      const events = services.runService.subscribe(accessContext, params.sessionId, runId, 0)
      return writeRunEventStream(c, events)
    })
    .openapi({ ...getFlowRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runService.get(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...abortFlowRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runService.abort(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getFlowRunStructuredOutputsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runService.structuredOutputs(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
}
