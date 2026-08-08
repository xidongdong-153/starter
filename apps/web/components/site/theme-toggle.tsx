'use client'

import type { ThemeSetting } from '@web/lib/theme'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@web/hooks/use-theme'

const options: Array<{
  icon: typeof Sun
  label: string
  value: ThemeSetting
}> = [
  { icon: Sun, label: '浅色主题', value: 'dawn' },
  { icon: Monitor, label: '跟随系统', value: 'system' },
  { icon: Moon, label: '深色主题', value: 'moon' },
]

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()

  return (
    <div
      aria-label="选择主题"
      className="inline-flex h-10 items-center gap-1 rounded-md border border-border bg-surface-muted p-1"
      role="group"
    >
      {options.map((option) => {
        const Icon = option.icon
        const selected = theme === option.value
        return (
          <button
            aria-label={option.label}
            aria-pressed={selected}
            className={`grid size-8 place-items-center rounded-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              selected
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-surface hover:text-foreground'
            }`}
            key={option.value}
            onClick={() => setTheme(option.value)}
            title={option.label}
            type="button"
          >
            <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        )
      })}
    </div>
  )
}
