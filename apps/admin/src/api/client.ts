import { getAdminEnv } from '@admin/env'
import { createAuthClient } from 'better-auth/react'

export const adminEnv = getAdminEnv()

/** API 服务地址，来自 VITE_API_URL */
export const apiBaseUrl = adminEnv.VITE_API_URL

/** Better Auth 客户端，登录、注册、退出和会话都走这里 */
export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  fetchOptions: { credentials: 'include' },
})

/** 拼出接口完整地址 */
export function resolveApiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
}
