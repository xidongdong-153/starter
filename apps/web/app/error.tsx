'use client'

import { RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@web/components/ui/button'

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 text-foreground">
      <section className="w-full max-w-xl border-y border-border py-10">
        <p className="text-sm font-semibold text-danger">页面读取失败</p>
        <h1 className="mt-4 text-4xl font-semibold">这次没有加载成功</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          页面或 API 请求失败。可以重新加载，或者先回到首页。
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button className="font-semibold transition-transform hover:-translate-y-0.5" onClick={reset} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            重新加载
          </Button>
          <Button asChild variant="outline">
            <Link href="/">回到首页</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
