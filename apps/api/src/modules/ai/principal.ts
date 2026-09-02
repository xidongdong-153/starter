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
}

export interface RuntimeAccessContext {
  principal: PrincipalContext
  scope: ResourceScope
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
  return { principal, scope }
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
