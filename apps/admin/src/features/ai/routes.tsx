import type { AdminRouteRecord } from '@admin/app/router/types'

import { PermissionKeys } from '@starter/contracts'
import { lazyRouteComponent } from '@tanstack/react-router'
import { BarChart3, Bot, MessageCircle, SlidersHorizontal } from 'lucide-react'

export const aiRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/AiConversations'), 'AiConversations'),
    icon: MessageCircle,
    id: 'ai.chat',
    layout: { contentWidth: 'full' },
    menu: { group: 'settings', order: 5 },
    path: '/ai/chat',
    title: 'menu.aiChat',
  },
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
  {
    component: lazyRouteComponent(() => import('./pages/AiUsageAudit'), 'AiUsageAudit'),
    icon: BarChart3,
    id: 'settings.aiUsage',
    layout: { contentWidth: 'full' },
    menu: { group: 'settings', order: 8 },
    path: '/settings/ai/usage',
    permission: PermissionKeys.AI_USAGE_READ,
    title: 'menu.aiUsage',
  },
]
