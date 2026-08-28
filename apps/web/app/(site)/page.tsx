import { ArrowDown, FileText, FolderKanban, UserRound } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import { SessionHome } from './_components/home/session-home'

const sections = [
  {
    description: '文章接口尚未接入，路由保留为清晰的空状态。',
    href: '/writing',
    icon: FileText,
    index: '01',
    title: '文稿',
  },
  {
    description: '项目接口尚未接入，当前不展示虚构项目。',
    href: '/projects',
    icon: FolderKanban,
    index: '02',
    title: '项目',
  },
  {
    description: '使用用户 ID 打开 API 提供的真实公开资料。',
    href: '/profiles',
    icon: UserRound,
    index: '03',
    title: '公开资料',
  },
] as const

export default function HomePage() {
  return (
    <main className="page-enter flex-1">
      <section className="site-container grid min-h-[76dvh] items-center gap-12 py-16 md:grid-cols-[minmax(0,1.5fr)_minmax(15rem,0.5fr)] md:py-20">
        <div>
          <p className="text-sm font-semibold text-primary">TypeScript / Next.js / Hono</p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.05] sm:text-6xl md:text-7xl">Starter</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
            个人资料、文件与公开页面的全栈脚手架。公开站点负责展示，Admin 负责资料与文件维护。
          </p>
          <SessionHome />
        </div>

        <aside className="border-l border-border pl-6" aria-label="站点说明">
          <p className="text-xs text-subtle-foreground">SITE / 00</p>
          <dl className="mt-8 grid gap-6 text-sm">
            <div>
              <dt className="text-muted-foreground">Web</dt>
              <dd className="mt-1 font-medium">localhost:4399</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Admin</dt>
              <dd className="mt-1 font-medium">localhost:2333</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">API</dt>
              <dd className="mt-1 font-medium">localhost:7788</dd>
            </div>
          </dl>
          <Button
            asChild
            className="mt-10 justify-start gap-2 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
            variant="ghost"
          >
            <a href="#site-sections">
              查看站点入口
              <ArrowDown aria-hidden="true" size={16} />
            </a>
          </Button>
        </aside>
      </section>

      <section className="border-y border-border-subtle bg-surface-muted/55" id="site-sections">
        <div className="site-container grid gap-4 py-10 md:grid-cols-3 md:gap-5 md:py-14">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <Link
                className="group flex min-h-64 flex-col border border-border-subtle bg-card px-6 py-8 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary md:px-7"
                href={section.href}
                key={section.href}
              >
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{section.index}</Badge>
                  <Icon aria-hidden="true" size={18} strokeWidth={1.6} />
                </div>
                <h2 className="mt-12 text-2xl font-semibold">{section.title}</h2>
                <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{section.description}</p>
                <span className="mt-auto inline-flex pt-8 text-sm font-medium text-primary transition-transform group-hover:translate-x-1">
                  打开页面 →
                </span>
              </Link>
            )
          })}
        </div>
      </section>
    </main>
  )
}
