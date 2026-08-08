export default function Loading() {
  return (
    <main aria-live="polite" className="site-container grid min-h-[60dvh] place-items-center py-20">
      <div className="w-full max-w-xl border-y border-border py-10">
        <p className="text-sm font-semibold text-primary">LOADING</p>
        <p className="mt-4 text-lg text-muted-foreground">正在读取页面…</p>
      </div>
    </main>
  )
}
