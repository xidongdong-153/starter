import type { AdminRouteRecord } from '@admin/app/router/types'

import { Login } from './pages/Login'
import { Register } from './pages/Register'

export const authRoutes: AdminRouteRecord[] = [
  {
    component: Login,
    id: 'login',
    menu: false,
    path: '/login',
    tab: false,
    title: 'auth.loginTitle',
  },
  {
    component: Register,
    id: 'register',
    menu: false,
    path: '/register',
    tab: false,
    title: 'auth.registerTitle',
  },
]
