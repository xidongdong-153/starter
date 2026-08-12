import type { UserManagementQuery, UserStatus } from '@starter/contracts'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getUserDetail, listUsers, updateUserStatus } from './users.api'

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

export function useUpdateUserStatusMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: UserStatus }) => updateUserStatus(userId, status),
    onSuccess: () => {
      // 失效全部 users 查询（列表 + 详情），让禁用/启用后状态立即刷新
      void queryClient.invalidateQueries({ queryKey: usersQueryKeys.all })
    },
  })
}
