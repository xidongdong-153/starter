'use client'

import type { AuthConfig } from '@starter/contracts'
import { ArrowRight, GitBranch } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getAuthConfig } from '@web/lib/api/auth-config.api'
import { apiUrl, authClient } from '@web/lib/auth-client'

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        if (active) setProviders(null)
      })

    return () => {
      active = false
    }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)

    try {
      const result =
        mode === 'login'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name })

      if (result.error) {
        setError(result.error.message ?? '账户操作失败，请检查填写内容。')
        return
      }

      window.location.href = apiUrl === 'http://localhost:7788' ? 'http://localhost:2333' : '/'
    } catch {
      setError('认证服务暂时不可用，请稍后再试。')
    } finally {
      setPending(false)
    }
  }

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
  const submitLabel = mode === 'login' ? '登录' : '注册'

  return (
    <section className="w-full max-w-md rounded-md border border-border bg-surface p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold text-primary">Starter Account</p>
      <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">使用邮箱和密码访问个人资料与文件。</p>

      <form className="mt-8 grid gap-5" onSubmit={submit}>
        {mode === 'register' ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="name">
              显示名
            </label>
            <input
              autoComplete="name"
              className="min-h-11 w-full rounded-sm border border-border bg-background px-3 text-foreground outline-none transition-colors placeholder:text-subtle-foreground focus:border-primary focus:ring-2 focus:ring-ring"
              id="name"
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>
        ) : null}

        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="email">
            邮箱
          </label>
          <input
            autoComplete="email"
            className="min-h-11 w-full rounded-sm border border-border bg-background px-3 text-foreground outline-none transition-colors placeholder:text-subtle-foreground focus:border-primary focus:ring-2 focus:ring-ring"
            id="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="password">
            密码
          </label>
          <input
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="min-h-11 w-full rounded-sm border border-border bg-background px-3 text-foreground outline-none transition-colors placeholder:text-subtle-foreground focus:border-primary focus:ring-2 focus:ring-ring"
            id="password"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </div>

        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          disabled={pending}
          type="submit"
        >
          {pending ? '处理中' : submitLabel}
          <ArrowRight aria-hidden="true" size={17} />
        </button>
      </form>

      {error ? (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {providers?.github || providers?.google ? (
        <div className="mt-6 border-t border-border-subtle pt-6">
          <p className="mb-3 text-xs text-muted-foreground">也可以使用已启用的第三方账户</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.github ? (
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-border bg-background px-3 text-sm transition-colors hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                disabled={pending}
                onClick={() => social('github')}
                type="button"
              >
                <GitBranch aria-hidden="true" size={17} />
                GitHub
              </button>
            ) : null}
            {providers.google ? (
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-sm border border-border bg-background px-3 text-sm transition-colors hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                disabled={pending}
                onClick={() => social('google')}
                type="button"
              >
                Google
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-7 text-sm text-muted-foreground">
        {mode === 'login' ? '还没有账户？' : '已经有账户？'}{' '}
        <Link
          className="font-medium text-primary underline decoration-transparent underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          href={mode === 'login' ? '/register' : '/login'}
        >
          {mode === 'login' ? '注册新账户' : '去登录'}
        </Link>
      </p>
    </section>
  )
}
