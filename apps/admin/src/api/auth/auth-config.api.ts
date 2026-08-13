import type { AuthConfig } from '@starter/contracts'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

/**
 * 读取后端开启了哪些登录方式
 */
export function getAuthConfig(): Promise<AuthConfig> {
  return unwrapApiData(apiRpc.api.config.auth.$get())
}
