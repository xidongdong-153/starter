import type { MenuProps } from 'antd'
import type { LucideProps } from 'lucide-react'
import type { ComponentType, Key, ReactNode } from 'react'

import { createElement } from 'react'

/**
 * 渲染菜单图标
 */
export function renderIcon(IconComponent?: ComponentType<LucideProps>): ReactNode {
  if (!IconComponent) return null
  return createElement(IconComponent, { size: 16 })
}

/**
 * 菜单项类型（取自 Ant Design MenuProps）
 */
export type MenuItem = Required<MenuProps>['items'][number]

/**
 * 带排序信息的菜单项
 */
export interface MenuItemWithOrder {
  children?: MenuItemWithOrder[]
  icon?: ReactNode
  key: Key
  label: ReactNode
  order?: number
}

interface MatchedMenuResult {
  openKeys: string[]
  selectedKey: string | null
}

/**
 * 按路径生成标签页 ID
 */
export function generateTabId(path: string): string {
  return path.replace(/\//g, '-').replace(/^-/, '') || 'home'
}

function isPathMenuKey(key: string): boolean {
  return key.startsWith('/')
}

function isPathKeyMatched(key: string, currentPath: string): boolean {
  if (!isPathMenuKey(key)) {
    return false
  }

  if (key === currentPath) {
    return true
  }

  if (key === '/') {
    return currentPath === '/'
  }

  return currentPath.startsWith(`${key}/`)
}

function findMatchedMenuResult(items: MenuItem[], currentPath: string, ancestorKeys: string[] = []): MatchedMenuResult {
  let matchedResult: MatchedMenuResult = {
    openKeys: [],
    selectedKey: null,
  }

  for (const item of items) {
    if (!item) continue

    const itemKey = String(item.key ?? '')
    const nextAncestorKeys = itemKey ? [...ancestorKeys, itemKey] : ancestorKeys

    if ('children' in item && item.children?.length) {
      const childMatchedResult = findMatchedMenuResult(item.children, currentPath, nextAncestorKeys)
      const childMatchedKeyLength = childMatchedResult.selectedKey?.length ?? 0
      const currentMatchedKeyLength = matchedResult.selectedKey?.length ?? 0

      if (childMatchedResult.selectedKey && childMatchedKeyLength > currentMatchedKeyLength) {
        matchedResult = childMatchedResult
      }
    }

    if (!isPathKeyMatched(itemKey, currentPath)) {
      continue
    }

    const currentMatchedKeyLength = matchedResult.selectedKey?.length ?? 0

    if (itemKey.length > currentMatchedKeyLength) {
      matchedResult = {
        openKeys: ancestorKeys,
        selectedKey: itemKey,
      }
    }
  }

  return matchedResult
}

/**
 * 按当前路径找到选中的菜单 key，走路径边界匹配
 */
export function findMatchingMenuKey(items: MenuItem[], currentPath: string): string | null {
  return findMatchedMenuResult(items, currentPath).selectedKey
}

/**
 * 按当前路径返回菜单选中项和需要展开的父级
 */
export function findMatchingMenuState(
  items: MenuItem[],
  currentPath: string,
): { openKeys: string[]; selectedKeys: string[] } {
  const matchedResult = findMatchedMenuResult(items, currentPath)

  return {
    openKeys: matchedResult.selectedKey ? matchedResult.openKeys : [],
    selectedKeys: matchedResult.selectedKey ? [matchedResult.selectedKey] : [],
  }
}
