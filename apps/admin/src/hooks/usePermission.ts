import type { Permission } from '@starter/contracts'

import { useCurrentPermissionsQuery } from '@admin/api/authorization'
import { hasPermission } from '@admin/app/authorization/permissions'

export function usePermission(permission: Permission) {
  const permissionsQuery = useCurrentPermissionsQuery()

  return {
    allowed: permissionsQuery.isSuccess && hasPermission(permissionsQuery.data.permissions, permission),
    error: permissionsQuery.error,
    isError: permissionsQuery.isError,
    isLoading: permissionsQuery.isPending,
    refetch: permissionsQuery.refetch,
  }
}
