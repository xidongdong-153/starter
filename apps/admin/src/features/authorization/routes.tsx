import type { AdminRouteRecord } from '@admin/app/router/types'

import { PermissionKeys } from '@starter/contracts'
import { lazyRouteComponent } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'

export const authorizationRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/AuthorizationSettings'), 'AuthorizationSettings'),
    icon: ShieldCheck,
    id: 'settings.authorization',
    layout: {
      contentWidth: 'full',
    },
    menu: {
      group: 'settings',
      order: 10,
    },
    path: '/settings/authorization',
    permission: PermissionKeys.AUTHORIZATION_READ,
    title: 'menu.authorizationSettings',
  },
]
