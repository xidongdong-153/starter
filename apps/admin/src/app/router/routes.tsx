import type { QueryClient } from '@tanstack/react-query'

import {
  requireAdminRoutePermission,
  resolveAdminRouteAccess,
  throwAdminRouteRedirect,
} from '@admin/app/router/auth-guard'
import { appRouteRecords, authRouteRecords } from '@admin/app/router/records'
import { ErrorBoundary } from '@admin/components/ui'
import { NotFound } from '@admin/features/errors/pages/NotFound'
import { RootLayout } from '@admin/layout'
import { createRootRouteWithContext, createRoute, Outlet } from '@tanstack/react-router'

export interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: ErrorBoundary,
  notFoundComponent: NotFound,
})

const appLayoutRoute = createRoute({
  component: RootLayout,
  getParentRoute: () => rootRoute,
  id: 'app-layout',
  async beforeLoad() {
    throwAdminRouteRedirect(await resolveAdminRouteAccess())
  },
})

function toRoutePath(path: string) {
  return path === '/' ? path : path.replace(/^\//, '')
}

const appRoutes = appRouteRecords.map((record) =>
  createRoute({
    component: record.component,
    getParentRoute: () => appLayoutRoute,
    path: toRoutePath(record.path),
    async beforeLoad({ context }) {
      if (record.permission) {
        await requireAdminRoutePermission(context.queryClient, record.permission)
      }
    },
    staticData: {
      icon: record.icon,
      id: record.id,
      layout: record.layout,
      permission: record.permission,
      tab: record.tab,
      title: record.title,
    },
  }),
)

const authRoutes = authRouteRecords.map((record) =>
  createRoute({
    component: record.component,
    getParentRoute: () => rootRoute,
    path: toRoutePath(record.path),
    staticData: {
      icon: record.icon,
      id: record.id,
      layout: record.layout,
      tab: record.tab,
      title: record.title,
    },
  }),
)

export const routeTree = rootRoute.addChildren([...authRoutes, appLayoutRoute.addChildren(appRoutes)])
