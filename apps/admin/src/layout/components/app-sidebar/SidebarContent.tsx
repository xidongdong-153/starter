import { useCurrentPermissionsQuery } from '@admin/api/authorization'
import { buildNavigationMenuItems } from '@admin/app/navigation/navigation'
import { PermissionQueryStatus } from '@admin/components/common'
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
  const permissionsQuery = useCurrentPermissionsQuery()
  const menuItems = useMemo(
    () => buildNavigationMenuItems(permissionsQuery.isSuccess ? permissionsQuery.data.permissions : undefined, t),
    [permissionsQuery.data?.permissions, permissionsQuery.isSuccess, t],
  )

  return (
    <nav className="flex-1 overflow-auto">
      <PermissionQueryStatus
        compact={isSidebarCollapsed}
        isError={permissionsQuery.isError}
        isLoading={permissionsQuery.isPending}
        onRetry={() => void permissionsQuery.refetch()}
      />
      <NavigationMenu inlineCollapsed={isSidebarCollapsed} items={menuItems} />
    </nav>
  )
}
