import type { AdminRouteRecord } from './types'

import { accountRoutes } from '@admin/features/account/routes'
import { aiRoutes } from '@admin/features/ai/routes'
import { authorizationRoutes } from '@admin/features/authorization/routes'
import { authRoutes } from '@admin/features/auth/routes'
import { errorRoutes } from '@admin/features/errors/routes'
import { exampleRoutes } from '@admin/features/examples/routes'
import { filesRoutes } from '@admin/features/files/routes'
import { homeRoute, homeRoutes } from '@admin/features/home/routes'
import { systemRoutes } from '@admin/features/system/routes'
import { usersRoutes } from '@admin/features/users/routes'

/** 需要登录后才能访问的页面 */
export const appRouteRecords: AdminRouteRecord[] = [
  ...homeRoutes,
  ...filesRoutes,
  ...accountRoutes,
  ...aiRoutes,
  ...authorizationRoutes,
  ...usersRoutes,
  ...systemRoutes,
  ...exampleRoutes,
  ...errorRoutes,
]

/** 不需要登录的页面 */
export const authRouteRecords: AdminRouteRecord[] = authRoutes

export const adminRouteRecords: AdminRouteRecord[] = [...authRouteRecords, ...appRouteRecords]

export const homeRouteRecord = homeRoute
