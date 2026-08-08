import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

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
          <p className="text-xs font-semibold text-primary">{eyebrow}</p>
          <h2 className="mt-4 text-3xl font-semibold">{title}</h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">{description}</p>
          <Link
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-medium text-primary transition-transform hover:translate-x-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            href={href}
          >
            {linkLabel}
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
        <span aria-hidden="true" className="shrink-0 text-primary">
          {icon}
        </span>
      </div>
    </section>
  )
}
