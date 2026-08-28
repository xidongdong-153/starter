import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@web/lib/utils'

const badgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1 border px-2 py-0.5 text-xs font-semibold tracking-wide whitespace-nowrap uppercase transition-colors [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} data-slot="badge" {...props} />
}

export { Badge, badgeVariants }
