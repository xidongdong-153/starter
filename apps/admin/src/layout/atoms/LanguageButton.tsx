import { ResponsiveTooltip } from '@admin/components/ui'
import { useSettingStore } from '@admin/stores/modules/setting'
import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface LanguageButtonProps {
  className?: string
  onClick?: () => void
}

/**
 * 中英文切换
 */
export function LanguageButton({ className, onClick }: LanguageButtonProps) {
  const { t } = useTranslation()
  const toggleLanguage = useSettingStore((state) => state.toggleLanguage)

  const handleClick = () => {
    void toggleLanguage()
    onClick?.()
  }

  return (
    <ResponsiveTooltip title={t('tooltip.switchLanguage')}>
      <button
        type="button"
        aria-label={t('tooltip.switchLanguage')}
        onClick={handleClick}
        className={`hover:text-primary flex cursor-pointer items-center transition-colors ${className || ''}`}
      >
        <Languages size={20} />
      </button>
    </ResponsiveTooltip>
  )
}
