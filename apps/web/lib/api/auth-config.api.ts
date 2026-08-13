import type { AuthConfig } from '@starter/contracts'
import { apiRpc, unwrapApiData } from '@web/lib/rpc'

export async function getAuthConfig(): Promise<AuthConfig> {
  const data = await unwrapApiData<unknown>(apiRpc.api.config.auth.$get())

  if (!isAuthConfig(data)) {
    throw new Error('认证配置的数据格式不正确。')
  }

  return data
}

function isAuthConfig(value: unknown): value is AuthConfig {
  if (typeof value !== 'object' || value === null || !('providers' in value)) return false
  const providers = value.providers
  return (
    typeof providers === 'object' &&
    providers !== null &&
    'email' in providers &&
    providers.email === true &&
    'github' in providers &&
    typeof providers.github === 'boolean' &&
    'google' in providers &&
    typeof providers.google === 'boolean'
  )
}
