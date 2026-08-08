import type { AdminRouteRecord } from '@admin/app/router/types'

import { House } from 'lucide-react'

import { Home } from './pages/Home'

export const homeRoute: AdminRouteRecord = {
  component: Home,
  icon: House,
  id: 'home',
  layout: {
    contentWidth: 'full',
  },
  path: '/',
  tab: {
    closable: false,
  },
  title: 'menu.home',
}

export const homeRoutes: AdminRouteRecord[] = [homeRoute]
