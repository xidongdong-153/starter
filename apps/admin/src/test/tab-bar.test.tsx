import { TabBar } from '@admin/layout/components/tab-bar/TabBar'
import { useTabBarStore } from '@admin/stores'
import { PermissionKeys } from '@starter/contracts'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCurrentPermissions, createTestQueryClient, renderWithQueryClient } from './helpers'

const { getCurrentPermissions } = vi.hoisted(() => ({
  getCurrentPermissions: vi.fn(),
}))

vi.mock('@admin/api/authorization/authorization.api', () => ({
  getAuthorizationAuditEvents: vi.fn(),
  getCurrentPermissions,
  getAuthorizationRoles: vi.fn(),
  getAuthorizationUsers: vi.fn(),
  replaceAuthorizationRolePermissions: vi.fn(),
  replaceAuthorizationUserRoles: vi.fn(),
}))

// 只换两个 hook：appRouteRecords 依赖真实的 lazyRouteComponent。
// 用字符串路径形式：useRouter 返回泛型 TRouter，对象形式的 vi.mock 会把返回值跟模块类型比对而报错。
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()

  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useRouter: () => ({ invalidate: vi.fn() }),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

/** 标签用 data-tab-id 定位，label 走 mock 后的 i18n key，不适合做断言锚点 */
function visibleTabIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-tab-id]')].map((el) => el.getAttribute('data-tab-id') ?? '')
}

describe('标签栏权限过滤', () => {
  beforeEach(() => {
    getCurrentPermissions.mockReset()
    useTabBarStore.getState().reset()
  })

  it('权限加载中时隐藏所有带 permission 的标签，保留无权限要求的标签', async () => {
    getCurrentPermissions.mockReturnValue(new Promise(() => {}))

    useTabBarStore.getState().addTab({ id: 'files.list', label: '文件', path: '/files', routeId: 'files.list' })

    const { container } = renderWithQueryClient(<TabBar />, createTestQueryClient())

    await waitFor(() => {
      expect(visibleTabIds(container).length).toBeGreaterThan(0)
    })

    const ids = visibleTabIds(container)
    expect(ids.some((id) => id.includes('files'))).toBe(false)
  })

  it('持有权限时显示对应标签', async () => {
    getCurrentPermissions.mockResolvedValue(createCurrentPermissions([PermissionKeys.FILE_LIST]))

    useTabBarStore.getState().addTab({ id: 'files.list', label: '文件', path: '/files', routeId: 'files.list' })

    const { container } = renderWithQueryClient(<TabBar />, createTestQueryClient())

    await waitFor(() => {
      expect(visibleTabIds(container).some((id) => id.includes('files'))).toBe(true)
    })
  })

  it('缺少权限时隐藏对应标签，但不影响首页标签', async () => {
    getCurrentPermissions.mockResolvedValue(createCurrentPermissions([PermissionKeys.AUTHORIZATION_READ]))

    useTabBarStore.getState().addTab({ id: 'files.list', label: '文件', path: '/files', routeId: 'files.list' })

    const { container } = renderWithQueryClient(<TabBar />, createTestQueryClient())

    await waitFor(() => {
      expect(visibleTabIds(container).length).toBeGreaterThan(0)
    })

    expect(visibleTabIds(container).some((id) => id.includes('files'))).toBe(false)
  })

  it('权限查询失败时隐藏带 permission 的标签', async () => {
    getCurrentPermissions.mockRejectedValue(new Error('boom'))

    useTabBarStore.getState().addTab({ id: 'files.list', label: '文件', path: '/files', routeId: 'files.list' })

    const { container } = renderWithQueryClient(<TabBar />, createTestQueryClient())

    await waitFor(() => {
      expect(visibleTabIds(container).length).toBeGreaterThan(0)
    })

    expect(visibleTabIds(container).some((id) => id.includes('files'))).toBe(false)
  })
})
