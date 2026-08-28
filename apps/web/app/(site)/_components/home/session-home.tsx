'use client'

import { ArrowRight, ExternalLink, LogOut, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { authClient } from '@web/lib/auth-client'
import { Button } from '@web/components/ui/button'

export function SessionHome() {
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    // API 连不上时 getSession 会 reject，这里只是触发一次同步，失败交给 useSession 的状态展示。
    void authClient.getSession().catch(() => {})
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
          <Button asChild className="font-semibold transition-transform hover:-translate-y-0.5">
            <a href="http://localhost:2333" rel="noopener noreferrer" target="_blank">
              进入 Admin
              <ExternalLink aria-hidden="true" size={16} />
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/profiles/${session.user.id}`}>
              <UserRound aria-hidden="true" size={16} />
              查看公开资料
            </Link>
          </Button>
          <Button
            onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => window.location.reload() } })}
            type="button"
            variant="outline"
          >
            <LogOut aria-hidden="true" size={16} />
            退出
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 border-t border-border-subtle pt-6">
      <p className="text-sm text-muted-foreground">登录后可以进入 Admin，并直接打开自己的公开资料页。</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild className="font-semibold transition-transform hover:-translate-y-0.5">
          <Link href="/login">
            登录
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">注册</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/profiles">查看公开资料</Link>
        </Button>
      </div>
    </div>
  )
}
