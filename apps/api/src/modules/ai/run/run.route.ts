import type { MiddlewareHandler } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import type { HonoEnv } from "@api/shared/hono-env.js";
import { createSuccessResponse } from "@api/shared/response.js";

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

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...startAgentRunRoute, middleware: requireAuth }, async (c) => {
      const sessionId = c.req.valid("param").sessionId;
      const result = await service.startRun({
        ownerId: c.var.currentUserId,
        sessionId,
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
          // 连接关闭或写入失败：只停止向该连接写数据，不 abort Run。
        } finally {
          clearInterval(heartbeat);
        }
      });
    })
    .openapi({ ...getAgentRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.get(
            c.var.currentUserId,
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
            c.var.currentUserId,
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
            c.var.currentUserId,
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
            c.var.currentUserId,
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
