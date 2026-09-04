import type { AppRuntime } from '@api/bootstrap/create-runtime.js'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { OpenAPIHono } from '@hono/zod-openapi'

import { createRequireAuth } from '@api/modules/auth/index.js'
import type { AiAgentDefinitionService } from '@api/modules/ai/agent/index.js'
import type { AgentRuntimePort } from '@api/modules/ai/runtime/index.js'
import type { AiAgentSessionService } from '@api/modules/ai/session/index.js'
import { toRuntimeAccessContext } from '@api/modules/ai/principal.js'
import { startRunTransport } from '@api/modules/ai/run/run-transport.js'
import { createSuccessResponse } from '@api/shared/response.js'

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
export interface FlowRouteServices {
  agentDefinitionService: Pick<AiAgentDefinitionService, 'listPublic'>
  sessionService: Pick<AiAgentSessionService, 'create'>
  runtimePort: AgentRuntimePort
}

export function createFlowRoute(runtime: AppRuntime, services: FlowRouteServices) {
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
          await services.runtimePort.transcript(
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
      return startRunTransport(c, services.runtimePort, {
        access: accessContext,
        sessionId: params.sessionId,
        input: c.req.valid('json'),
        requestId: c.var.requestId,
      })
    })
    .openapi({ ...getFlowRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runtimePort.get(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...abortFlowRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runtimePort.abort(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getFlowRunStructuredOutputsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runtimePort.outputs(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
}
