import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { ApiErrorCodes, aiApplicationPolicySchema, aiRuntimeSubjectHeadersSchema } from '@starter/contracts'
import type { AiApplicationPolicy } from '@starter/contracts'
import { AppError } from '@api/shared/app-error.js'
import type { createAiApplicationService } from './application.service.js'
import { toResourceScope } from '../principal.js'

function unauthorized(): AppError {
  return new AppError(ApiErrorCodes.AUTH_UNAUTHENTICATED, '应用凭据无效', 401)
}

export function createRequireProductApp(
  service: ReturnType<typeof createAiApplicationService>,
): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const authorization = c.req.header('Authorization')
    if (!authorization?.startsWith('Bearer ')) throw unauthorized()
    const secret = authorization.slice('Bearer '.length).trim()
    if (!secret) throw unauthorized()
    const record = service.authenticate(secret)
    if (!record || record.status !== 'active') throw unauthorized()

    const parsed = aiRuntimeSubjectHeadersSchema.safeParse({
      externalUserId: c.req.header('X-AI-External-User-Id'),
      subjectType: c.req.header('X-AI-Subject-Type'),
      subjectId: c.req.header('X-AI-Subject-Id'),
    })
    if (!parsed.success) throw unauthorized()

    let policy: AiApplicationPolicy | null = null
    if (record.policyJson !== null) {
      try {
        const policyResult = aiApplicationPolicySchema.safeParse(JSON.parse(record.policyJson))
        if (policyResult.success) {
          policy = policyResult.data
        } else {
          c.var.logger.warn({ appId: record.id }, 'AI 应用凭据 policy_json 无效，按未配置处理')
        }
      } catch {
        c.var.logger.warn({ appId: record.id }, 'AI 应用凭据 policy_json 不是有效 JSON，按未配置处理')
      }
    }

    const principal = {
      kind: 'product_app' as const,
      principalId: record.id,
      tenantId: record.tenantId,
      projectId: record.projectId,
      externalUserId: parsed.data.externalUserId,
      appId: record.id,
      policy,
    }
    c.set('principal', principal)
    c.set('resourceScope', toResourceScope(principal, parsed.data))
    await next()
  }
}
