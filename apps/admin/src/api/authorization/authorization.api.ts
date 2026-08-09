import type {
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
