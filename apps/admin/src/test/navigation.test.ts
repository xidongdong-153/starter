import type { Permission } from '@starter/contracts'
import type { MenuProps } from 'antd'

import { buildNavigationMenuItems } from '@admin/app/navigation/navigation'
import { PermissionKeys } from '@starter/contracts'
import { describe, expect, it } from 'vitest'

type MenuItem = Required<MenuProps>['items'][number]

/** 菜单项的 key 是 path ?? id，用它定位比依赖 i18n 文案稳定 */
function collectKeys(items: MenuItem[]): string[] {
  return items.flatMap((item) => {
    if (!item) return []

    const children = 'children' in item && Array.isArray(item.children) ? collectKeys(item.children as MenuItem[]) : []

    return [String(item.key), ...children]
  })
}

function buildKeys(permissions: Permission[] | undefined): string[] {
  return collectKeys(buildNavigationMenuItems(permissions))
}

describe('buildNavigationMenuItems', () => {
  it('权限为 undefined 时隐藏所有带 permission 的菜单', () => {
    const keys = buildKeys(undefined)

    expect(keys).not.toContain('/files')
    expect(keys).not.toContain('/settings/authorization')
    expect(keys).not.toContain('/settings/authorization-audit')
    expect(keys).toContain('/ai/chat')
    expect(keys).not.toContain('/settings/ai/providers')
    expect(keys).not.toContain('/settings/users')
  })

  it('只持有 authorization:read 时显示授权与用户管理，不显示文件', () => {
    const keys = buildKeys([PermissionKeys.AUTHORIZATION_READ])

    expect(keys).toContain('/settings/authorization')
    expect(keys).toContain('/settings/users')
    expect(keys).not.toContain('/settings/authorization-audit')
    expect(keys).not.toContain('/files')
    expect(keys).not.toContain('files')
  })

  it('只持有 authorization-audit:read 时只显示授权审计入口', () => {
    const keys = buildKeys([PermissionKeys.AUTHORIZATION_AUDIT_READ])

    expect(keys).toContain('/settings/authorization-audit')
    expect(keys).not.toContain('/settings/authorization')
    expect(keys).not.toContain('/settings/users')
    expect(keys).not.toContain('/files')
  })

  it('只持有 ai:config:read 时显示 Provider 管理入口', () => {
    const keys = buildKeys([PermissionKeys.AI_CONFIG_READ])

    expect(keys).toContain('/ai/chat')
    expect(keys).toContain('/settings/ai')
    expect(keys).toContain('/settings/ai/providers')
    expect(keys).not.toContain('/settings/authorization')
  })

  it('只持有 file:list 时显示文件分组，不显示授权与用户管理', () => {
    const keys = buildKeys([PermissionKeys.FILE_LIST])

    expect(keys).toContain('/files')
    expect(keys).toContain('files')
    expect(keys).not.toContain('/settings/authorization')
    expect(keys).not.toContain('/settings/users')
  })

  it('menu 为 false 的记录在任何权限下都不出现', () => {
    const allPermissions = Object.values(PermissionKeys)
    const keys = buildKeys(allPermissions)

    expect(keys).not.toContain('/login')
    expect(keys).not.toContain('/register')
    expect(keys).not.toContain('/403')
    expect(keys).not.toContain('/404')
  })

  it('无权限时 settings 分组仍因个人资料保留，但不含受保护项', () => {
    const items = buildNavigationMenuItems(undefined)
    const settingsGroup = items.find((item) => item && String(item.key) === 'settings')

    expect(settingsGroup).toBeDefined()

    const childKeys = collectKeys(
      settingsGroup && 'children' in settingsGroup && Array.isArray(settingsGroup.children)
        ? (settingsGroup.children as MenuItem[])
        : [],
    )

    expect(childKeys).toContain('/settings/profile')
    expect(childKeys).toContain('/settings/ai')
    expect(childKeys).not.toContain('/settings/ai/providers')
    expect(childKeys).not.toContain('/settings/authorization')
    expect(childKeys).not.toContain('/settings/authorization-audit')
    expect(childKeys).not.toContain('/settings/users')
  })

  it('分组按 navigationGroups 的 order 排列', () => {
    const items = buildNavigationMenuItems(Object.values(PermissionKeys))
    const groupKeys = items
      .map((item) => String(item?.key))
      .filter((key) => ['examples', 'files', 'settings'].includes(key))

    expect(groupKeys).toEqual(['files', 'settings', 'examples'])
  })
})
