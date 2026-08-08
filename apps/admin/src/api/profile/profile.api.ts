import type { AccountProfile, UpdateProfileInput } from '@starter/contracts'

import { apiRequest } from '@admin/api/http'

/**
 * 读取当前账号资料
 */
export function getProfile() {
  return apiRequest<AccountProfile>('/api/profile')
}

/**
 * 保存当前账号资料
 */
export function updateProfile(input: UpdateProfileInput) {
  return apiRequest<AccountProfile>('/api/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/**
 * 用已上传的图片文件设置头像
 */
export function setProfileAvatar(fileId: string) {
  return apiRequest<{ fileId: string }>('/api/profile/avatar', {
    method: 'PUT',
    body: JSON.stringify({ fileId }),
  })
}

/**
 * 清空头像
 */
export function clearProfileAvatar() {
  return apiRequest<{ ok: boolean }>('/api/profile/avatar', {
    method: 'DELETE',
  })
}
