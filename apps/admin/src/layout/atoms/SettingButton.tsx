import { ResponsiveTooltip } from '@admin/components/ui'
import { useSettingStore } from '@admin/stores'
import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SettingButtonProps {
  className?: string
}

/**
 * 打开设置抽屉
 */
export function SettingButton({ className }: SettingButtonProps) {
  const { t } = useTranslation()
  const setSettingDrawerOpen = useSettingStore((state) => state.setSettingDrawerOpen)

  return (
    <ResponsiveTooltip title={t('tooltip.setting')}>
      <button
        type="button"
        aria-label={t('tooltip.setting')}
        onClick={() => setSettingDrawerOpen(true)}
        className={`hover:text-primary flex cursor-pointer items-center transition-colors ${className || ''}`}
      >
        <Settings size={20} />
      </button>
    </ResponsiveTooltip>
  )
}
