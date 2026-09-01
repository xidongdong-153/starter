import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";

import type { HonoEnv } from "@api/shared/hono-env.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { toRuntimeAccessContext } from "@api/modules/ai/principal.js";
import { startAgentRunJsonSchema } from "@starter/contracts";

import { writeRunEventStream } from "./run-sse.js";

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
} from "./run.openapi.js";
import type { createAiAgentRunService } from "./run.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;
type AiAgentRunService = ReturnType<typeof createAiAgentRunService>;

export function createAiAgentRunRoute(deps: {
  service: AiAgentRunService;
  requireAuth: AiRouteMiddleware;
  /** Admin 面只读路由的 AI_CONFIG_READ 权限中间件。 */
  requireRead: AiRouteMiddleware;
}) {
  const { service, requireAuth, requireRead } = deps;
  const access = (c: { var: HonoEnv["Variables"] }) =>
    toRuntimeAccessContext(c.var.principal, c.var.resourceScope);

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...startAgentRunRoute, middleware: requireAuth }, async (c) => {
      const params = c.req.valid("param");
      const accessContext = access(c);
      const result = await service.startRun({
        access: accessContext,
        sessionId: params.sessionId,
        input: c.req.valid("json"),
        requestId: c.var.requestId,
      });
      // Accept 分流：显式 application/json 且不含 text/event-stream 返回 JSON 启动模式；
      // 缺省、*/* 或仅 text/event-stream 维持 SSE，向后兼容既有客户端。
      const accept = c.req.header("accept") ?? "";
      if (
        accept.includes("application/json") &&
        !accept.includes("text/event-stream")
      ) {
        return c.json(
          createSuccessResponse(
            startAgentRunJsonSchema.parse({ runId: result.runId }),
            c.var.requestId,
          ),
          200,
        );
      }
      const runId = result.runId;
      const events = service.subscribe(
        accessContext,
        params.sessionId,
        runId,
        0,
      );
      return writeRunEventStream(c, events);
    })
    .openapi(
      { ...getAgentRunEventsStreamRoute, middleware: requireAuth },
      async (c) => {
        const params = c.req.valid("param");
        const query = c.req.valid("query");
        const accessContext = access(c);
        let afterSequence = query.afterSequence;
        const lastEventId = c.req.header("Last-Event-ID");
        if (lastEventId && afterSequence === 0) {
          afterSequence = service.sequenceForEvent(
            accessContext,
            params.sessionId,
            params.runId,
            lastEventId,
          );
        }
        const events = service.subscribe(
          accessContext,
          params.sessionId,
          params.runId,
          afterSequence,
        );
        return writeRunEventStream(c, events);
      },
    )
    .openapi({ ...getAgentRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.get(
            access(c),
            c.req.valid("param").sessionId,
            c.req.valid("param").runId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getActiveAgentRunRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid("param");
      const query = c.req.valid("query");
      return c.json(
        createSuccessResponse(
          service.activeRun(access(c), params.sessionId, query.lane),
          c.var.requestId,
        ),
        200,
      );
    })
    .openapi({ ...getAgentRunTimelineRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid("param");
      const query = c.req.valid("query");
      return c.json(
        createSuccessResponse(
          service.timeline(
            access(c),
            params.sessionId,
            params.runId,
            query.afterSequence,
            query.pageSize,
          ),
          c.var.requestId,
        ),
        200,
      );
    })
    .openapi(
      { ...getAgentRunStructuredOutputsRoute, middleware: requireAuth },
      (c) =>
        c.json(
          createSuccessResponse(
            service.structuredOutputs(
              access(c),
              c.req.valid("param").sessionId,
              c.req.valid("param").runId,
            ),
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
        c.json(
          createSuccessResponse(
            service.adminStructuredOutputs(c.req.valid("param").runId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...getAgentRunEventsRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid("param");
      const query = c.req.valid("query");
      return c.json(
        createSuccessResponse(
          service.timeline(
            access(c),
            params.sessionId,
            params.runId,
            query.afterSequence,
            query.pageSize,
          ),
          c.var.requestId,
        ),
        200,
      );
    })
    .openapi({ ...getAgentRunTraceRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid("param");
      return c.json(
        createSuccessResponse(
          service.trace(access(c), params.sessionId, params.runId),
          c.var.requestId,
        ),
        200,
      );
    })
    .openapi({ ...abortAgentRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.abort(
            access(c),
            c.req.valid("param").sessionId,
            c.req.valid("param").runId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...steerAgentRunRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.steer(
            access(c),
            c.req.valid("param").sessionId,
            c.req.valid("param").runId,
            c.req.valid("json"),
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...followUpAgentRunRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.followUp(
            access(c),
            c.req.valid("param").sessionId,
            c.req.valid("param").runId,
            c.req.valid("json"),
          ),
          c.var.requestId,
        ),
        200,
      ),
    );
}
