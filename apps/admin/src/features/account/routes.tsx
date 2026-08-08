import type { AdminRouteRecord } from '@admin/app/router/types'

import { lazyRouteComponent } from '@tanstack/react-router'
import { UserRound } from 'lucide-react'

export const accountRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/ProfileSettings'), 'ProfileSettings'),
    icon: UserRound,
    id: 'settings.profile',
    layout: {
      contentWidth: 'full',
    },
    menu: {
      group: 'settings',
      order: 5,
    },
    path: '/settings/profile',
    title: 'menu.profileSettings',
  },
]
