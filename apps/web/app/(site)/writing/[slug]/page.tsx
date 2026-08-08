import type { Metadata } from 'next'
import { ArrowLeft, FileText } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '文稿暂不可用',
  description: 'Starter 文章详情入口。',
}

export default async function WritingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await params

  return (
    <main className="page-enter reading-container py-12 md:py-20">
      <Link
        className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        href="/writing"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        返回文稿
      </Link>
      <article className="mt-14 border-t border-border pt-8 md:mt-20 md:pt-10">
        <p className="text-sm font-semibold text-primary">WRITING / UNAVAILABLE</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">这篇文稿暂不可用</h1>
        <p className="mt-6 text-base leading-8 text-muted-foreground">
          Starter 当前没有文章读取接口，也没有本地文章数据。文章发布能力接入前，这个入口只保留页面结构和返回路径。
        </p>
        <div className="mt-10 flex items-center gap-3 border-y border-border-subtle py-5 text-sm text-muted-foreground">
          <FileText aria-hidden="true" size={17} />
          <span>尚未发布可读取的正文</span>
        </div>
      </article>
    </main>
  )
}
