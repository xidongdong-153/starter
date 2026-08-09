import type { Permission } from '@starter/contracts'

export function hasPermission(permissions: readonly Permission[] | undefined, permission: Permission): boolean {
  return permissions?.includes(permission) ?? false
}
