import { useSettingStore } from '@admin/stores'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * 移动端菜单按钮，点开左侧抽屉
 */
export function MobileMenuButton() {
  const { t } = useTranslation()
  const setMobileMenuOpen = useSettingStore((state) => state.setMobileMenuOpen)

  return (
    <button
      type="button"
      aria-label={t('tooltip.openMenu')}
      onClick={() => setMobileMenuOpen(true)}
      className="hover:text-primary text-fg flex h-8 w-8 cursor-pointer items-center justify-center rounded transition-colors"
    >
      <Menu size={20} />
    </button>
  )
}
