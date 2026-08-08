import { Pattern } from '@admin/components/ui'
import { useRouteListener } from '@admin/hooks/useRouteListener'
import { useSettingStore } from '@admin/stores/modules/setting'

import { MobileDrawer } from './components/mobile-drawer/MobileDrawer'
import { SettingDrawer } from './components/SettingDrawer'
import { TopBottomLayout } from './layouts/TopBottomLayout'

/**
 * 根布局：背景、主布局、设置抽屉和移动端菜单抽屉
 */
export function RootLayout() {
  const isSettingDrawerOpen = useSettingStore((state) => state.isSettingDrawerOpen)
  const setSettingDrawerOpen = useSettingStore((state) => state.setSettingDrawerOpen)

  // 路由变化写入标签栏
  useRouteListener()

  return (
    <div className="relative h-full w-full">
      {/* 背景 */}
      <div className="fixed inset-0 z-0">
        <Pattern />
      </div>

      <div className="relative h-full w-full">
        <TopBottomLayout />
      </div>

      {/* 设置抽屉 */}
      <SettingDrawer open={isSettingDrawerOpen} onClose={() => setSettingDrawerOpen(false)} />
      {/* 移动端菜单抽屉 */}
      <MobileDrawer />
    </div>
  )
}
