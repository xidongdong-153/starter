'use client'

import { RefreshCw } from 'lucide-react'
import Link from 'next/link'

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
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-5 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            onClick={reset}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            重新加载
          </button>
          <Link
            className="inline-flex min-h-11 items-center rounded-sm border border-border bg-surface px-5 font-medium transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            href="/"
          >
            回到首页
          </Link>
        </div>
      </section>
    </main>
  )
}
