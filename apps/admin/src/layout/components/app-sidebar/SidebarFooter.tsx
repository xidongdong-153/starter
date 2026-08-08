import { CollapseButton } from '@admin/layout/atoms'

/**
 * 侧边栏底部，放折叠按钮
 */
export function SidebarFooter() {
  return (
    <div className="mb-2 flex w-full justify-center">
      <CollapseButton />
    </div>
  )
}
