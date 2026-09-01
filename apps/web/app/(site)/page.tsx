import { ArrowDown, FileText, FolderKanban, UserRound } from 'lucide-react'
import Link from 'next/link'
import { BlurText } from '@web/components/react-bits/blur-text'
import { ClickSpark } from '@web/components/react-bits/click-spark'
import { Magnet } from '@web/components/react-bits/magnet'
import { ShinyText } from '@web/components/react-bits/shiny-text'
import { SpotlightCard } from '@web/components/react-bits/spotlight-card'
import { Squares } from '@web/components/react-bits/squares'
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
      <section className="relative overflow-hidden border-b border-border-subtle/40">
        <Squares
          borderColor="rgba(255, 255, 255, 0.06)"
          className="opacity-80"
          direction="diagonal"
          hoverFillColor="rgba(235, 111, 146, 0.12)"
          speed={0.35}
          squareSize={44}
        />
        <div className="site-container relative z-10 grid min-h-[76dvh] items-center gap-12 py-16 md:grid-cols-[minmax(0,1.5fr)_minmax(15rem,0.5fr)] md:py-20">
          <div>
            <div className="inline-flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                <ShinyText shimmerWidth={120} speed={4} text="TypeScript / Next.js / Hono" />
              </span>
            </div>
            <div className="mt-5">
              <BlurText
                animateBy="letters"
                className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl"
                delay={100}
                text="Starter"
              />
            </div>
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
            <div className="mt-10">
              <Magnet magnetStrength={0.25} padding={25}>
                <Button
                  asChild
                  className="justify-start gap-2 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                  variant="ghost"
                >
                  <a href="#site-sections">
                    查看站点入口
                    <ArrowDown aria-hidden="true" size={16} />
                  </a>
                </Button>
              </Magnet>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-y border-border-subtle bg-surface-muted/55" id="site-sections">
        <div className="site-container grid gap-4 py-10 md:grid-cols-3 md:gap-5 md:py-14">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <ClickSpark key={section.href} sparkColor="rgba(235, 111, 146, 0.7)" sparkCount={10}>
                <Link
                  className="block h-full focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                  href={section.href}
                >
                  <SpotlightCard
                    className="group flex h-full min-h-64 flex-col border border-border-subtle bg-card px-6 py-8 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md md:px-7"
                    spotlightColor="rgba(235, 111, 146, 0.16)"
                    spotlightRadius={280}
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
                  </SpotlightCard>
                </Link>
              </ClickSpark>
            )
          })}
        </div>
      </section>
    </main>
  )
}
