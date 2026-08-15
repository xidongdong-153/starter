import type { AdminRouteRecord } from '@admin/app/router/types'

import { PermissionKeys } from '@starter/contracts'
import { lazyRouteComponent } from '@tanstack/react-router'
import { Bot, SlidersHorizontal } from 'lucide-react'

export const aiRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/AiSettings'), 'AiSettings'),
    icon: Bot,
    id: 'settings.ai',
    layout: { contentWidth: 'full' },
    menu: { group: 'settings', order: 6 },
    path: '/settings/ai',
    title: 'menu.aiSettings',
  },
  {
    component: lazyRouteComponent(() => import('./pages/AiProviders'), 'AiProviders'),
    icon: SlidersHorizontal,
    id: 'settings.aiProviders',
    layout: { contentWidth: 'full' },
    menu: { group: 'settings', order: 7 },
    path: '/settings/ai/providers',
    permission: PermissionKeys.AI_CONFIG_READ,
    title: 'menu.aiProviders',
  },
]
