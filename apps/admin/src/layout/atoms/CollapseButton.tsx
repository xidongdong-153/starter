import { useSettingStore } from '@admin/stores'
import { PanelLeftClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * 侧边栏折叠按钮
 */
export function CollapseButton() {
  const { t } = useTranslation()
  const isSidebarCollapsed = useSettingStore((state) => state.isSidebarCollapsed)
  const toggleSidebarCollapsed = useSettingStore((state) => state.toggleSidebarCollapsed)

  return (
    <button
      type="button"
      aria-label={isSidebarCollapsed ? t('tooltip.expandSidebar') : t('tooltip.collapseSidebar')}
      onClick={toggleSidebarCollapsed}
      className={`hover:text-primary text-fg flex h-8 w-8 cursor-pointer items-center justify-center rounded transition-colors ${
        isSidebarCollapsed ? '' : 'rotate-180'
      }`}
    >
      <PanelLeftClose size={20} />
    </button>
  )
}
