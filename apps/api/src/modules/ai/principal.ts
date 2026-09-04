import type { AiApplicationPolicy } from '@starter/contracts'

export interface ResourceScope {
  tenantId: string
  projectId: string
  subjectType: string | null
  subjectId: string | null
}

export interface PrincipalContext {
  kind: 'starter_user' | 'product_app'
  principalId: string
  tenantId: string
  projectId: string
  externalUserId: string | null
  appId: string | null
  /** product_app 的能力策略；starter_user 不设置该字段。 */
  policy?: AiApplicationPolicy | null
}

export interface RuntimeAccessContext {
  principal: PrincipalContext
  scope: ResourceScope
  policy?: AiApplicationPolicy | null
}

export function starterRuntimeAccess(ownerId: string): RuntimeAccessContext {
  const principal: PrincipalContext = {
    kind: 'starter_user',
    principalId: ownerId,
    tenantId: 'starter',
    projectId: 'starter',
    externalUserId: ownerId,
    appId: null,
  }
  return { principal, scope: toResourceScope(principal) }
}

export function toRuntimeAccessContext(principal: PrincipalContext, scope: ResourceScope): RuntimeAccessContext {
  return { principal, scope, policy: principal.policy ?? null }
}

export function toResourceScope(
  principal: PrincipalContext,
  subject: { subjectType?: string; subjectId?: string } = {},
): ResourceScope {
  return {
    tenantId: principal.tenantId,
    projectId: principal.projectId,
    subjectType: subject.subjectType ?? null,
    subjectId: subject.subjectId ?? null,
  }
}
