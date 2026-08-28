'use client'

import type { ThemeSetting } from '@web/lib/theme'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@web/hooks/use-theme'
import { Button } from '@web/components/ui/button'

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
      className="inline-flex h-10 items-center gap-1 border border-border bg-surface-muted p-1"
      role="group"
    >
      {options.map((option) => {
        const Icon = option.icon
        const selected = theme === option.value
        return (
          <Button
            aria-label={option.label}
            aria-pressed={selected}
            className={`size-8 ${
              selected
                ? 'bg-surface text-foreground shadow-sm hover:bg-surface'
                : 'text-muted-foreground hover:bg-surface hover:text-foreground'
            }`}
            key={option.value}
            onClick={() => setTheme(option.value)}
            size="icon"
            title={option.label}
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
          </Button>
        )
      })}
    </div>
  )
}
