import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import type { Context } from "hono";
import type {
  AiConversationStreamEvent,
  AiTestStreamEvent,
} from "@starter/contracts";
import { ApiErrorCodes, PermissionKeys } from "@starter/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

import { createRequireAuth } from "@api/modules/auth/index.js";
import {
  createAuthorizationRepository,
  createRequirePermission,
} from "@api/modules/authorization/index.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { AppError } from "@api/shared/app-error.js";

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
import {
  createAiConversationRoute,
  deleteAiConversationRoute,
  getAiConversationRoute,
  listAiConversationsRoute,
  retryAiConversationRoute,
  sendAiConversationMessageRoute,
  stopAiConversationGenerationRoute,
} from "./ai-conversation.openapi.js";
import {
  createPromptTemplateRoute,
  createSystemPromptRoute,
  deletePromptTemplateRoute,
  deleteSystemPromptRoute,
  getGlobalSystemPromptRoute,
  listPromptTemplatesRoute,
  listSystemPromptsRoute,
  updateGlobalSystemPromptRoute,
  updatePromptTemplateRoute,
  updateSystemPromptRoute,
} from "./ai-prompt.openapi.js";
import { createAiPromptRepository } from "./ai-prompt.repository.js";
import { createAiPromptService } from "./ai-prompt.service.js";
import {
  createAiSkillRoute,
  deleteAiSkillRoute,
  getAiSkillRoute,
  listAiSkillsRoute,
  updateAiSkillRoute,
} from "./ai-skill.openapi.js";
import { createAiSkillRepository } from "./ai-skill.repository.js";
import { createAiSkillService } from "./ai-skill.service.js";
import { createReadSkillTool } from "./ai-skill-tools.js";
import {
  getAiUsageAuditRoute,
  listAiUsageAuditRoute,
} from "./ai-usage-audit.openapi.js";
import { createAiToolOrchestrator } from "./ai-tool-orchestrator.js";
import { createAiToolRegistry } from "./ai-tool-registry.js";
import { createAiUsageAuditRepository } from "./ai-usage-audit.repository.js";
import {
  createAiInvocationRunner,
  createAiUsageAuditService,
} from "./ai-usage-audit.service.js";
import { createAiConversationRepository } from "./ai-conversation.repository.js";
import { createAiConversationService } from "./ai-conversation.service.js";
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
  const requireUsageRead = createRequirePermission(
    runtime.db,
    PermissionKeys.AI_USAGE_READ,
  );
  const usageAuditService = createAiUsageAuditService(
    createAiUsageAuditRepository(runtime.db),
    runtime.logger.child({ module: "ai-usage-audit" }),
  );
  const invocationRunner = createAiInvocationRunner(
    runtime.aiGateway,
    usageAuditService,
  );
  const authorizationRepository = createAuthorizationRepository(runtime.db);
  const skillRepository = createAiSkillRepository(runtime.db);
  const toolOrchestrator = createAiToolOrchestrator({
    invocationRunner,
    registry: createAiToolRegistry([
      ...runtime.aiTools.list(),
      createReadSkillTool(skillRepository),
    ]),
    audit: usageAuditService,
    hasPermission: authorizationRepository.hasPermission,
    logger: runtime.logger.child({ module: "ai-tool-orchestrator" }),
  });
  const service = createAiService(
    createAiRepository(runtime.db),
    runtime.ai,
    runtime.aiGateway,
    invocationRunner,
    runtime.env.AI_REQUEST_TIMEOUT_MS,
  );
  const promptService = createAiPromptService(
    createAiPromptRepository(runtime.db),
  );
  const skillService = createAiSkillService(skillRepository);
  const conversationService = createAiConversationService(
    createAiConversationRepository(runtime.db),
    runtime.aiGateway,
    {
      isAllowed: service.isConversationModelAllowed,
      resolve: service.resolveConversationModel,
    },
    invocationRunner,
    runtime.env.AI_REQUEST_TIMEOUT_MS,
    toolOrchestrator,
    {
      assertAvailable: promptService.assertSystemPromptAvailable,
      getGlobalSystemPromptId: promptService.getGlobalSystemPromptId,
      resolveContent: promptService.resolveSystemPromptContent,
    },
    { listDescriptions: skillService.listEnabledDescriptions },
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
          for await (const event of prepared.stream(
            requestId,
            abortController.signal,
          )) {
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
    })
    .openapi(
      {
        ...listAiUsageAuditRoute,
        middleware: [requireAuth, requireUsageRead],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            usageAuditService.listModelCalls(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...getAiUsageAuditRoute,
        middleware: [requireAuth, requireUsageRead],
      },
      (c) => {
        const item = usageAuditService.getModelCall(
          c.req.valid("param").callId,
        );
        if (!item) {
          throw new AppError(
            ApiErrorCodes.COMMON_NOT_FOUND,
            "未找到这条模型调用记录",
            404,
          );
        }
        return c.json(createSuccessResponse(item, c.var.requestId), 200);
      },
    )
    .openapi({ ...createAiConversationRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          conversationService.createConversation(
            c.var.currentUserId,
            c.req.valid("json"),
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...listAiConversationsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          conversationService.listConversations(
            c.var.currentUserId,
            c.req.valid("query"),
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...getAiConversationRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          conversationService.getConversation(
            c.req.valid("param").conversationId,
            c.var.currentUserId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...deleteAiConversationRoute, middleware: requireAuth }, (c) => {
      conversationService.deleteConversation(
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
        const prepared = await conversationService.prepareSend(
          c.req.valid("param").conversationId,
          c.var.currentUserId,
          c.req.valid("json"),
        );
        return streamConversation(
          c,
          conversationService,
          prepared,
          c.var.requestId,
        );
      },
    )
    .openapi(
      { ...retryAiConversationRoute, middleware: requireAuth },
      async (c) => {
        const prepared = await conversationService.prepareRetry(
          c.req.valid("param").conversationId,
          c.var.currentUserId,
          c.req.valid("json"),
        );
        return streamConversation(
          c,
          conversationService,
          prepared,
          c.var.requestId,
        );
      },
    )
    .openapi(
      { ...stopAiConversationGenerationRoute, middleware: requireAuth },
      (c) => {
        const params = c.req.valid("param");
        const result = conversationService.stopGeneration(
          params.conversationId,
          params.generationId,
          c.var.currentUserId,
        );
        return c.json(
          createSuccessResponse(result.generation, c.var.requestId),
          result.statusCode,
        );
      },
    )
    .openapi(
      { ...listSystemPromptsRoute, middleware: [requireAuth, requireRead] },
      (c) =>
        c.json(
          createSuccessResponse(
            promptService.listSystemPrompts(),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...createSystemPromptRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            promptService.createSystemPrompt(
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...updateSystemPromptRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            promptService.updateSystemPrompt(
              c.req.valid("param").id,
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...deleteSystemPromptRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            {
              deleted: promptService.deleteSystemPrompt(
                c.req.valid("param").id,
              ),
            },
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...getGlobalSystemPromptRoute,
        middleware: [requireAuth, requireRead],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            {
              systemPromptId: promptService.getGlobalSystemPromptId(),
            },
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateGlobalSystemPromptRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            promptService.setGlobalSystemPrompt(
              c.req.valid("json").systemPromptId,
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listPromptTemplatesRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(promptService.listTemplates(), c.var.requestId),
        200,
      ),
    )
    .openapi(
      {
        ...createPromptTemplateRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            promptService.createTemplate(
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
        ...updatePromptTemplateRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            promptService.updateTemplate(
              c.req.valid("param").id,
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
        ...deletePromptTemplateRoute,
        middleware: [requireAuth, requireManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            {
              deleted: promptService.deleteTemplate(c.req.valid("param").id),
            },
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...listAiSkillsRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(skillService.listSkills(), c.var.requestId),
        200,
      ),
    )
    .openapi(
      { ...getAiSkillRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            skillService.getSkill(c.req.valid("param").id),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...createAiSkillRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            skillService.createSkill(c.req.valid("json"), c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...updateAiSkillRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            skillService.updateSkill(
              c.req.valid("param").id,
              c.req.valid("json"),
              c.var.currentUserId,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      { ...deleteAiSkillRoute, middleware: [requireAuth, requireManage] },
      (c) =>
        c.json(
          createSuccessResponse(
            { deleted: skillService.deleteSkill(c.req.valid("param").id) },
            c.var.requestId,
          ),
          200,
        ),
    );
}

type AiConversationService = ReturnType<typeof createAiConversationService>;
type PreparedConversation = Awaited<
  ReturnType<AiConversationService["prepareSend"]>
>;

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

async function writeEvent(
  stream: {
    writeSSE: (message: { data: string; event?: string }) => Promise<void>;
  },
  event: AiTestStreamEvent,
): Promise<void> {
  await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}

async function writeConversationEvent(
  stream: {
    writeSSE: (message: { data: string; event?: string }) => Promise<void>;
  },
  event: AiConversationStreamEvent,
): Promise<void> {
  await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}
