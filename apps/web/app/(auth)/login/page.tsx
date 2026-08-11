import type { Metadata } from 'next'
import { AuthForm } from '@web/components/auth/auth-form'

export const metadata: Metadata = {
  title: '登录',
  description: '使用 GitHub 或 Google 登录 Starter 账户。',
}

export default function LoginPage() {
  return (
    <main className="page-enter site-container grid min-h-[calc(100dvh-5rem)] place-items-center py-10">
      <AuthForm mode="login" />
    </main>
  )
}
