'use client'

import { FileText, FolderKanban, Home, Menu, Search, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const navItems = [
  { href: '/', icon: Home, label: '首页' },
  { href: '/writing', icon: FileText, label: '文稿' },
  { href: '/projects', icon: FolderKanban, label: '项目' },
  { href: '/search', icon: Search, label: '搜索' },
] as const

export function SiteNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const firstLinkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstLinkRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      menuButtonRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function isActive(href: string): boolean {
    return href === '/' ? pathname === href : pathname.startsWith(href)
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <nav
        aria-label="站点导航"
        className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between rounded-md border border-border bg-surface/95 px-2 shadow-sm backdrop-blur-md"
      >
        <Link
          aria-label="回到首页"
          className="flex h-10 items-center gap-2 rounded-sm px-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          href="/"
        >
          <span className="grid size-6 place-items-center rounded-sm bg-primary text-xs text-primary-foreground">
            S
          </span>
          <span>Starter</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`rounded-sm px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                isActive(item.href)
                  ? 'bg-surface-muted text-foreground'
                  : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
              }`}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <button
          aria-expanded={open}
          aria-label={open ? '关闭菜单' : '打开菜单'}
          className="grid size-10 place-items-center rounded-sm text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:hidden"
          onClick={() => setOpen((current) => !current)}
          ref={menuButtonRef}
          type="button"
        >
          {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>
      </nav>

      {open ? (
        <>
          <button
            aria-label="关闭菜单"
            className="fixed inset-0 -z-10 cursor-default bg-background/80 backdrop-blur-sm md:hidden"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div className="mx-auto mt-2 grid w-full max-w-4xl gap-1 rounded-md border border-border bg-surface p-2 shadow-lg md:hidden">
            {navItems.map((item, index) => {
              const Icon = item.icon
              return (
                <Link
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-sm px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    isActive(item.href)
                      ? 'bg-surface-muted text-foreground'
                      : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
                  }`}
                  href={item.href}
                  key={item.href}
                  ref={index === 0 ? firstLinkRef : undefined}
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </>
      ) : null}
    </header>
  )
}
