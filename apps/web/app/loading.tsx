import { Skeleton } from '@web/components/ui/skeleton'

export default function Loading() {
  return (
    <main aria-live="polite" className="site-container grid min-h-[60dvh] place-items-center py-20">
      <div className="w-full max-w-xl border-y border-border py-10">
        <p className="text-sm font-semibold text-primary">LOADING</p>
        <p className="mt-4 text-lg text-muted-foreground">正在读取页面…</p>
        <div aria-hidden="true" className="mt-6 grid gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </main>
  )
}
