import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="site-container grid min-h-[70dvh] place-items-center py-20">
      <section className="w-full max-w-2xl border-y border-border py-10">
        <p className="text-sm font-semibold text-primary">404 / NOT FOUND</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">找不到这个页面</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">链接可能已经失效，或者公开资料不存在。</p>
        <Link
          className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-5 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          回到首页
        </Link>
      </section>
    </main>
  )
}
