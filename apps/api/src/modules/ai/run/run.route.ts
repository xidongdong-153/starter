import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import type { HonoEnv } from "@api/shared/hono-env.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { toRuntimeAccessContext } from "@api/modules/ai/principal.js";

import {
  abortAgentRunRoute,
  followUpAgentRunRoute,
  getAgentRunRoute,
  startAgentRunRoute,
  steerAgentRunRoute,
} from "./run.openapi.js";
import type { createAiAgentRunService } from "./run.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;
type AiAgentRunService = ReturnType<typeof createAiAgentRunService>;

export function createAiAgentRunRoute(deps: {
  service: AiAgentRunService;
  requireAuth: AiRouteMiddleware;
}) {
  const { service, requireAuth } = deps;
  const access = (c: { var: HonoEnv["Variables"] }) =>
    toRuntimeAccessContext(c.var.principal, c.var.resourceScope);

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...startAgentRunRoute, middleware: requireAuth }, async (c) => {
      const result = await service.startRun({
        access: access(c),
        sessionId: c.req.valid("param").sessionId,
        input: c.req.valid("json"),
        requestId: c.var.requestId,
      });
      c.header("Cache-Control", "no-cache");
      c.header("X-Accel-Buffering", "no");
      return streamSSE(c, async (stream) => {
        const heartbeat = setInterval(() => {
          void stream.write(": heartbeat\n\n").catch(() => undefined);
        }, 15_000);
        let resolveAbort!: () => void;
        const aborted = new Promise<void>((resolve) => {
          resolveAbort = resolve;
        });
        stream.onAbort(() => {
          clearInterval(heartbeat);
          resolveAbort();
        });
        try {
          const iterator = result.events[Symbol.asyncIterator]();
          while (true) {
            const next = await Promise.race([
              iterator.next(),
              aborted.then(() => ({ done: true, value: undefined })),
            ]);
            if (next.done) break;
            const value =
              next.value as typeof result.events extends AsyncIterable<infer T>
                ? T
                : never;
            await stream.writeSSE({
              id: value.eventId,
              event: value.type,
              data: JSON.stringify(value),
            });
          }
        } catch {
          // transport 断开只结束当前订阅，不中止 Run。
        } finally {
          clearInterval(heartbeat);
        }
      });
    })
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
    .openapi({ ...steerAgentRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.steer(
            access(c),
            c.req.valid("param").sessionId,
            c.req.valid("param").runId,
            c.req.valid("json").text,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...followUpAgentRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.followUp(
            access(c),
            c.req.valid("param").sessionId,
            c.req.valid("param").runId,
            c.req.valid("json").text,
          ),
          c.var.requestId,
        ),
        200,
      ),
    );
}
