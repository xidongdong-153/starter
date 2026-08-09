import type { AdminRouteRecord } from '@admin/app/router/types'

import { Forbidden } from './pages/Forbidden'
import { NotFound } from './pages/NotFound'

export const errorRoutes: AdminRouteRecord[] = [
  {
    component: Forbidden,
    id: 'errors.forbidden',
    menu: false,
    path: '/403',
    tab: false,
    title: 'error.forbidden.title',
  },
  {
    component: NotFound,
    id: 'errors.notFound',
    menu: false,
    path: '/404',
    tab: false,
    title: 'error.notFound.title',
  },
]
