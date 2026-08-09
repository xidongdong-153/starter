import { PermissionGuard } from '@admin/components/common/PermissionGuard'
import { PermissionKeys } from '@starter/contracts'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCurrentPermissions, createTestQueryClient, renderWithQueryClient } from './helpers'

const { getCurrentPermissions } = vi.hoisted(() => ({
  getCurrentPermissions: vi.fn(),
}))

vi.mock('@admin/api/authorization/authorization.api', () => ({
  getCurrentPermissions,
  getAuthorizationRoles: vi.fn(),
  getAuthorizationUsers: vi.fn(),
  replaceAuthorizationRolePermissions: vi.fn(),
  replaceAuthorizationUserRoles: vi.fn(),
}))

describe('权限守卫组件 PermissionGuard', () => {
  beforeEach(() => {
    getCurrentPermissions.mockReset()
  })

  it('权限加载中不渲染 children', () => {
    getCurrentPermissions.mockReturnValue(new Promise(() => {}))

    renderWithQueryClient(
      <PermissionGuard permission={PermissionKeys.FILE_UPLOAD}>
        <button type="button">上传</button>
      </PermissionGuard>,
      createTestQueryClient(),
    )

    expect(screen.queryByText('上传')).toBeNull()
  })

  it('权限查询失败时渲染 fallback', async () => {
    getCurrentPermissions.mockRejectedValue(new Error('boom'))

    renderWithQueryClient(
      <PermissionGuard permission={PermissionKeys.FILE_UPLOAD} fallback={<span>无法确认权限</span>}>
        <button type="button">上传</button>
      </PermissionGuard>,
      createTestQueryClient(),
    )

    await waitFor(() => {
      expect(screen.getByText('无法确认权限')).not.toBeNull()
    })
    expect(screen.queryByText('上传')).toBeNull()
  })

  it('没有对应权限时渲染 fallback', async () => {
    getCurrentPermissions.mockResolvedValue(createCurrentPermissions([PermissionKeys.FILE_LIST]))

    renderWithQueryClient(
      <PermissionGuard permission={PermissionKeys.FILE_UPLOAD} fallback={<span>没有权限</span>}>
        <button type="button">上传</button>
      </PermissionGuard>,
      createTestQueryClient(),
    )

    await waitFor(() => {
      expect(screen.getByText('没有权限')).not.toBeNull()
    })
    expect(screen.queryByText('上传')).toBeNull()
  })

  it('持有权限时渲染 children', async () => {
    getCurrentPermissions.mockResolvedValue(
      createCurrentPermissions([PermissionKeys.FILE_LIST, PermissionKeys.FILE_UPLOAD]),
    )

    renderWithQueryClient(
      <PermissionGuard permission={PermissionKeys.FILE_UPLOAD}>
        <button type="button">上传</button>
      </PermissionGuard>,
      createTestQueryClient(),
    )

    await waitFor(() => {
      expect(screen.getByText('上传')).not.toBeNull()
    })
  })

  it('默认 fallback 为 null，不渲染任何内容', async () => {
    getCurrentPermissions.mockResolvedValue(createCurrentPermissions([]))

    const { container } = renderWithQueryClient(
      <PermissionGuard permission={PermissionKeys.FILE_UPLOAD}>
        <button type="button">上传</button>
      </PermissionGuard>,
      createTestQueryClient(),
    )

    await waitFor(() => {
      expect(container.textContent).toBe('')
    })
  })
})
