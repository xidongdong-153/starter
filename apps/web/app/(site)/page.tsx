import { ArrowDown, FileText, FolderKanban, UserRound } from 'lucide-react'
import Link from 'next/link'
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
          <a
            className="mt-10 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            href="#site-sections"
          >
            查看站点入口
            <ArrowDown aria-hidden="true" size={16} />
          </a>
        </aside>
      </section>

      <section className="border-y border-border-subtle bg-surface-muted/55" id="site-sections">
        <div className="site-container grid md:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <Link
                className="group min-h-64 border-b border-border-subtle py-10 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary md:border-b-0 md:border-r md:px-7 md:first:pl-0 md:last:border-r-0 md:last:pr-0"
                href={section.href}
                key={section.href}
              >
                <div className="flex items-center justify-between text-xs text-subtle-foreground">
                  <span>{section.index}</span>
                  <Icon aria-hidden="true" size={18} strokeWidth={1.6} />
                </div>
                <h2 className="mt-12 text-2xl font-semibold">{section.title}</h2>
                <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{section.description}</p>
                <span className="mt-8 inline-flex text-sm font-medium text-primary transition-transform group-hover:translate-x-1">
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
