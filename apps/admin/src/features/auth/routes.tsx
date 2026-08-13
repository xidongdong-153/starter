import type { AdminRouteRecord } from '@admin/app/router/types'

import { ForgotPassword } from './pages/ForgotPassword'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { ResetPassword } from './pages/ResetPassword'
import { VerifyEmail } from './pages/VerifyEmail'

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
  {
    component: ForgotPassword,
    id: 'forgot-password',
    menu: false,
    path: '/forgot-password',
    tab: false,
    title: 'auth.forgotPasswordTitle',
  },
  {
    component: ResetPassword,
    id: 'reset-password',
    menu: false,
    path: '/reset-password',
    tab: false,
    title: 'auth.resetPasswordTitle',
  },
  {
    component: VerifyEmail,
    id: 'verify-email',
    menu: false,
    path: '/verify-email',
    tab: false,
    title: 'auth.verifyEmailTitle',
  },
]
