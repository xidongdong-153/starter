import type { AuthConfig } from '@starter/contracts'

import { apiRequest } from '@admin/api/http'

/**
 * 读取后端开启了哪些登录方式
 */
export function getAuthConfig() {
  return apiRequest<AuthConfig>('/api/config/auth')
}
