import { AppContent } from '../components/app-content/AppContent'
import { AppHeader } from '../components/app-header/AppHeader'
import { AppSidebar } from '../components/app-sidebar/AppSidebar'
import { TabBar } from '../components/tab-bar/TabBar'

/**
 * 控制台主布局。上部放品牌和操作区，下部放菜单、标签栏和内容区。
 */
export function TopBottomLayout() {
  return (
    <div className="guide-shell flex h-screen flex-col">
      {/* 顶部 */}
      <AppHeader showBrand />

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧菜单 */}
        <AppSidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* 标签栏 */}
          <TabBar />

          {/* 内容区 */}
          <AppContent />
        </div>
      </div>
    </div>
  )
}
