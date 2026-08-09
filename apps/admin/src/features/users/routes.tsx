import type { AdminRouteRecord } from '@admin/app/router/types'

import { PermissionKeys } from '@starter/contracts'
import { lazyRouteComponent } from '@tanstack/react-router'
import { UsersRound } from 'lucide-react'

export const usersRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/UserManagement'), 'UserManagement'),
    icon: UsersRound,
    id: 'settings.users',
    layout: {
      contentWidth: 'full',
    },
    menu: {
      group: 'settings',
      order: 8,
    },
    path: '/settings/users',
    permission: PermissionKeys.AUTHORIZATION_READ,
    title: 'menu.userManagement',
  },
]
