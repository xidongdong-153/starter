import type { Metadata } from 'next'
import { FolderKanban } from 'lucide-react'
import { EmptyState } from '@web/app/(site)/_components/placeholder/empty-state'

export const metadata: Metadata = {
  title: '项目',
  description: 'Starter 项目入口。',
}

export default function ProjectsPage() {
  return (
    <main className="page-enter site-container py-12 md:py-20">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-primary">PROJECTS / 02</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">项目</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          项目列表入口已经保留，当前 Starter API 还没有项目接口。
        </p>
        <div className="mt-12">
          <EmptyState
            description="当前没有公开项目。接入真实项目 API 后，这里会显示项目详情和公开链接。"
            eyebrow="EMPTY STATE"
            href="/"
            icon={<FolderKanban aria-hidden="true" size={28} strokeWidth={1.5} />}
            linkLabel="回到首页"
            title="当前没有公开项目"
          />
        </div>
      </div>
    </main>
  )
}
