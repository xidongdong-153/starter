import type { Permission } from '@starter/contracts'
import type { ReactNode } from 'react'

import { usePermission } from '@admin/hooks/usePermission'

interface PermissionGuardProps {
  children: ReactNode
  fallback?: ReactNode
  permission: Permission
}

export function PermissionGuard({ children, fallback = null, permission }: PermissionGuardProps) {
  const { allowed } = usePermission(permission)

  return allowed ? children : fallback
}
