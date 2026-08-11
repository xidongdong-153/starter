import type {
  AuthorizationAuditQuery,
  CreateRoleInput,
  Permission,
  ReplaceRolePermissionsInput,
  ReplaceUserRolesInput,
  RoleCatalogStatus,
  UpdateRoleInput,
} from '@starter/contracts'

import { queryOptions, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  archiveAuthorizationRole,
  createAuthorizationRole,
  getAuthorizationAuditEvents,
  getAuthorizationPermissionImpact,
  getAuthorizationRoleImpact,
  getAuthorizationRoles,
  getAuthorizationUsers,
  getCurrentPermissions,
  replaceAuthorizationRolePermissions,
  replaceAuthorizationUserRoles,
  restoreAuthorizationRole,
  updateAuthorizationRole,
} from './authorization.api'

export const authorizationQueryKeys = {
  all: ['authorization'] as const,
  auditEvents: (query: AuthorizationAuditQuery) => [...authorizationQueryKeys.all, 'audit-events', query] as const,
  current: () => [...authorizationQueryKeys.all, 'current'] as const,
  permissionImpact: (permissionKey: string) =>
    [...authorizationQueryKeys.all, 'permission-impact', permissionKey] as const,
  roleImpact: (roleKey: string) => [...authorizationQueryKeys.all, 'role-impact', roleKey] as const,
  roleImpacts: () => [...authorizationQueryKeys.all, 'role-impact'] as const,
  permissionImpacts: () => [...authorizationQueryKeys.all, 'permission-impact'] as const,
  roles: (status: RoleCatalogStatus = 'active') => [...authorizationQueryKeys.all, 'roles', status] as const,
  rolesAll: () => [...authorizationQueryKeys.all, 'roles'] as const,
  users: () => [...authorizationQueryKeys.all, 'users'] as const,
}

export const currentPermissionsQueryOptions = queryOptions({
  queryKey: authorizationQueryKeys.current(),
  queryFn: getCurrentPermissions,
  refetchOnWindowFocus: true,
  staleTime: 30_000,
})

export function useCurrentPermissionsQuery() {
  return useQuery(currentPermissionsQueryOptions)
}

export function useAuthorizationUsersQuery() {
  return useQuery({
    queryKey: authorizationQueryKeys.users(),
    queryFn: getAuthorizationUsers,
  })
}

export function useAuthorizationRolesQuery(status: RoleCatalogStatus = 'active') {
  return useQuery({
    queryKey: authorizationQueryKeys.roles(status),
    queryFn: () => getAuthorizationRoles(status),
  })
}

export function useAuthorizationRoleImpactQuery(roleKey: string | null) {
  return useQuery({
    queryKey: authorizationQueryKeys.roleImpact(roleKey ?? ''),
    queryFn: roleKey === null ? skipToken : () => getAuthorizationRoleImpact(roleKey),
    refetchOnMount: 'always',
  })
}

export function useAuthorizationPermissionImpactQuery(permissionKey: Permission | null) {
  return useQuery({
    queryKey: authorizationQueryKeys.permissionImpact(permissionKey ?? 'none'),
    queryFn: permissionKey === null ? skipToken : () => getAuthorizationPermissionImpact(permissionKey),
    refetchOnMount: 'always',
  })
}

/** 审计是只读数据，不需要 mutation 和失效逻辑。 */
export function useAuthorizationAuditEventsQuery(query: AuthorizationAuditQuery) {
  return useQuery({
    queryKey: authorizationQueryKeys.auditEvents(query),
    queryFn: () => getAuthorizationAuditEvents(query),
  })
}

/** 角色写操作影响 active/archived 目录、用户、当前权限和两类 impact，全部失效。 */
async function invalidateAuthorizationQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.current() }),
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.users() }),
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.rolesAll() }),
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.roleImpacts() }),
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.permissionImpacts() }),
  ])
}

export function useReplaceAuthorizationUserRolesMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { userId: string; values: ReplaceUserRolesInput }) => replaceAuthorizationUserRoles(input),
    onSuccess: async () => {
      await invalidateAuthorizationQueries(queryClient)
    },
  })
}

export function useReplaceAuthorizationRolePermissionsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { roleKey: string; values: ReplaceRolePermissionsInput }) =>
      replaceAuthorizationRolePermissions(input),
    onSuccess: async () => {
      await invalidateAuthorizationQueries(queryClient)
    },
  })
}

export function useCreateAuthorizationRoleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateRoleInput) => createAuthorizationRole(input),
    onSuccess: async () => {
      await invalidateAuthorizationQueries(queryClient)
    },
  })
}

export function useUpdateAuthorizationRoleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { roleKey: string; values: UpdateRoleInput }) => updateAuthorizationRole(input),
    onSuccess: async () => {
      await invalidateAuthorizationQueries(queryClient)
    },
  })
}

export function useArchiveAuthorizationRoleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { roleKey: string }) => archiveAuthorizationRole(input),
    onSuccess: async () => {
      await invalidateAuthorizationQueries(queryClient)
    },
  })
}

export function useRestoreAuthorizationRoleMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { roleKey: string }) => restoreAuthorizationRole(input),
    onSuccess: async () => {
      await invalidateAuthorizationQueries(queryClient)
    },
  })
}
