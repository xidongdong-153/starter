import type { AdminRouteRecord } from '@admin/app/router/types'

import { lazyRouteComponent } from '@tanstack/react-router'
import { AlertTriangle, LayoutTemplate, Lock, Search, Settings2 } from 'lucide-react'

export const exampleRoutes: AdminRouteRecord[] = [
  {
    component: lazyRouteComponent(() => import('./pages/UiShowcase'), 'UiShowcase'),
    icon: LayoutTemplate,
    id: 'examples.uiShowcase',
    layout: {
      contentWidth: 'full',
    },
    menu: {
      group: 'examples',
      order: 10,
    },
    path: '/ui-showcase',
    title: 'menu.uiShowcase',
  },
  {
    component: lazyRouteComponent(() => import('./pages/EnvExample'), 'EnvExample'),
    icon: Settings2,
    id: 'examples.env',
    menu: {
      group: 'examples',
      order: 20,
    },
    path: '/env-example',
    title: 'menu.envExample',
  },
  {
    component: lazyRouteComponent(() => import('./pages/ErrorStateExample'), 'ErrorStateExample'),
    icon: AlertTriangle,
    id: 'examples.errorState',
    menu: {
      group: 'examples',
      order: 30,
    },
    path: '/error-example',
    title: 'menu.errorExample',
  },
  {
    component: lazyRouteComponent(() => import('./pages/ForbiddenExample'), 'ForbiddenExample'),
    icon: Lock,
    id: 'examples.forbidden',
    menu: {
      group: 'examples',
      order: 40,
    },
    path: '/forbidden-example',
    title: 'menu.forbiddenExample',
  },
  {
    component: lazyRouteComponent(() => import('./pages/NotFoundExample'), 'NotFoundExample'),
    icon: Search,
    id: 'examples.notFound',
    menu: {
      group: 'examples',
      order: 50,
    },
    path: '/not-found-example',
    title: 'menu.notFoundExample',
  },
]
