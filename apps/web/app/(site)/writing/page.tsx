import type { Metadata } from 'next'
import { FileText } from 'lucide-react'
import { EmptyState } from '@web/app/(site)/_components/placeholder/empty-state'

export const metadata: Metadata = {
  title: '文稿',
  description: 'Starter 文稿入口。',
}

export default function WritingPage() {
  return (
    <main className="page-enter site-container py-12 md:py-20">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-primary">WRITING / 01</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">文稿</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          文章列表入口已经保留，当前 Starter API 还没有文章接口。
        </p>
        <div className="mt-12">
          <EmptyState
            description="当前还没有文章。接入真实文章 API 后，这里会显示已公开的文稿。"
            eyebrow="EMPTY STATE"
            href="/"
            icon={<FileText aria-hidden="true" size={28} strokeWidth={1.5} />}
            linkLabel="回到首页"
            title="当前还没有文章"
          />
        </div>
      </div>
    </main>
  )
}
