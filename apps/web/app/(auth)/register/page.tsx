import type { Metadata } from 'next'
import { AuthForm } from '@web/components/auth/auth-form'

export const metadata: Metadata = {
  title: '注册',
  description: '创建 Starter 账户。',
}

export default function RegisterPage() {
  return (
    <main className="page-enter site-container grid min-h-[calc(100dvh-5rem)] place-items-center py-10">
      <AuthForm mode="register" />
    </main>
  )
}
