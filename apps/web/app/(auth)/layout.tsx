import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { ThemeToggle } from '@web/components/site/theme-toggle'

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="site-container flex min-h-20 items-center justify-between gap-4">
        <Link
          className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          回到首页
        </Link>
        <ThemeToggle />
      </header>
      {children}
    </div>
  )
}
