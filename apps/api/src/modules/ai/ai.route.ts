import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { PermissionKeys } from "@starter/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";

import { createRequireAuth } from "@api/modules/auth/index.js";
import {
  createAuthorizationRepository,
  createRequirePermission,
} from "@api/modules/authorization/index.js";

import {
  createAiAgentDefinitionRepository,
  createAiAgentDefinitionRoute,
  createAiAgentDefinitionService,
} from "./agent/index.js";
import { createAiConfigurationRoute } from "./configuration/configuration.route.js";
import { createAiRepository } from "./configuration/configuration.repository.js";
import { createAiService } from "./configuration/configuration.service.js";
import { createAiConversationRepository } from "./conversation/conversation.repository.js";
import { createAiConversationRoute } from "./conversation/conversation.route.js";
import { createAiConversationService } from "./conversation/conversation.service.js";
import { createAiPromptRepository } from "./prompt/prompt.repository.js";
import { createAiPromptRoute } from "./prompt/prompt.route.js";
import { createAiPromptService } from "./prompt/prompt.service.js";
import { createAiSkillRepository } from "./skill/skill.repository.js";
import { createAiSkillRoute } from "./skill/skill.route.js";
import { createAiSkillService } from "./skill/skill.service.js";
import { createReadSkillTool } from "./skill/skill-tools.js";
import { createAiToolOrchestrator } from "./tool/tool-orchestrator.js";
import { createAiToolRegistry } from "./tool/tool-registry.js";
import { createAiUsageAuditRepository } from "./usage-audit/usage-audit.repository.js";
import { createAiUsageAuditRoute } from "./usage-audit/usage-audit.route.js";
import {
  createAiInvocationRunner,
  createAiUsageAuditService,
} from "./usage-audit/usage-audit.service.js";

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
  const toolRegistry = createAiToolRegistry([
    ...runtime.aiTools.list(),
    createReadSkillTool(skillRepository),
  ]);
  const toolOrchestrator = createAiToolOrchestrator({
    invocationRunner,
    registry: toolRegistry,
    audit: usageAuditService,
    hasPermission: authorizationRepository.hasPermission,
    logger: runtime.logger.child({ module: "ai-tool-orchestrator" }),
  });
  const configurationService = createAiService(
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
  const agentDefinitionService = createAiAgentDefinitionService({
    repository: createAiAgentDefinitionRepository(runtime.db),
    resolveModel: configurationService.resolveAgentModel,
    promptService,
    skillRepository,
    toolRegistry,
  });
  const conversationService = createAiConversationService(
    createAiConversationRepository(runtime.db),
    runtime.aiGateway,
    {
      isAllowed: configurationService.isConversationModelAllowed,
      resolve: configurationService.resolveConversationModel,
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
    .route(
      "/",
      createAiAgentDefinitionRoute({
        service: agentDefinitionService,
        requireAuth,
        requireRead,
        requireManage,
      }),
    )
    .route(
      "/",
      createAiConfigurationRoute({
        service: configurationService,
        requireAuth,
        requireRead,
        requireManage,
      }),
    )
    .route(
      "/",
      createAiUsageAuditRoute({
        service: usageAuditService,
        requireAuth,
        requireUsageRead,
      }),
    )
    .route(
      "/",
      createAiConversationRoute({
        service: conversationService,
        requireAuth,
      }),
    )
    .route(
      "/",
      createAiPromptRoute({
        service: promptService,
        requireAuth,
        requireRead,
        requireManage,
      }),
    )
    .route(
      "/",
      createAiSkillRoute({
        service: skillService,
        requireAuth,
        requireManage,
      }),
    );
}
