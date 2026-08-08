import { HeaderActions } from './HeaderActions'
import { HeaderLeft } from './HeaderLeft'

interface AppHeaderProps {
  showBrand?: boolean
  showBreadcrumb?: boolean
}

/**
 * 顶部区域容器
 */
export function AppHeader({ showBrand = false, showBreadcrumb = false }: AppHeaderProps) {
  return (
    <header className="guide-header flex items-center justify-between">
      <HeaderLeft showBrand={showBrand} showBreadcrumb={showBreadcrumb} />
      <HeaderActions />
    </header>
  )
}
