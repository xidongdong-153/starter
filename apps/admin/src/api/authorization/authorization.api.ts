import type {
  AuthorizationAuditEventPage,
  AuthorizationAuditQuery,
  AuthorizationPermissionImpact,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationRoleImpact,
  AuthorizationUser,
  CreateRoleInput,
  CurrentPermissions,
  Permission,
  ReplaceRolePermissionsInput,
  ReplaceUserRolesInput,
  RoleCatalogStatus,
  UpdateRoleInput,
} from '@starter/contracts'

import { apiRequest } from '@admin/api/http'

export function getCurrentPermissions() {
  return apiRequest<CurrentPermissions>('/api/me/permissions')
}

export function getAuthorizationUsers() {
  return apiRequest<AuthorizationUser[]>('/api/authorization/users')
}

export function getAuthorizationRoles(status: RoleCatalogStatus = 'active') {
  return apiRequest<AuthorizationRoleCatalog>(`/api/authorization/roles?status=${status}`)
}

export function createAuthorizationRole(input: CreateRoleInput) {
  return apiRequest<AuthorizationRole>('/api/authorization/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateAuthorizationRole(input: { roleKey: string; values: UpdateRoleInput }) {
  return apiRequest<AuthorizationRole>(`/api/authorization/roles/${input.roleKey}`, {
    method: 'PATCH',
    body: JSON.stringify(input.values),
  })
}

export function archiveAuthorizationRole(input: { roleKey: string }) {
  return apiRequest<AuthorizationRole>(`/api/authorization/roles/${input.roleKey}/archive`, {
    method: 'POST',
  })
}

export function restoreAuthorizationRole(input: { roleKey: string }) {
  return apiRequest<AuthorizationRole>(`/api/authorization/roles/${input.roleKey}/restore`, {
    method: 'POST',
  })
}

export function getAuthorizationRoleImpact(roleKey: string) {
  return apiRequest<AuthorizationRoleImpact>(`/api/authorization/roles/${roleKey}/impact`)
}

export function getAuthorizationPermissionImpact(permissionKey: Permission) {
  return apiRequest<AuthorizationPermissionImpact>(
    `/api/authorization/permissions/${encodeURIComponent(permissionKey)}/impact`,
  )
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
