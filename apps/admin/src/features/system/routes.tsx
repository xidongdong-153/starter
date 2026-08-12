import type { AdminRouteRecord } from '@admin/app/router/types'

import { PermissionKeys } from '@starter/contracts'
import { lazyRouteComponent } from '@tanstack/react-router'
import { ScrollText } from 'lucide-react'

export const systemRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/LogViewer'), 'LogViewer'),
    icon: ScrollText,
    id: 'settings.systemLogs',
    menu: {
      group: 'settings',
      order: 9,
    },
    path: '/settings/logs',
    permission: PermissionKeys.SYSTEM_LOGS_READ,
    title: 'menu.systemLogs',
  },
]
