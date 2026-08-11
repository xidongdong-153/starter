import type { AuthorizationPermissionImpact, AuthorizationRole, AuthorizationRoleImpact } from '@starter/contracts'
import type { QueryClient } from '@tanstack/react-query'

import {
  authorizationQueryKeys,
  useArchiveAuthorizationRoleMutation,
  useAuthorizationPermissionImpactQuery,
  useAuthorizationRoleImpactQuery,
  useCreateAuthorizationRoleMutation,
  useRestoreAuthorizationRoleMutation,
  useUpdateAuthorizationRoleMutation,
} from '@admin/api/authorization'
import { ApiRequestError, isConflictError } from '@admin/api/http'
import { isAuthorizationImpactPending } from '@admin/features/authorization/components/authorization-overlay'
import { diffKeys, resolveRoleKeySuggestion, suggestRoleKey } from '@admin/features/authorization/role-key'
import { PermissionKeys } from '@starter/contracts'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClientWrapper, createTestQueryClient } from './helpers'

const {
  archiveAuthorizationRole,
  createAuthorizationRole,
  getAuthorizationPermissionImpact,
  getAuthorizationRoleImpact,
  restoreAuthorizationRole,
  updateAuthorizationRole,
} = vi.hoisted(() => ({
  archiveAuthorizationRole: vi.fn(),
  createAuthorizationRole: vi.fn(),
  getAuthorizationPermissionImpact: vi.fn(),
  getAuthorizationRoleImpact: vi.fn(),
  restoreAuthorizationRole: vi.fn(),
  updateAuthorizationRole: vi.fn(),
}))

vi.mock('@admin/api/authorization/authorization.api', () => ({
  archiveAuthorizationRole,
  createAuthorizationRole,
  getAuthorizationAuditEvents: vi.fn(),
  getAuthorizationPermissionImpact,
  getAuthorizationRoleImpact,
  getAuthorizationRoles: vi.fn(),
  getAuthorizationUsers: vi.fn(),
  getCurrentPermissions: vi.fn(),
  replaceAuthorizationRolePermissions: vi.fn(),
  replaceAuthorizationUserRoles: vi.fn(),
  restoreAuthorizationRole,
  updateAuthorizationRole,
}))

const customRole: AuthorizationRole = {
  key: 'auditor',
  name: '审计员',
  description: null,
  isSystem: false,
  archivedAt: null,
  metadataEditable: true,
  permissionsEditable: true,
  lifecycleEditable: true,
  permissionKeys: [],
}

function expectFullInvalidation(queryClient: QueryClient) {
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.current() })
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.users() })
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.rolesAll() })
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.roleImpacts() })
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: authorizationQueryKeys.permissionImpacts() })
}

describe('角色 key 建议', () => {
  it('英文名称转成小写连字符 key', () => {
    expect(suggestRoleKey('Content Editor')).toBe('content-editor')
    expect(suggestRoleKey('  QA  Team  ')).toBe('qa-team')
  })

  it('拉丁组合音标被去除', () => {
    expect(suggestRoleKey('Café Manager')).toBe('cafe-manager')
  })

  it('中文名称和无效结果返回空建议', () => {
    expect(suggestRoleKey('审计员')).toBe('')
    expect(suggestRoleKey('123 role')).toBe('')
    expect(suggestRoleKey('a'.repeat(80))).toBe('')
    expect(suggestRoleKey('')).toBe('')
  })

  it('手动编辑 key 后名称变化不再返回覆盖值', () => {
    expect(resolveRoleKeySuggestion('Content Editor', false)).toBe('content-editor')
    expect(resolveRoleKeySuggestion('Changed Name', true)).toBeNull()
  })
})

describe('diffKeys', () => {
  it('返回排序后的新增和移除项', () => {
    expect(diffKeys(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
    expect(diffKeys(['a'], ['a'])).toEqual({ added: [], removed: [] })
  })
})

describe('影响预览状态', () => {
  it('首次加载或后台刷新时都视为 pending', () => {
    expect(isAuthorizationImpactPending({ isLoading: true, isFetching: true })).toBe(true)
    expect(isAuthorizationImpactPending({ isLoading: false, isFetching: true })).toBe(true)
    expect(isAuthorizationImpactPending({ isLoading: false, isFetching: false })).toBe(false)
  })

  it('只把 409 识别为需要刷新归档影响的冲突', () => {
    expect(isConflictError(new ApiRequestError(409, '角色仍有用户分配'))).toBe(true)
    expect(isConflictError(new ApiRequestError(403, '没有权限'))).toBe(false)
    expect(isConflictError(new Error('network'))).toBe(false)
  })
})

describe('authorizationQueryKeys', () => {
  it('active 和 archived 角色目录使用不同 key', () => {
    expect(authorizationQueryKeys.roles('active')).toEqual(['authorization', 'roles', 'active'])
    expect(authorizationQueryKeys.roles('archived')).toEqual(['authorization', 'roles', 'archived'])
    expect(authorizationQueryKeys.roles()).toEqual(authorizationQueryKeys.roles('active'))
  })

  it('role 和 permission impact 使用独立 key', () => {
    expect(authorizationQueryKeys.roleImpact('auditor')).not.toEqual(authorizationQueryKeys.permissionImpact('auditor'))
  })
})

describe('impact query hook', () => {
  beforeEach(() => {
    getAuthorizationPermissionImpact.mockReset()
    getAuthorizationRoleImpact.mockReset()
  })

  it('参数为 null 时不发请求', () => {
    renderHook(
      () => ({
        permission: useAuthorizationPermissionImpactQuery(null),
        role: useAuthorizationRoleImpactQuery(null),
      }),
      { wrapper: createQueryClientWrapper(createTestQueryClient()) },
    )

    expect(getAuthorizationRoleImpact).not.toHaveBeenCalled()
    expect(getAuthorizationPermissionImpact).not.toHaveBeenCalled()
  })

  it('role impact 使用传入的 role key', async () => {
    const impact: AuthorizationRoleImpact = { roleKey: 'auditor', assignedUserCount: 3 }
    getAuthorizationRoleImpact.mockResolvedValue(impact)

    const { result } = renderHook(() => useAuthorizationRoleImpactQuery('auditor'), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => {
      expect(getAuthorizationRoleImpact).toHaveBeenCalledWith('auditor')
      expect(result.current.data).toEqual(impact)
    })
  })

  it('permission impact 使用传入的 permission key', async () => {
    const impact: AuthorizationPermissionImpact = {
      permissionKey: PermissionKeys.FILE_LIST,
      roleKeys: ['admin'],
      affectedUserCount: 1,
    }
    getAuthorizationPermissionImpact.mockResolvedValue(impact)

    const { result } = renderHook(() => useAuthorizationPermissionImpactQuery(PermissionKeys.FILE_LIST), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => {
      expect(getAuthorizationPermissionImpact).toHaveBeenCalledWith(PermissionKeys.FILE_LIST)
      expect(result.current.data).toEqual(impact)
    })
  })
})

describe('角色生命周期 mutation 的 query 失效', () => {
  beforeEach(() => {
    archiveAuthorizationRole.mockReset()
    createAuthorizationRole.mockReset()
    restoreAuthorizationRole.mockReset()
    updateAuthorizationRole.mockReset()
  })

  const runSuccessCase = async (mutate: (queryClient: QueryClient) => Promise<unknown>) => {
    const queryClient = createTestQueryClient()
    vi.spyOn(queryClient, 'invalidateQueries')
    await mutate(queryClient)
    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(5)
    })
    expectFullInvalidation(queryClient)
  }

  it('create、update、archive、restore 成功后失效完整范围', async () => {
    createAuthorizationRole.mockResolvedValue(customRole)
    updateAuthorizationRole.mockResolvedValue(customRole)
    archiveAuthorizationRole.mockResolvedValue({ ...customRole, archivedAt: '2026-08-10T00:00:00.000Z' })
    restoreAuthorizationRole.mockResolvedValue(customRole)

    await runSuccessCase(async (queryClient) => {
      const { result } = renderHook(() => useCreateAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({
        key: 'auditor',
        name: '审计员',
        description: null,
        permissionKeys: [],
      })
    })

    await runSuccessCase(async (queryClient) => {
      const { result } = renderHook(() => useUpdateAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({ roleKey: 'auditor', values: { name: '新名字' } })
    })

    await runSuccessCase(async (queryClient) => {
      const { result } = renderHook(() => useArchiveAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({ roleKey: 'auditor' })
    })

    await runSuccessCase(async (queryClient) => {
      const { result } = renderHook(() => useRestoreAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({ roleKey: 'auditor' })
    })
  })

  const runFailureCase = async (mutate: (queryClient: QueryClient) => Promise<unknown>) => {
    const queryClient = createTestQueryClient()
    vi.spyOn(queryClient, 'invalidateQueries')
    await expect(mutate(queryClient)).rejects.toThrow('failed')
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
  }

  it('create、update、archive、restore 失败时不失效 query', async () => {
    createAuthorizationRole.mockRejectedValue(new Error('failed'))
    updateAuthorizationRole.mockRejectedValue(new Error('failed'))
    archiveAuthorizationRole.mockRejectedValue(new Error('failed'))
    restoreAuthorizationRole.mockRejectedValue(new Error('failed'))

    await runFailureCase(async (queryClient) => {
      const { result } = renderHook(() => useCreateAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({
        key: 'auditor',
        name: '审计员',
        description: null,
        permissionKeys: [],
      })
    })

    await runFailureCase(async (queryClient) => {
      const { result } = renderHook(() => useUpdateAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({ roleKey: 'auditor', values: { name: '新名字' } })
    })

    await runFailureCase(async (queryClient) => {
      const { result } = renderHook(() => useArchiveAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({ roleKey: 'auditor' })
    })

    await runFailureCase(async (queryClient) => {
      const { result } = renderHook(() => useRestoreAuthorizationRoleMutation(), {
        wrapper: createQueryClientWrapper(queryClient),
      })
      return result.current.mutateAsync({ roleKey: 'auditor' })
    })
  })
})
