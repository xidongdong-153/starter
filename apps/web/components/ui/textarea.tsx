import type * as React from 'react'

import { cn } from '@web/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full border border-input bg-surface px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  )
}

export { Textarea }
