'use client'

import type { AuthConfig } from '@starter/contracts'
import { ArrowRight, GitBranch, Globe2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getAuthConfig } from '@web/lib/api/auth-config.api'
import { authClient } from '@web/lib/auth-client'
import { Button } from '@web/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@web/components/ui/card'

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [providers, setProviders] = useState<AuthConfig['providers'] | null>(null)

  useEffect(() => {
    let active = true
    void getAuthConfig()
      .then((config) => {
        if (active) setProviders(config.providers)
      })
      .catch(() => {
        if (active) setError('认证配置暂时不可用，请稍后再试。')
      })

    return () => {
      active = false
    }
  }, [])

  async function social(provider: 'github' | 'google') {
    setPending(true)
    setError('')

    try {
      const result = await authClient.signIn.social({ provider, callbackURL: window.location.origin })
      if (result.error) setError(result.error.message ?? '无法开始第三方登录。')
    } catch {
      setError('认证服务暂时不可用，请稍后再试。')
    } finally {
      setPending(false)
    }
  }

  const title = mode === 'login' ? '登录账户' : '创建账户'
  const description = mode === 'login' ? '使用 GitHub 或 Google 登录。' : '使用 GitHub 或 Google 创建账户。'
  const hasProvider = providers?.github || providers?.google

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <p className="text-xs font-semibold text-primary">Starter Account</p>
        <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
        <CardDescription className="leading-6">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {providers === null ? (
            <p className="text-sm text-muted-foreground">正在加载可用的登录方式。</p>
          ) : hasProvider ? (
            <>
              {providers.github ? (
                <Button disabled={pending} onClick={() => void social('github')} type="button" variant="outline">
                  <GitBranch aria-hidden="true" size={17} />
                  使用 GitHub{mode === 'login' ? ' 登录' : ' 注册'}
                </Button>
              ) : null}
              {providers.google ? (
                <Button disabled={pending} onClick={() => void social('google')} type="button" variant="outline">
                  <Globe2 aria-hidden="true" size={17} />
                  使用 Google{mode === 'login' ? ' 登录' : ' 注册'}
                </Button>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">当前没有已配置的第三方登录方式。</p>
          )}
        </div>

        {error ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <p className="mt-6 text-sm text-muted-foreground">
          {mode === 'login' ? '还没有账户？' : '已经有账户？'}{' '}
          <Link
            className="inline-flex items-center gap-1 font-medium text-primary underline decoration-transparent underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            href={mode === 'login' ? '/register' : '/login'}
          >
            {mode === 'login' ? '去注册' : '去登录'}
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
