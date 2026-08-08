import { useSettingStore } from '@admin/stores'

import { SidebarContent } from './SidebarContent'
import { SidebarFooter } from './SidebarFooter'

/**
 * 左侧菜单栏
 */
export function AppSidebar() {
  const isSidebarCollapsed = useSettingStore((state) => state.isSidebarCollapsed)

  return (
    <aside
      className={`guide-sidebar hidden flex-col transition-all duration-300 md:flex ${
        isSidebarCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      <SidebarContent />
      <SidebarFooter />
    </aside>
  )
}
