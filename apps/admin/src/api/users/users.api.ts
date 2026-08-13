import type { UserManagementQuery, UserManagementUserPage, UserStatus } from '@starter/contracts'
import type { InferResponseType } from 'hono/client'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

type UserDetailData = InferResponseType<(typeof apiRpc.api.users)[':userId']['$get'], 200>['data']
type StatusData = InferResponseType<(typeof apiRpc.api.users)[':userId']['status']['$patch'], 200>['data']

export function listUsers(query: UserManagementQuery): Promise<UserManagementUserPage> {
  return unwrapApiData(
    apiRpc.api.users.$get({
      query: {
        page: String(query.page),
        pageSize: String(query.pageSize),
        search: query.search,
        roleKey: query.roleKey,
      },
    }),
  )
}

export function getUserDetail(userId: string): Promise<UserDetailData> {
  return unwrapApiData(
    apiRpc.api.users[':userId'].$get({
      param: { userId: encodeURIComponent(userId) },
    }),
  )
}

export function updateUserStatus(userId: string, status: UserStatus): Promise<StatusData> {
  return unwrapApiData(
    apiRpc.api.users[':userId'].status.$patch({
      param: { userId: encodeURIComponent(userId) },
      json: { status },
    }),
  )
}
