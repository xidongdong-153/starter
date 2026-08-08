import { buildNavigationMenuItems } from '@admin/app/navigation/navigation'
import { useSettingStore } from '@admin/stores'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { NavigationMenu } from '../menu/NavigationMenu'

/**
 * 侧边栏菜单区
 */
export function SidebarContent() {
  const { t } = useTranslation()
  const isSidebarCollapsed = useSettingStore((state) => state.isSidebarCollapsed)
  const menuItems = useMemo(() => buildNavigationMenuItems(t), [t])

  return (
    <nav className="flex-1 overflow-auto">
      <NavigationMenu inlineCollapsed={isSidebarCollapsed} items={menuItems} />
    </nav>
  )
}
