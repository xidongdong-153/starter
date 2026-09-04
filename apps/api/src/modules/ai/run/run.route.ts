import type { MiddlewareHandler } from 'hono'
import { OpenAPIHono } from '@hono/zod-openapi'

import type { HonoEnv } from '@api/shared/hono-env.js'
import { createSuccessResponse } from '@api/shared/response.js'
import { toRuntimeAccessContext } from '@api/modules/ai/principal.js'
import type { AgentRuntimePort } from '../runtime/agent-runtime.port.js'
import type { AiAgentRunService } from './run.service.js'
import { startRunTransport, resumeRunTransport } from './run-transport.js'

import {
  abortAgentRunRoute,
  followUpAgentRunRoute,
  getActiveAgentRunRoute,
  getAdminRunStructuredOutputsRoute,
  getAgentRunRoute,
  getAgentRunEventsRoute,
  getAgentRunEventsStreamRoute,
  getAgentRunStructuredOutputsRoute,
  getAgentRunTimelineRoute,
  getAgentRunTraceRoute,
  startAgentRunRoute,
  steerAgentRunRoute,
} from './run.openapi.js'

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>
type AiAgentRunReadService = Pick<AiAgentRunService, 'timeline' | 'trace' | 'adminStructuredOutputs'>

export function createAiAgentRunRoute(deps: {
  runtimePort: AgentRuntimePort
  service: AiAgentRunReadService
  requireAuth: AiRouteMiddleware
  /** Admin 面只读路由的 AI_CONFIG_READ 权限中间件。 */
  requireRead: AiRouteMiddleware
}) {
  const { runtimePort, service, requireAuth, requireRead } = deps
  const access = (c: { var: HonoEnv['Variables'] }) => toRuntimeAccessContext(c.var.principal, c.var.resourceScope)

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...startAgentRunRoute, middleware: requireAuth }, async (c) => {
      const params = c.req.valid('param')
      const accessContext = access(c)
      return startRunTransport(c, runtimePort, {
        access: accessContext,
        sessionId: params.sessionId,
        input: c.req.valid('json'),
        requestId: c.var.requestId,
      })
    })
    .openapi({ ...getAgentRunEventsStreamRoute, middleware: requireAuth }, async (c) => {
      const params = c.req.valid('param')
      const query = c.req.valid('query')
      const accessContext = access(c)
      return resumeRunTransport(c, runtimePort, {
        access: accessContext,
        sessionId: params.sessionId,
        runId: params.runId,
        afterSequence: query.afterSequence,
      })
    })
    .openapi({ ...getAgentRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          runtimePort.get(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getActiveAgentRunRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid('param')
      const query = c.req.valid('query')
      return c.json(
        createSuccessResponse(runtimePort.active(access(c), params.sessionId, query.lane), c.var.requestId),
        200,
      )
    })
    .openapi({ ...getAgentRunTimelineRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid('param')
      const query = c.req.valid('query')
      return c.json(
        createSuccessResponse(
          service.timeline(access(c), params.sessionId, params.runId, query.afterSequence, query.pageSize),
          c.var.requestId,
        ),
        200,
      )
    })
    .openapi({ ...getAgentRunStructuredOutputsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          runtimePort.outputs(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      {
        ...getAdminRunStructuredOutputsRoute,
        middleware: [requireAuth, requireRead],
      },
      (c) =>
        c.json(createSuccessResponse(service.adminStructuredOutputs(c.req.valid('param').runId), c.var.requestId), 200),
    )
    .openapi({ ...getAgentRunEventsRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid('param')
      const query = c.req.valid('query')
      return c.json(
        createSuccessResponse(
          service.timeline(access(c), params.sessionId, params.runId, query.afterSequence, query.pageSize),
          c.var.requestId,
        ),
        200,
      )
    })
    .openapi({ ...getAgentRunTraceRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid('param')
      return c.json(
        createSuccessResponse(service.trace(access(c), params.sessionId, params.runId), c.var.requestId),
        200,
      )
    })
    .openapi({ ...abortAgentRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          runtimePort.abort(access(c), c.req.valid('param').sessionId, c.req.valid('param').runId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...steerAgentRunRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await runtimePort.steer(
            access(c),
            c.req.valid('param').sessionId,
            c.req.valid('param').runId,
            c.req.valid('json'),
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...followUpAgentRunRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await runtimePort.followUp(
            access(c),
            c.req.valid('param').sessionId,
            c.req.valid('param').runId,
            c.req.valid('json'),
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
}
