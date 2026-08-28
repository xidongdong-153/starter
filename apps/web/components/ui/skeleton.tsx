import type * as React from 'react'

import { cn } from '@web/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse bg-surface-muted', className)} data-slot="skeleton" {...props} />
}

export { Skeleton }
