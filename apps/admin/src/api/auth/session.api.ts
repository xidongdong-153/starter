import { authClient } from '@admin/api/client'

export type AdminSession = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>['data']>

export type AdminSessionUser = AdminSession['user']

/**
 * 读取当前会话。没有登录或请求失败时返回 null。
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const result = await authClient.getSession()

    if (result.error || !result.data) {
      return null
    }

    return result.data
  } catch {
    return null
  }
}
