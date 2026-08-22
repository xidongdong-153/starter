import type { AdminRouteRecord } from '@admin/app/router/types'

import { PermissionKeys } from '@starter/contracts'
import { lazyRouteComponent } from '@tanstack/react-router'
import { BarChart3, Bot, FileText, GraduationCap, ScrollText, SlidersHorizontal } from 'lucide-react'

export const aiRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/Agents'), 'Agents'),
    icon: Bot,
    id: 'ai.agents',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 6 },
    path: '/ai/agents',
    permission: PermissionKeys.AI_CONFIG_READ,
    title: 'menu.aiAgents',
  },
  {
    component: lazyRouteComponent(() => import('./pages/SystemPrompts'), 'SystemPrompts'),
    icon: ScrollText,
    id: 'ai.systemPrompts',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 6 },
    path: '/ai/system-prompts',
    permission: PermissionKeys.AI_CONFIG_READ,
    title: 'menu.aiSystemPrompts',
  },
  {
    component: lazyRouteComponent(() => import('./pages/PromptTemplates'), 'PromptTemplates'),
    icon: FileText,
    id: 'ai.promptTemplates',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 7 },
    path: '/ai/prompt-templates',
    permission: PermissionKeys.AI_CONFIG_READ,
    title: 'menu.aiPromptTemplates',
  },
  {
    component: lazyRouteComponent(() => import('./pages/Skills'), 'Skills'),
    icon: GraduationCap,
    id: 'ai.skills',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 8 },
    path: '/ai/skills',
    permission: PermissionKeys.AI_CONFIG_READ,
    title: 'menu.aiSkills',
  },
  {
    component: lazyRouteComponent(() => import('./pages/AiSettings'), 'AiSettings'),
    icon: Bot,
    id: 'ai.settings',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 9 },
    path: '/ai/settings',
    title: 'menu.aiSettings',
  },
  {
    component: lazyRouteComponent(() => import('./pages/AiProviders'), 'AiProviders'),
    icon: SlidersHorizontal,
    id: 'ai.providers',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 10 },
    path: '/ai/providers',
    permission: PermissionKeys.AI_CONFIG_READ,
    title: 'menu.aiProviders',
  },
  {
    component: lazyRouteComponent(() => import('./pages/AiUsageAudit'), 'AiUsageAudit'),
    icon: BarChart3,
    id: 'ai.usage',
    layout: { contentWidth: 'full' },
    menu: { group: 'ai', order: 10 },
    path: '/ai/usage',
    permission: PermissionKeys.AI_USAGE_READ,
    title: 'menu.aiUsage',
  },
]
