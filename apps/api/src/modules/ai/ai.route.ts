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

import { createPiAgentExecutor } from "@api/infra/agent/index.js";
import {
  createAiApplicationRepository,
  createAiApplicationRouteGroup,
  createAiApplicationService,
  createRequireProductApp,
} from "./application/index.js";
import { createRequireAiRuntimePrincipal } from "./principal.guard.js";
import {
  createAiCompletionRoute,
  createAiCompletionService,
} from "./completion/index.js";

import {
  createAiAgentRunRepository,
  createAiRunEventRepository,
  createAiRunTraceRepository,
  createAiRunLifecycleRepository,
  createAiAgentRunRoute,
  createAiAgentRunService,
} from "./run/index.js";
import {
  createAiAgentSessionRepository,
  createAiAgentSessionRoute,
  createAiAgentSessionService,
} from "./session/index.js";
import { createAiConfigurationRoute } from "./configuration/configuration.route.js";
import { createAiRepository } from "./configuration/configuration.repository.js";
import { createAiCustomProviderRepository } from "./configuration/custom-provider.repository.js";
import { createAiService } from "./configuration/configuration.service.js";
import { createAiPromptRepository } from "./prompt/prompt.repository.js";
import { createAiPromptRoute } from "./prompt/prompt.route.js";
import { createAiPromptService } from "./prompt/prompt.service.js";
import { createAiSkillRepository } from "./skill/skill.repository.js";
import { createAiSkillRoute } from "./skill/skill.route.js";
import { createAiSkillService } from "./skill/skill.service.js";
import { createBuiltinAiToolRegistry } from "./tool/tool-catalog.js";
import { createAiStructuredOutputRepository } from "./output/structured-output.repository.js";

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
  const applicationService = createAiApplicationService({
    repository: createAiApplicationRepository(runtime.db),
    logger: runtime.logger.child({ module: "ai-application" }),
  });
  const requireProductApp = createRequireProductApp(applicationService);
  const requireRuntimePrincipal = createRequireAiRuntimePrincipal({
    requireStarterUser: requireAuth,
    requireProductApp,
  });
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
  const toolRegistry = createBuiltinAiToolRegistry({
    injectedTools: runtime.aiTools.list(),
    skillRepository,
  });
  const outputContractRegistry = runtime.aiOutputContracts;
  const structuredOutputRepository = createAiStructuredOutputRepository(
    runtime.db,
  );
  const configurationService = createAiService(
    createAiRepository(runtime.db),
    runtime.ai,
    runtime.aiGateway,
    invocationRunner,
    runtime.env.AI_REQUEST_TIMEOUT_MS,
    createAiCustomProviderRepository(
      runtime.db,
      runtime.ai.providers
        .filter((provider) => provider.kind === "built_in")
        .map((provider) => provider.id),
    ),
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
    outputContractRegistry,
  });
  const sessionRepository = createAiAgentSessionRepository(runtime.db);
  const sessionService = createAiAgentSessionService({
    repository: sessionRepository,
    sessionStore: runtime.agentSessionStore,
    logger: runtime.logger.child({ module: "ai-session" }),
    structuredOutputRepository,
    outputContractRegistry,
  });
  void sessionService
    .checkConsistency()
    .then((report) => {
      const orphanCount =
        report.missingInPi.length + report.missingInMain.length;
      if (orphanCount > 0) {
        runtime.logger.warn(
          {
            missingInPiCount: report.missingInPi.length,
            missingInMainCount: report.missingInMain.length,
          },
          "Agent Session 一致性检查发现孤儿记录",
        );
      }
    })
    .catch((error: unknown) => {
      runtime.logger.error({ err: error }, "Agent Session 一致性检查失败");
    });
  const runExecutor =
    runtime.piAgentExecutor ??
    createPiAgentExecutor({
      sessionStore: runtime.agentSessionStore,
      models: runtime.ai.getModelsCollection(),
      hasPermission: authorizationRepository.hasPermission,
      getProviderRequestEnv: runtime.ai.getProviderRequestEnv,
      audit: usageAuditService.createAgentModelCallAudit(),
      toolAudit: usageAuditService.createAgentToolExecutionAudit(),
      lifecycle: createAiRunLifecycleRepository(runtime.db),
      logger: runtime.logger.child({ module: "ai-executor" }),
      requestTimeoutMs: runtime.env.AI_REQUEST_TIMEOUT_MS,
    });
  const runService = createAiAgentRunService({
    repository: createAiAgentRunRepository(runtime.db, sessionRepository),
    eventRepository: createAiRunEventRepository(runtime.db),
    traceRepository: createAiRunTraceRepository(runtime.db),
    sessionRepository,
    sessionStore: runtime.agentSessionStore,
    agentService: agentDefinitionService,
    registry: runtime.activeRunRegistry,
    executor: runExecutor,
    logger: runtime.logger.child({ module: "ai-run" }),
    telemetry: runtime.aiTelemetry,
    structuredOutputRepository,
    outputContractRegistry,
  });
  const completionService = createAiCompletionService({
    invocationRunner,
    requireAllowedModel: configurationService.resolveAgentModel,
    requestTimeoutMs: runtime.env.AI_REQUEST_TIMEOUT_MS,
    logger: runtime.logger.child({ module: "ai-completion" }),
  });
  void runService
    .recoverInterrupted()
    .then((report) => {
      if (report.scanned > 0) {
        runtime.logger.info({ report }, "Agent Run 启动恢复扫描完成");
      }
    })
    .catch((error: unknown) => {
      runtime.logger.error({ err: error }, "Agent Run 启动恢复扫描失败");
    });

  return new OpenAPIHono<HonoEnv>()
    .route(
      "/",
      createAiApplicationRouteGroup({
        service: applicationService,
        requireAuth,
        requireManage,
      }),
    )
    .route(
      "/",
      createAiAgentSessionRoute({
        service: sessionService,
        requireAuth: requireRuntimePrincipal,
      }),
    )
    .route(
      "/",
      createAiAgentDefinitionRoute({
        service: agentDefinitionService,
        requireAuth,
        requireRuntime: requireRuntimePrincipal,
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
      createAiAgentRunRoute({
        service: runService,
        requireAuth: requireRuntimePrincipal,
        requireRead,
      }),
    )
    .route(
      "/",
      createAiCompletionRoute({
        service: completionService,
        requireAuth: requireRuntimePrincipal,
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
