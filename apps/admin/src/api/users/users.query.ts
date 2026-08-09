import type { UserManagementQuery } from '@starter/contracts'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getUserDetail, listUsers } from './users.api'

export const usersQueryKeys = {
  all: ['users'] as const,
  list: (query: UserManagementQuery) => [...usersQueryKeys.all, 'list', query] as const,
  detail: (userId: string) => [...usersQueryKeys.all, 'detail', userId] as const,
}

export function useUsersListQuery(query: UserManagementQuery) {
  return useQuery({
    queryKey: usersQueryKeys.list(query),
    queryFn: () => listUsers(query),
    placeholderData: keepPreviousData,
  })
}

export function useUserDetailQuery(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? usersQueryKeys.detail(userId) : [],
    queryFn: () => getUserDetail(userId!),
    enabled: Boolean(userId),
  })
}
