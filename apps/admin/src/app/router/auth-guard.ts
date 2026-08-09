import type { Permission } from '@starter/contracts'
import type { QueryClient } from '@tanstack/react-query'

import { currentPermissionsQueryOptions } from '@admin/api/authorization'
import { getAdminSession } from '@admin/api/auth'
import { isUnauthorizedError } from '@admin/api/http'
import { hasPermission } from '@admin/app/authorization/permissions'
import { redirect } from '@tanstack/react-router'

export interface AdminAuthGuardResult {
  status: 'allowed' | 'login'
}

/**
 * 判断当前会话能否进入控制台页面。
 */
export async function resolveAdminRouteAccess(): Promise<AdminAuthGuardResult> {
  const session = await getAdminSession()

  return { status: session ? 'allowed' : 'login' }
}

export async function requireAdminRoutePermission(queryClient: QueryClient, permission: Permission) {
  try {
    const currentPermissions = await queryClient.fetchQuery(currentPermissionsQueryOptions)

    if (!hasPermission(currentPermissions.permissions, permission)) {
      throw redirect({
        to: '/403' as never,
        replace: true,
      })
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      throw redirect({
        to: '/login' as never,
        replace: true,
      })
    }

    throw error
  }
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
