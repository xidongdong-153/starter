import type { AuthConfig } from '@starter/contracts'
import { apiRequest } from '@web/lib/http'

export async function getAuthConfig(): Promise<AuthConfig> {
  const data = await apiRequest('/api/config/auth')

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
