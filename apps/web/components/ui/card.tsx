import type * as React from 'react'

import { cn } from '@web/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-6 border border-border-subtle bg-card py-6 text-card-foreground shadow-sm',
        className,
      )}
      data-slot="card"
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 px-6', className)} data-slot="card-header" {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-xl leading-none font-semibold', className)} data-slot="card-title" {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm text-muted-foreground', className)} data-slot="card-description" {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-6', className)} data-slot="card-content" {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center px-6', className)} data-slot="card-footer" {...props} />
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
