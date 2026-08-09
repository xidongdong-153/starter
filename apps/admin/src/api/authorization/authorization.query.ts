import type { ReplaceRolePermissionsInput, ReplaceUserRolesInput } from '@starter/contracts'

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getAuthorizationRoles,
  getAuthorizationUsers,
  getCurrentPermissions,
  replaceAuthorizationRolePermissions,
  replaceAuthorizationUserRoles,
} from './authorization.api'

export const authorizationQueryKeys = {
  all: ['authorization'] as const,
  current: () => [...authorizationQueryKeys.all, 'current'] as const,
  roles: () => [...authorizationQueryKeys.all, 'roles'] as const,
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

export function useAuthorizationRolesQuery() {
  return useQuery({
    queryKey: authorizationQueryKeys.roles(),
    queryFn: getAuthorizationRoles,
  })
}

async function invalidateAuthorizationQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.current() }),
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.users() }),
    queryClient.invalidateQueries({ queryKey: authorizationQueryKeys.roles() }),
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
