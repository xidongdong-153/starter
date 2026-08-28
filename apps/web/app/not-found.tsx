import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@web/components/ui/button'

export default function NotFound() {
  return (
    <main className="site-container grid min-h-[70dvh] place-items-center py-20">
      <section className="w-full max-w-2xl border-y border-border py-10">
        <p className="text-sm font-semibold text-primary">404 / NOT FOUND</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">找不到这个页面</h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">链接可能已经失效，或者公开资料不存在。</p>
        <Button asChild className="mt-8 font-semibold transition-transform hover:-translate-y-0.5">
          <Link href="/">
            <ArrowLeft aria-hidden="true" size={16} />
            回到首页
          </Link>
        </Button>
      </section>
    </main>
  )
}
