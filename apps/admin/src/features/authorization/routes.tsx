import type { AdminRouteRecord } from '@admin/app/router/types'

import { PermissionKeys } from '@starter/contracts'
import { lazyRouteComponent } from '@tanstack/react-router'
import { ScrollText, ShieldCheck } from 'lucide-react'

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
  {
    component: lazyRouteComponent(() => import('./pages/AuthorizationAudit'), 'AuthorizationAudit'),
    icon: ScrollText,
    id: 'settings.authorizationAudit',
    layout: {
      contentWidth: 'full',
    },
    menu: {
      group: 'settings',
      order: 11,
    },
    path: '/settings/authorization-audit',
    permission: PermissionKeys.AUTHORIZATION_AUDIT_READ,
    title: 'menu.authorizationAudit',
  },
]
