import type { Metadata } from 'next'
import { Search } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@web/components/ui/button'

export const metadata: Metadata = {
  title: '搜索',
  description: 'Starter 搜索入口。',
}

export default function SearchPage() {
  return (
    <main className="page-enter site-container py-12 md:py-20">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-primary">SEARCH / 03</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">搜索</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          搜索输入位置已经保留，当前没有可提交的搜索接口。
        </p>
        <div className="mt-12 border-y border-border py-10">
          <label className="sr-only" htmlFor="search-query">
            搜索关键词
          </label>
          <div className="flex min-h-12 items-center gap-3 border border-border bg-surface-muted px-4 text-muted-foreground">
            <Search aria-hidden="true" size={18} />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
              disabled
              id="search-query"
              placeholder="搜索功能尚未接入"
              type="search"
            />
          </div>
          <p className="mt-5 text-sm text-muted-foreground">当前没有搜索服务，不会发送请求，也不会显示假搜索结果。</p>
          <Button asChild className="mt-8 justify-start" variant="link">
            <Link href="/writing">浏览文稿入口</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
