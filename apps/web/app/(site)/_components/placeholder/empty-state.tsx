import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'

export function EmptyState({
  description,
  eyebrow,
  href,
  icon,
  linkLabel,
  title,
}: {
  description: string
  eyebrow: string
  href: string
  icon: ReactNode
  linkLabel: string
  title: string
}) {
  return (
    <section className="border-y border-border py-10 md:py-14">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Badge variant="secondary">{eyebrow}</Badge>
          <h2 className="mt-4 text-3xl font-semibold">{title}</h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">{description}</p>
          <Button
            asChild
            className="mt-8 justify-start gap-2 transition-transform hover:translate-x-1 hover:no-underline"
            variant="link"
          >
            <Link href={href}>
              {linkLabel}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </Button>
        </div>
        <span aria-hidden="true" className="shrink-0 text-primary">
          {icon}
        </span>
      </div>
    </section>
  )
}
