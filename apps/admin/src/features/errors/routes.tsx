import type { AdminRouteRecord } from '@admin/app/router/types'

import { NotFound } from './pages/NotFound'

export const errorRoutes: AdminRouteRecord[] = [
  {
    component: NotFound,
    id: 'errors.notFound',
    menu: false,
    path: '/404',
    tab: false,
    title: 'error.notFound.title',
  },
]
