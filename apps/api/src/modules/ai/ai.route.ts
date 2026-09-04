import type { AppRuntime } from '@api/bootstrap/create-runtime.js'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { PermissionKeys } from '@starter/contracts'
import { OpenAPIHono } from '@hono/zod-openapi'

import { createRequireAuth } from '@api/modules/auth/index.js'
import { createRequirePermission } from '@api/modules/authorization/index.js'

import { createAiAgentDefinitionRoute } from './agent/index.js'
import type { AiServices } from './ai.services.js'
import { createAiApplicationRouteGroup, createRequireProductApp } from './application/index.js'
import { createRequireAiRuntimePrincipal } from './principal.guard.js'
import { createAiAttachmentRoute } from './attachment/index.js'
import { createAiCompletionRoute } from './completion/index.js'
import { createAiAgentRunRoute } from './run/index.js'
import { createAiAgentSessionRoute } from './session/index.js'
import { createAiConfigurationRoute } from './configuration/configuration.route.js'
import { createAiPromptRoute } from './prompt/prompt.route.js'
import { createAiSkillRoute } from './skill/skill.route.js'
import { createAiUsageAuditRoute } from './usage-audit/usage-audit.route.js'
import { createAiWebhookRouteGroup } from './webhook/index.js'

export function createAiRoute(runtime: AppRuntime, services: AiServices) {
  const requireAuth = createRequireAuth(runtime.auth)
  const requireRead = createRequirePermission(runtime.db, PermissionKeys.AI_CONFIG_READ)
  const requireManage = createRequirePermission(runtime.db, PermissionKeys.AI_CONFIG_MANAGE)
  const requireUsageRead = createRequirePermission(runtime.db, PermissionKeys.AI_USAGE_READ)
  const { applicationService, webhookService, usageAuditService } = services
  const requireProductApp = createRequireProductApp(applicationService)
  const requireRuntimePrincipal = createRequireAiRuntimePrincipal({
    requireStarterUser: requireAuth,
    requireProductApp,
  })

  return new OpenAPIHono<HonoEnv>()
    .route(
      '/',
      createAiApplicationRouteGroup({
        service: applicationService,
        requireAuth,
        requireManage,
      }),
    )
    .route(
      '/',
      createAiAgentSessionRoute({
        service: services.sessionService,
        requireAuth: requireRuntimePrincipal,
      }),
    )
    .route(
      '/',
      createAiAgentDefinitionRoute({
        service: services.agentDefinitionService,
        requireAuth,
        requireRuntime: requireRuntimePrincipal,
        requireRead,
        requireManage,
      }),
    )
    .route(
      '/',
      createAiConfigurationRoute({
        service: services.configurationService,
        requireAuth,
        requireRead,
        requireManage,
      }),
    )
    .route(
      '/',
      createAiUsageAuditRoute({
        service: usageAuditService,
        requireAuth,
        requireUsageRead,
      }),
    )
    .route(
      '/',
      createAiAgentRunRoute({
        service: services.runService,
        runtimePort: services.runtimePort,
        requireAuth: requireRuntimePrincipal,
        requireRead,
      }),
    )
    .route(
      '/',
      createAiCompletionRoute({
        service: services.completionService,
        requireAuth: requireRuntimePrincipal,
      }),
    )
    .route(
      '/',
      createAiAttachmentRoute({
        service: services.attachmentService,
        requireAuth: requireRuntimePrincipal,
      }),
    )
    .route(
      '/',
      createAiWebhookRouteGroup({
        service: webhookService,
        requireAuth,
        requireRead,
        requireManage,
      }),
    )
    .route(
      '/',
      createAiPromptRoute({
        service: services.promptService,
        requireAuth,
        requireRead,
        requireManage,
      }),
    )
    .route(
      '/',
      createAiSkillRoute({
        service: services.skillService,
        requireAuth,
        requireManage,
      }),
    )
}
