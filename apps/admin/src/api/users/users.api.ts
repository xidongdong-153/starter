import type { UserManagementQuery, UserManagementUserDetail, UserManagementUserPage } from '@starter/contracts'

import { apiRequest } from '@admin/api/http'

export function listUsers(query: UserManagementQuery) {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(query.page))
  searchParams.set('pageSize', String(query.pageSize))
  if (query.search) {
    searchParams.set('search', query.search)
  }
  if (query.roleKey) {
    searchParams.set('roleKey', query.roleKey)
  }
  return apiRequest<UserManagementUserPage>(`/api/users?${searchParams.toString()}`)
}

export function getUserDetail(userId: string) {
  return apiRequest<UserManagementUserDetail>(`/api/users/${userId}`)
}
