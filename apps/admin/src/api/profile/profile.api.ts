import type { AccountProfile, UpdateProfileInput } from '@starter/contracts'
import type { InferResponseType } from 'hono/client'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

type SetAvatarData = InferResponseType<typeof apiRpc.api.profile.avatar.$put, 200>['data']
type ClearAvatarData = InferResponseType<typeof apiRpc.api.profile.avatar.$delete, 200>['data']

/**
 * 读取当前账号资料
 */
export function getProfile(): Promise<AccountProfile> {
  return unwrapApiData(apiRpc.api.profile.$get())
}

/**
 * 保存当前账号资料
 */
export function updateProfile(input: UpdateProfileInput): Promise<AccountProfile> {
  return unwrapApiData(apiRpc.api.profile.$patch({ json: input }))
}

/**
 * 用已上传的图片文件设置头像
 */
export function setProfileAvatar(fileId: string): Promise<SetAvatarData> {
  return unwrapApiData(apiRpc.api.profile.avatar.$put({ json: { fileId } }))
}

/**
 * 清空头像
 */
export function clearProfileAvatar(): Promise<ClearAvatarData> {
  return unwrapApiData(apiRpc.api.profile.avatar.$delete())
}
