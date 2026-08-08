import { getAdminSession } from '@admin/api/auth'
import { redirect } from '@tanstack/react-router'

export interface AdminAuthGuardResult {
  status: 'allowed' | 'login'
}

/**
 * 判断当前会话能否进入控制台页面。
 * 现在只判断登录态，权限还没接。
 */
export async function resolveAdminRouteAccess(): Promise<AdminAuthGuardResult> {
  const session = await getAdminSession()

  return { status: session ? 'allowed' : 'login' }
}

export function throwAdminRouteRedirect(result: AdminAuthGuardResult) {
  if (result.status === 'login') {
    throw redirect({
      to: '/login' as never,
      throw: true,
      replace: true,
    })
  }

  return null
}
