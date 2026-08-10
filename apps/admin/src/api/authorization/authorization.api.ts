import type {
  AuthorizationAuditEventPage,
  AuthorizationAuditQuery,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationUser,
  CurrentPermissions,
  ReplaceRolePermissionsInput,
  ReplaceUserRolesInput,
} from '@starter/contracts'

import { apiRequest } from '@admin/api/http'

export function getCurrentPermissions() {
  return apiRequest<CurrentPermissions>('/api/me/permissions')
}

export function getAuthorizationUsers() {
  return apiRequest<AuthorizationUser[]>('/api/authorization/users')
}

export function getAuthorizationRoles() {
  return apiRequest<AuthorizationRoleCatalog>('/api/authorization/roles')
}

export function getAuthorizationAuditEvents(query: AuthorizationAuditQuery) {
  const search = new URLSearchParams()
  search.set('page', String(query.page))
  search.set('pageSize', String(query.pageSize))
  if (query.action) search.set('action', query.action)
  if (query.actorId) search.set('actorId', query.actorId)
  if (query.targetId) search.set('targetId', query.targetId)
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)

  return apiRequest<AuthorizationAuditEventPage>(`/api/authorization/audit-events?${search.toString()}`)
}

export function replaceAuthorizationUserRoles(input: { userId: string; values: ReplaceUserRolesInput }) {
  return apiRequest<AuthorizationUser>(`/api/authorization/users/${input.userId}/roles`, {
    method: 'PUT',
    body: JSON.stringify(input.values),
  })
}

export function replaceAuthorizationRolePermissions(input: { roleKey: string; values: ReplaceRolePermissionsInput }) {
  return apiRequest<AuthorizationRole>(`/api/authorization/roles/${input.roleKey}/permissions`, {
    method: 'PUT',
    body: JSON.stringify(input.values),
  })
}
