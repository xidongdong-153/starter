import { Breadcrumb } from '@admin/components/common'

import { Brand, Logo, MobileMenuButton } from '../../atoms'

interface HeaderLeftProps {
  showBrand?: boolean
  showBreadcrumb?: boolean
}

/**
 * 顶部左侧，放品牌和面包屑
 */
export function HeaderLeft({ showBrand = false, showBreadcrumb = false }: HeaderLeftProps) {
  return (
    <div className="flex items-center gap-x-3">
      {/* 移动端菜单按钮 */}
      <div className="md:hidden">
        <MobileMenuButton />
      </div>

      {/* 桌面端内容 */}
      <div className="hidden items-center gap-x-3 md:flex">
        {showBrand && (
          <>
            <Logo />
            <Brand />
          </>
        )}

        {showBreadcrumb && <Breadcrumb />}
      </div>
    </div>
  )
}
