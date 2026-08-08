import { ResponsiveTooltip } from '@admin/components/ui'
import { useSettingStore } from '@admin/stores/modules/setting'
import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ThemeToggleProps {
  className?: string
}

/**
 * 浅色和深色切换
 */
export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { t } = useTranslation()
  const isDark = useSettingStore((state) => state.isDark)
  const toggleDarkMode = useSettingStore((state) => state.toggleDarkMode)
  const label = isDark ? t('theme.switchToLightMode') : t('theme.switchToDarkMode')

  return (
    <ResponsiveTooltip title={label}>
      <button
        type="button"
        aria-label={label}
        onClick={toggleDarkMode}
        className={`hover:text-primary flex cursor-pointer items-center transition-colors ${className}`}
      >
        {isDark ? <Sun size={20} /> : <Moon size={20} />}
      </button>
    </ResponsiveTooltip>
  )
}
