import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { ThemeToggle } from '@web/components/site/theme-toggle'
import { Button } from '@web/components/ui/button'

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="site-container flex min-h-20 items-center justify-between gap-4">
        <Button
          asChild
          className="justify-start gap-2 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
          variant="ghost"
        >
          <Link href="/">
            <ArrowLeft aria-hidden="true" size={17} />
            回到首页
          </Link>
        </Button>
        <ThemeToggle />
      </header>
      {children}
    </div>
  )
}
