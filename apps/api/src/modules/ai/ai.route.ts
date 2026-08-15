import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import type { AiTestStreamEvent } from "@starter/contracts";
import { PermissionKeys } from "@starter/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import { createRequireAuth } from "@api/modules/auth/index.js";
import { createRequirePermission } from "@api/modules/authorization/index.js";
import { createSuccessResponse } from "@api/shared/response.js";

import {
  checkAiProviderRoute,
  clearAiProviderCredentialRoute,
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
} from "./ai.openapi.js";
import { createAiRepository } from "./ai.repository.js";
import { createAiService } from "./ai.service.js";

export function createAiRoute(runtime: AppRuntime) {
  const requireAuth = createRequireAuth(runtime.auth);
  const requireRead = createRequirePermission(
    runtime.db,
    PermissionKeys.AI_CONFIG_READ,
  );
  const requireManage = createRequirePermission(
    runtime.db,
    PermissionKeys.AI_CONFIG_MANAGE,
  );
  const service = createAiService(
    createAiRepository(runtime.db),
    runtime.ai,
    runtime.aiGateway,
  );

  return new OpenAPIHono<HonoEnv>()
    .openapi(
      { ...listAiProvidersRoute, middleware: [requireAuth, requireRead] },
      async (c) =>
        c.json(
          createSuccessResponse(await service.listProviders(), c.var.requestId),
          200,
        ),
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
              c.req.valid("param").providerId,
              c.req.valid("json"),
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
            await service.clearProviderCredential(
              c.req.valid("param").providerId,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...checkAiProviderRoute, middleware: [requireAuth, requireManage] },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.checkProvider(
              c.req.valid("param").providerId,
              c.var.currentUserId,
            ),
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
              c.req.valid("param").providerId,
              c.req.valid("json").enabled,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...refreshAiProviderRoute, middleware: [requireAuth, requireManage] },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.refreshProviderModels(
              c.req.valid("param").providerId,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...listAdminAiModelsRoute, middleware: [requireAuth, requireRead] },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.listAdminModels(),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...replaceAdminAiModelsRoute,
        middleware: [requireAuth, requireManage],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.replaceEnabledModels(
              c.req.valid("json"),
              c.var.currentUserId,
            ),
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
            await service.setGlobalDefault(
              c.req.valid("json").model,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listUserAiModelsRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(await service.listUserModels(), c.var.requestId),
        200,
      ),
    )
    .openapi({ ...getAiPreferenceRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.getPreference(c.var.currentUserId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(
      { ...updateAiPreferenceRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.setPreference(
              c.var.currentUserId,
              c.req.valid("json").model,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...testAiModelRoute, middleware: requireAuth }, async (c) => {
      const requestId = c.var.requestId;
      const prepared = await service.prepareTest(
        c.var.currentUserId,
        c.req.valid("json"),
      );
      c.header("Cache-Control", "no-cache");
      c.header("X-Accel-Buffering", "no");

      return streamSSE(c, async (stream) => {
        const abortController = new AbortController();
        const abort = () => abortController.abort();
        c.req.raw.signal.addEventListener("abort", abort, { once: true });
        stream.onAbort(abort);
        const heartbeat = setInterval(() => {
          void stream.write(": heartbeat\n\n").catch(abort);
        }, 15_000);
        const startedAt = Date.now();

        try {
          await writeEvent(stream, {
            type: "start",
            requestId,
            model: prepared.model,
          });
          for await (const event of prepared.stream(abortController.signal)) {
            await writeEvent(stream, event);
            if (event.type === "done") {
              c.var.logger.info(
                {
                  event: "ai.test.completed",
                  providerId: prepared.model.providerId,
                  modelId: prepared.model.modelId,
                  requestId,
                  durationMs: Date.now() - startedAt,
                  stopReason: event.stopReason,
                  inputTokens: event.usage?.inputTokens,
                  outputTokens: event.usage?.outputTokens,
                },
                "AI 模型测试完成",
              );
            }
          }
        } catch (error) {
          const event = service.toStreamError(error, requestId);
          c.var.logger.warn(
            {
              event: "ai.test.failed",
              providerId: prepared.model.providerId,
              modelId: prepared.model.modelId,
              requestId,
              durationMs: Date.now() - startedAt,
              code: event.type === "error" ? event.code : undefined,
            },
            "AI 模型测试失败",
          );
          if (!stream.aborted) await writeEvent(stream, event);
        } finally {
          clearInterval(heartbeat);
          c.req.raw.signal.removeEventListener("abort", abort);
        }
      });
    });
}

async function writeEvent(
  stream: {
    writeSSE: (message: { data: string; event?: string }) => Promise<void>;
  },
  event: AiTestStreamEvent,
): Promise<void> {
  await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}
