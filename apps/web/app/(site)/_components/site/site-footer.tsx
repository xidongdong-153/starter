'use client'

import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@web/components/site/theme-toggle'

const currentYear = new Date().getFullYear()

export function SiteFooter() {
  const pathname = usePathname()

  // 对话页面作为全屏工作区，不渲染底部通栏以避免产生外层滚动条
  if (pathname.startsWith('/chat')) {
    return null
  }

  return (
    <footer className="mt-20 border-t border-border-subtle py-10">
      <div className="site-container flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <Link
            className="inline-flex text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            href="/"
          >
            Starter
          </Link>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            个人资料、文件与公开页面的 TypeScript 全栈脚手架。
          </p>
          <p className="mt-5 text-xs text-subtle-foreground">© {currentYear} Starter</p>
        </div>

        <div className="flex flex-col items-start gap-5 md:items-end">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-muted-foreground">
            <Link
              className="hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              href="/writing"
            >
              文稿
            </Link>
            <Link
              className="hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              href="/projects"
            >
              项目
            </Link>
            <Link
              className="hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              href="/profiles"
            >
              公开资料
            </Link>
            <a
              className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              href="http://localhost:2333"
              rel="noopener noreferrer"
              target="_blank"
            >
              Admin <ExternalLink aria-hidden="true" size={13} />
            </a>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}
