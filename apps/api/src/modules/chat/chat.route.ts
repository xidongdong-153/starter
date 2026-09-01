import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { OpenAPIHono, z } from "@hono/zod-openapi";

import { createRequireAuth } from "@api/modules/auth/index.js";
import type { AiServices } from "@api/modules/ai/index.js";
import { toRuntimeAccessContext } from "@api/modules/ai/principal.js";
import { writeRunEventStream } from "@api/modules/ai/run/run-sse.js";
import { AppError } from "@api/shared/app-error.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { throwValidationError } from "@api/shared/validator.js";
import {
  ApiErrorCodes,
  startAgentRunJsonSchema,
  uuidSchema,
} from "@starter/contracts";

import {
  abortChatRunRoute,
  createChatSessionRoute,
  deleteChatSessionRoute,
  getChatActiveRunRoute,
  getChatRunEventsStreamRoute,
  getChatRunRoute,
  getChatSessionRoute,
  getChatSessionTranscriptRoute,
  listChatAgentsRoute,
  listChatSessionsRoute,
  startChatRunRoute,
  updateChatSessionRoute,
  uploadChatAttachmentRoute,
} from "./chat.openapi.js";

const attachmentParamsSchema = z.object({ attachmentId: uuidSchema });

/**
 * Chat 产品模块路由：/api/chat/* 薄代理。
 *
 * 鉴权走 starter_user cookie 会话，handler 把请求转发给
 * `modules/ai` 的 service 层，行为与对应 /api/ai/* 端点完全等价，
 * 同一份 contracts 契约；产品语义后续迭代再收进来。
 */
export function createChatRoute(runtime: AppRuntime, services: AiServices) {
  const requireAuth = createRequireAuth(runtime.auth);
  const access = (c: { var: HonoEnv["Variables"] }) =>
    toRuntimeAccessContext(c.var.principal, c.var.resourceScope);

  const app = new OpenAPIHono<HonoEnv>()
    .openapi({ ...listChatAgentsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.agentDefinitionService.listPublic(c.req.valid("query")),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...listChatSessionsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.sessionService.list(access(c), c.req.valid("query")),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      { ...createChatSessionRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await services.sessionService.create(
              c.req.valid("json"),
              access(c),
              c.var.requestId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...getChatSessionRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.sessionService.get(
            access(c),
            c.req.valid("param").sessionId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      { ...updateChatSessionRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await services.sessionService.update(
              access(c),
              c.req.valid("param").sessionId,
              c.req.valid("json"),
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...deleteChatSessionRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.sessionService.archive(
            access(c),
            c.req.valid("param").sessionId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      { ...getChatSessionTranscriptRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await services.sessionService.transcript(
              access(c),
              c.req.valid("param").sessionId,
              c.req.valid("query"),
              c.var.requestId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...startChatRunRoute, middleware: requireAuth }, async (c) => {
      const params = c.req.valid("param");
      const accessContext = access(c);
      const result = await services.runService.startRun({
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
      const events = services.runService.subscribe(
        accessContext,
        params.sessionId,
        runId,
        0,
      );
      return writeRunEventStream(c, events);
    })
    .openapi(
      { ...getChatRunEventsStreamRoute, middleware: requireAuth },
      async (c) => {
        const params = c.req.valid("param");
        const query = c.req.valid("query");
        const accessContext = access(c);
        let afterSequence = query.afterSequence;
        const lastEventId = c.req.header("Last-Event-ID");
        if (lastEventId && afterSequence === 0) {
          afterSequence = services.runService.sequenceForEvent(
            accessContext,
            params.sessionId,
            params.runId,
            lastEventId,
          );
        }
        const events = services.runService.subscribe(
          accessContext,
          params.sessionId,
          params.runId,
          afterSequence,
        );
        return writeRunEventStream(c, events);
      },
    )
    .openapi({ ...getChatRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runService.get(
            access(c),
            c.req.valid("param").sessionId,
            c.req.valid("param").runId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getChatActiveRunRoute, middleware: requireAuth }, (c) => {
      const params = c.req.valid("param");
      const query = c.req.valid("query");
      return c.json(
        createSuccessResponse(
          services.runService.activeRun(
            access(c),
            params.sessionId,
            query.lane,
          ),
          c.var.requestId,
        ),
        200,
      );
    })
    .openapi({ ...abortChatRunRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          services.runService.abort(
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
      { ...uploadChatAttachmentRoute, middleware: requireAuth },
      async (c) => {
        const form = c.req.valid("form");
        const file = form.file;
        if (!(file instanceof File)) {
          throw new AppError(
            ApiErrorCodes.COMMON_INVALID_REQUEST,
            "请选择图片",
            400,
          );
        }
        const accessContext = access(c);
        const failedBase = {
          event: "ai.attachment.upload.failed",
          name: file.name,
          size: file.size,
          principalKind: accessContext.principal.kind,
        };
        try {
          const item = await services.attachmentService.upload({
            access: accessContext,
            file,
            sessionId: form.sessionId ?? null,
          });
          c.var.logger.info(
            {
              event: "ai.attachment.upload.succeeded",
              attachmentId: item.id,
              mimeType: item.mimeType,
              size: item.size,
              sessionId: item.sessionId,
            },
            "AI 附件上传成功",
          );
          return c.json(createSuccessResponse(item, c.var.requestId), 201);
        } catch (error) {
          if (error instanceof AppError) {
            c.var.logger.warn(
              { ...failedBase, code: error.code, message: error.message },
              "AI 附件上传失败",
            );
          } else {
            c.var.logger.error(
              { err: error, ...failedBase },
              "AI 附件上传失败",
            );
          }
          throw error;
        }
      },
    );

  // 附件内容是普通 .get()（非 OpenAPI 路由），用语句式注册并丢弃返回值：
  // 链式调用会把 app 的类型降级成 HonoBase，导致 rpc/chat.ts 的
  // schema 提取（extends OpenAPIHono<infer S>）失败。
  app.get(
    "/api/chat/attachments/:attachmentId/content",
    requireAuth,
    zValidator("param", attachmentParamsSchema, (result) => {
      if (!result.success) throwValidationError(result.error);
    }),
    async (c) => {
      const attachmentId = c.req.valid("param").attachmentId;
      try {
        const content = await services.attachmentService.readContent(
          access(c),
          attachmentId,
        );
        return new Response(content.bytes, {
          headers: {
            "Content-Type": content.mimeType,
            "Content-Length": String(content.size),
          },
        });
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND
        ) {
          c.var.logger.warn(
            {
              event: "ai.attachment.download.denied",
              attachmentId,
              principalKind: access(c).principal.kind,
            },
            "AI 附件下载被拒绝",
          );
        }
        throw error;
      }
    },
  );

  return app;
}
