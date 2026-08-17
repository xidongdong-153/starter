import type { HonoEnv } from "@api/shared/hono-env.js";
import type { AiConversationStreamEvent } from "@starter/contracts";
import type { Context, MiddlewareHandler } from "hono";
import { ApiErrorCodes } from "@starter/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import { createSuccessResponse } from "@api/shared/response.js";

import {
  createAiConversationRoute as createConversationOperation,
  deleteAiConversationRoute,
  getAiConversationRoute,
  listAiConversationsRoute,
  retryAiConversationRoute,
  sendAiConversationMessageRoute,
  stopAiConversationGenerationRoute,
} from "./conversation.openapi.js";
import type { createAiConversationService } from "./conversation.service.js";

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>;
type AiConversationService = ReturnType<typeof createAiConversationService>;
type PreparedConversation = Awaited<
  ReturnType<AiConversationService["prepareSend"]>
>;

export function createAiConversationRoute(deps: {
  service: AiConversationService;
  requireAuth: AiRouteMiddleware;
}) {
  const { service, requireAuth } = deps;

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...createConversationOperation, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.createConversation(c.var.currentUserId, c.req.valid("json")),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...listAiConversationsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.listConversations(c.var.currentUserId, c.req.valid("query")),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getAiConversationRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.getConversation(
            c.req.valid("param").conversationId,
            c.var.currentUserId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...deleteAiConversationRoute, middleware: requireAuth }, (c) => {
      service.deleteConversation(
        c.req.valid("param").conversationId,
        c.var.currentUserId,
      );

      return c.json(
        createSuccessResponse({ deleted: true as const }, c.var.requestId),
        200,
      );
    })
    .openapi(
      { ...sendAiConversationMessageRoute, middleware: requireAuth },
      async (c) => {
        const prepared = await service.prepareSend(
          c.req.valid("param").conversationId,
          c.var.currentUserId,
          c.req.valid("json"),
        );
        return streamConversation(c, service, prepared, c.var.requestId);
      },
    )
    .openapi(
      { ...retryAiConversationRoute, middleware: requireAuth },
      async (c) => {
        const prepared = await service.prepareRetry(
          c.req.valid("param").conversationId,
          c.var.currentUserId,
          c.req.valid("json"),
        );
        return streamConversation(c, service, prepared, c.var.requestId);
      },
    )
    .openapi(
      { ...stopAiConversationGenerationRoute, middleware: requireAuth },
      (c) => {
        const params = c.req.valid("param");
        const result = service.stopGeneration(
          params.conversationId,
          params.generationId,
          c.var.currentUserId,
        );
        return c.json(
          createSuccessResponse(result.generation, c.var.requestId),
          result.statusCode,
        );
      },
    );
}

function streamConversation(
  c: Context<HonoEnv>,
  service: AiConversationService,
  prepared: PreparedConversation,
  requestId: string,
) {
  c.header("Cache-Control", "no-cache");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const abortController = new AbortController();
    const abort = () => {
      abortController.abort();
      service.abortPrepared(prepared);
    };
    c.req.raw.signal.addEventListener("abort", abort, { once: true });
    stream.onAbort(abort);
    const heartbeat = setInterval(() => {
      void stream.write(": heartbeat\n\n").catch(abort);
    }, 15_000);

    try {
      await writeConversationEvent(stream, {
        type: "start",
        requestId,
        conversationId: prepared.conversationId,
        generationId: prepared.generationId,
        assistantMessageId: prepared.assistantMessageId,
        model: prepared.model,
      });
      for await (const event of service.streamGeneration(
        prepared,
        requestId,
        abortController.signal,
      )) {
        await writeConversationEvent(stream, event);
      }
    } catch {
      service.abortPrepared(prepared);
      if (!stream.aborted) {
        await writeConversationEvent(stream, {
          type: "error",
          code: ApiErrorCodes.AI_REQUEST_ABORTED,
          message: "生成已停止",
          retryable: true,
          requestId,
        });
      }
    } finally {
      clearInterval(heartbeat);
      c.req.raw.signal.removeEventListener("abort", abort);
      service.abortPrepared(prepared);
    }
  });
}

async function writeConversationEvent(
  stream: {
    writeSSE: (message: { data: string; event?: string }) => Promise<void>;
  },
  event: AiConversationStreamEvent,
): Promise<void> {
  await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}
