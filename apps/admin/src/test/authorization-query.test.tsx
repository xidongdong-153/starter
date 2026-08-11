import type { AuthorizationRole, AuthorizationUser } from '@starter/contracts'

import {
  authorizationQueryKeys,
  currentPermissionsQueryOptions,
  useReplaceAuthorizationRolePermissionsMutation,
  useReplaceAuthorizationUserRolesMutation,
} from '@admin/api/authorization'
import { usePermission } from '@admin/hooks/usePermission'
import { PermissionKeys } from '@starter/contracts'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCurrentPermissions, createQueryClientWrapper, createTestQueryClient } from './helpers'

const { getCurrentPermissions, replaceAuthorizationRolePermissions, replaceAuthorizationUserRoles } = vi.hoisted(
  () => ({
    getCurrentPermissions: vi.fn(),
    replaceAuthorizationRolePermissions: vi.fn(),
    replaceAuthorizationUserRoles: vi.fn(),
  }),
)

vi.mock('@admin/api/authorization/authorization.api', () => ({
  archiveAuthorizationRole: vi.fn(),
  createAuthorizationRole: vi.fn(),
  getAuthorizationAuditEvents: vi.fn(),
  getAuthorizationPermissionImpact: vi.fn(),
  getAuthorizationRoleImpact: vi.fn(),
  getCurrentPermissions,
  getAuthorizationRoles: vi.fn(),
  getAuthorizationUsers: vi.fn(),
  replaceAuthorizationRolePermissions,
  replaceAuthorizationUserRoles,
  restoreAuthorizationRole: vi.fn(),
  updateAuthorizationRole: vi.fn(),
}))

describe('currentPermissionsQueryOptions', () => {
  it('使用固定的 query key、30 秒 staleTime 和窗口聚焦刷新', () => {
    expect(currentPermissionsQueryOptions.queryKey).toEqual(['authorization', 'current'])
    expect(currentPermissionsQueryOptions.staleTime).toBe(30_000)
    expect(currentPermissionsQueryOptions.refetchOnWindowFocus).toBe(true)
  })
})

describe('usePermission', () => {
  beforeEach(() => {
    getCurrentPermissions.mockReset()
  })

  it('加载中时 allowed 为 false 且 isLoading 为 true', () => {
    getCurrentPermissions.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => usePermission(PermissionKeys.FILE_UPLOAD), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    expect(result.current.allowed).toBe(false)
    expect(result.current.isLoading).toBe(true)
    expect(result.current.isError).toBe(false)
  })

  it('查询失败时 allowed 为 false 且 isError 为 true', async () => {
    getCurrentPermissions.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => usePermission(PermissionKeys.FILE_UPLOAD), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(result.current.allowed).toBe(false)
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('查询成功且命中权限时 allowed 为 true', async () => {
    getCurrentPermissions.mockResolvedValue(createCurrentPermissions([PermissionKeys.FILE_UPLOAD]))

    const { result } = renderHook(() => usePermission(PermissionKeys.FILE_UPLOAD), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => {
      expect(result.current.allowed).toBe(true)
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isError).toBe(false)
  })

  it('查询成功但未命中权限时 allowed 为 false', async () => {
    getCurrentPermissions.mockResolvedValue(createCurrentPermissions([PermissionKeys.FILE_LIST]))

    const { result } = renderHook(() => usePermission(PermissionKeys.FILE_UPLOAD), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.allowed).toBe(false)
  })
})

describe('授权 mutation 的 query 失效', () => {
  beforeEach(() => {
    replaceAuthorizationUserRoles.mockReset()
    replaceAuthorizationRolePermissions.mockReset()
  })

  it('替换用户角色成功后失效 current、users、roles 和 impact query', async () => {
    const user: AuthorizationUser = { id: 'u1', name: '张三', email: 'a@b.c', roleKeys: ['operator'] }
    replaceAuthorizationUserRoles.mockResolvedValue(user)

    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useReplaceAuthorizationUserRolesMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await result.current.mutateAsync({ userId: 'u1', values: { roleKeys: ['operator'] } })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledTimes(5)
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.current() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.users() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.rolesAll() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.roleImpacts() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.permissionImpacts() })
  })

  it('替换角色权限成功后失效 current、users、roles 和 impact query', async () => {
    const role: AuthorizationRole = {
      key: 'viewer',
      name: '只读',
      description: null,
      isSystem: true,
      archivedAt: null,
      metadataEditable: false,
      permissionsEditable: true,
      lifecycleEditable: false,
      permissionKeys: [PermissionKeys.FILE_LIST],
    }
    replaceAuthorizationRolePermissions.mockResolvedValue(role)

    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useReplaceAuthorizationRolePermissionsMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await result.current.mutateAsync({
      roleKey: 'viewer',
      values: { permissionKeys: [PermissionKeys.FILE_LIST] },
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledTimes(5)
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.current() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.users() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.rolesAll() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.roleImpacts() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.permissionImpacts() })
  })

  it('mutation 失败时不失效任何 query', async () => {
    replaceAuthorizationUserRoles.mockRejectedValue(new Error('403'))

    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useReplaceAuthorizationUserRolesMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await expect(result.current.mutateAsync({ userId: 'u1', values: { roleKeys: ['operator'] } })).rejects.toThrow(
      '403',
    )

    expect(invalidateQueries).not.toHaveBeenCalled()
  })
})
