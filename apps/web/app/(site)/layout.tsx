import { SiteFooter } from './_components/site/site-footer'
import { SiteNav } from './_components/site/site-nav'

export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <SiteNav />
      <div className="flex flex-1 flex-col pt-24">{children}</div>
      <SiteFooter />
    </div>
  )
}
