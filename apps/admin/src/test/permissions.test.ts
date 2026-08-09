import type { Permission } from '@starter/contracts'

import { hasPermission } from '@admin/app/authorization/permissions'
import { PermissionKeys } from '@starter/contracts'
import { describe, expect, it } from 'vitest'

describe('hasPermission', () => {
  it('权限集合为 undefined 时返回 false', () => {
    expect(hasPermission(undefined, PermissionKeys.FILE_LIST)).toBe(false)
  })

  it('权限集合为空数组时返回 false', () => {
    expect(hasPermission([], PermissionKeys.FILE_LIST)).toBe(false)
  })

  it('命中精确 key 时返回 true', () => {
    const permissions: Permission[] = [PermissionKeys.FILE_LIST, PermissionKeys.FILE_READ]

    expect(hasPermission(permissions, PermissionKeys.FILE_LIST)).toBe(true)
    expect(hasPermission(permissions, PermissionKeys.FILE_READ)).toBe(true)
  })

  it('未命中时返回 false，不做前缀或通配匹配', () => {
    const permissions: Permission[] = [PermissionKeys.FILE_LIST]

    expect(hasPermission(permissions, PermissionKeys.FILE_DELETE)).toBe(false)
    expect(hasPermission(permissions, PermissionKeys.AUTHORIZATION_READ)).toBe(false)
  })
})
