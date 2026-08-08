import type { ReactNode } from 'react'

import { Pattern } from '@admin/components/ui'
import { LanguageButton } from '@admin/layout/atoms/LanguageButton'
import { ThemeToggle } from '@admin/layout/atoms/ThemeToggle'

interface AuthContainerProps {
  children: ReactNode
}

/**
 * 登录、注册页的外层容器
 */
export function AuthContainer({ children }: AuthContainerProps) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      <Pattern animationDuration={6} />

      <div className="absolute top-4 right-4 z-20 flex items-center gap-2 md:top-6 md:right-6">
        <div className="text-fg-muted hover:bg-surface-muted rounded-lg p-2 transition-colors">
          <LanguageButton />
        </div>
        <div className="text-fg-muted hover:bg-surface-muted rounded-lg p-2 transition-colors">
          <ThemeToggle />
        </div>
      </div>

      <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="border-border bg-surface/86 flex w-full max-w-md flex-col justify-center rounded-xl border p-6 shadow-lg shadow-black/5 backdrop-blur-sm sm:p-8">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  )
}
