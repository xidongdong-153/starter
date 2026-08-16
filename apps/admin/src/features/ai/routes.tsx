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
    menu: { group: 'ai', order: 5 },
    path: '/ai/chat',
    title: 'menu.aiChat',
  },
  {
    component: lazyRouteComponent(() => import('./pages/AiSettings'), 'AiSettings'),
    icon: Bot,
    id: 'ai.settings',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 6 },
    path: '/ai/settings',
    title: 'menu.aiSettings',
  },
  {
    component: lazyRouteComponent(() => import('./pages/AiProviders'), 'AiProviders'),
    icon: SlidersHorizontal,
    id: 'ai.providers',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 7 },
    path: '/ai/providers',
    permission: PermissionKeys.AI_CONFIG_READ,
    title: 'menu.aiProviders',
  },
  {
    component: lazyRouteComponent(() => import('./pages/AiUsageAudit'), 'AiUsageAudit'),
    icon: BarChart3,
    id: 'ai.usage',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 8 },
    path: '/ai/usage',
    permission: PermissionKeys.AI_USAGE_READ,
    title: 'menu.aiUsage',
  },
]
