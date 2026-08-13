import type {
  AuthorizationAuditEventPage,
  AuthorizationAuditQuery,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationUser,
  CreateRoleInput,
  CurrentPermissions,
  Permission,
  ReplaceRolePermissionsInput,
  ReplaceUserRolesInput,
  RoleCatalogStatus,
  UpdateRoleInput,
} from '@starter/contracts'
import type { InferResponseType } from 'hono/client'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

type RoleData = InferResponseType<(typeof apiRpc.api.authorization.roles)[':roleKey']['$patch'], 200>['data']
type RoleImpactData = InferResponseType<
  (typeof apiRpc.api.authorization.roles)[':roleKey']['impact']['$get'],
  200
>['data']
type PermissionImpactData = InferResponseType<
  (typeof apiRpc.api.authorization.permissions)[':permissionKey']['impact']['$get'],
  200
>['data']
type AuthorizationUserData = InferResponseType<
  (typeof apiRpc.api.authorization.users)[':userId']['roles']['$put'],
  200
>['data']

export function getCurrentPermissions(): Promise<CurrentPermissions> {
  return unwrapApiData(apiRpc.api.me.permissions.$get())
}

export function getAuthorizationUsers(): Promise<AuthorizationUser[]> {
  return unwrapApiData(apiRpc.api.authorization.users.$get())
}

export function getAuthorizationRoles(status: RoleCatalogStatus = 'active'): Promise<AuthorizationRoleCatalog> {
  return unwrapApiData(apiRpc.api.authorization.roles.$get({ query: { status } }))
}

export function createAuthorizationRole(input: CreateRoleInput): Promise<AuthorizationRole> {
  return unwrapApiData(apiRpc.api.authorization.roles.$post({ json: input }))
}

export function updateAuthorizationRole(input: { roleKey: string; values: UpdateRoleInput }): Promise<RoleData> {
  return unwrapApiData(
    apiRpc.api.authorization.roles[':roleKey'].$patch({
      param: { roleKey: input.roleKey },
      json: input.values,
    }),
  )
}

export function archiveAuthorizationRole(input: { roleKey: string }): Promise<RoleData> {
  return unwrapApiData(
    apiRpc.api.authorization.roles[':roleKey'].archive.$post({
      param: { roleKey: input.roleKey },
    }),
  )
}

export function restoreAuthorizationRole(input: { roleKey: string }): Promise<RoleData> {
  return unwrapApiData(
    apiRpc.api.authorization.roles[':roleKey'].restore.$post({
      param: { roleKey: input.roleKey },
    }),
  )
}

export function getAuthorizationRoleImpact(roleKey: string): Promise<RoleImpactData> {
  return unwrapApiData(
    apiRpc.api.authorization.roles[':roleKey'].impact.$get({
      param: { roleKey },
    }),
  )
}

export function getAuthorizationPermissionImpact(permissionKey: Permission): Promise<PermissionImpactData> {
  return unwrapApiData(
    apiRpc.api.authorization.permissions[':permissionKey'].impact.$get({
      param: { permissionKey },
    }),
  )
}

export function getAuthorizationAuditEvents(query: AuthorizationAuditQuery): Promise<AuthorizationAuditEventPage> {
  return unwrapApiData(
    apiRpc.api.authorization['audit-events'].$get({
      query: {
        page: String(query.page),
        pageSize: String(query.pageSize),
        action: query.action,
        actorId: query.actorId,
        targetId: query.targetId,
        from: query.from,
        to: query.to,
      },
    }),
  )
}

export function replaceAuthorizationUserRoles(input: {
  userId: string
  values: ReplaceUserRolesInput
}): Promise<AuthorizationUserData> {
  return unwrapApiData(
    apiRpc.api.authorization.users[':userId'].roles.$put({
      param: { userId: encodeURIComponent(input.userId) },
      json: input.values,
    }),
  )
}

export function replaceAuthorizationRolePermissions(input: {
  roleKey: string
  values: ReplaceRolePermissionsInput
}): Promise<RoleData> {
  return unwrapApiData(
    apiRpc.api.authorization.roles[':roleKey'].permissions.$put({
      param: { roleKey: input.roleKey },
      json: input.values,
    }),
  )
}
