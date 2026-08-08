'use client'

import { ArrowRight, ExternalLink, LogOut, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { authClient } from '@web/lib/auth-client'

const primaryAction =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-primary px-5 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary'
const secondaryAction =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-border bg-surface px-5 font-medium transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary'

export function SessionHome() {
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    void authClient.getSession()
  }, [])

  if (isPending) {
    return (
      <div aria-live="polite" className="mt-8 border-t border-border-subtle pt-6 text-sm text-muted-foreground">
        正在读取登录状态…
      </div>
    )
  }

  if (session?.user) {
    return (
      <div className="mt-8 border-t border-border-subtle pt-6">
        <p className="text-sm text-muted-foreground">
          当前账户：<span className="font-medium text-foreground">{session.user.name}</span>
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a className={primaryAction} href="http://localhost:2333" rel="noopener noreferrer" target="_blank">
            进入 Admin
            <ExternalLink aria-hidden="true" size={16} />
          </a>
          <Link className={secondaryAction} href={`/profiles/${session.user.id}`}>
            <UserRound aria-hidden="true" size={16} />
            查看公开资料
          </Link>
          <button
            className={secondaryAction}
            onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => window.location.reload() } })}
            type="button"
          >
            <LogOut aria-hidden="true" size={16} />
            退出
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 border-t border-border-subtle pt-6">
      <p className="text-sm text-muted-foreground">登录后可以进入 Admin，并直接打开自己的公开资料页。</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link className={primaryAction} href="/login">
          登录
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
        <Link className={secondaryAction} href="/register">
          注册
        </Link>
        <Link className={secondaryAction} href="/profiles">
          查看公开资料
        </Link>
      </div>
    </div>
  )
}
