import type { QueryClient } from '@tanstack/react-query'

import { ApiRequestError } from '@admin/api/http'
import { requireAdminRoutePermission } from '@admin/app/router/auth-guard'
import { PermissionKeys } from '@starter/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createCurrentPermissions, createTestQueryClient } from './helpers'

/** redirect() 抛出的是带 options 的 Response 实例，用这个函数捕获后再断言 */
async function captureThrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }

  throw new Error('预期抛出，但没有抛出')
}

function redirectOptions(thrown: unknown): unknown {
  return (thrown as { options?: unknown }).options
}

function stubFetchQuery(queryClient: QueryClient, impl: () => Promise<unknown>) {
  return vi.spyOn(queryClient, 'fetchQuery').mockImplementation(impl as never)
}

describe('requireAdminRoutePermission', () => {
  it('权限满足时正常返回，不抛出', async () => {
    const queryClient = createTestQueryClient()
    stubFetchQuery(queryClient, async () => createCurrentPermissions([PermissionKeys.AUTHORIZATION_READ]))

    await expect(requireAdminRoutePermission(queryClient, PermissionKeys.AUTHORIZATION_READ)).resolves.toBeUndefined()
  })

  it('权限不满足时跳转 /403', async () => {
    const queryClient = createTestQueryClient()
    stubFetchQuery(queryClient, async () => createCurrentPermissions([PermissionKeys.FILE_LIST]))

    const thrown = await captureThrown(() =>
      requireAdminRoutePermission(queryClient, PermissionKeys.AUTHORIZATION_READ),
    )

    expect(redirectOptions(thrown)).toMatchObject({ to: '/403', replace: true })
  })

  it('401 时跳转 /login', async () => {
    const queryClient = createTestQueryClient()
    stubFetchQuery(queryClient, async () => {
      throw new ApiRequestError(401, '未登录')
    })

    const thrown = await captureThrown(() =>
      requireAdminRoutePermission(queryClient, PermissionKeys.AUTHORIZATION_READ),
    )

    expect(redirectOptions(thrown)).toMatchObject({ to: '/login', replace: true })
  })

  it('403 不转成 redirect，原样抛出交给 ErrorBoundary', async () => {
    const queryClient = createTestQueryClient()
    const forbidden = new ApiRequestError(403, '没有权限')
    stubFetchQuery(queryClient, async () => {
      throw forbidden
    })

    const thrown = await captureThrown(() =>
      requireAdminRoutePermission(queryClient, PermissionKeys.AUTHORIZATION_READ),
    )

    expect(thrown).toBe(forbidden)
  })

  it('其他错误原样抛出', async () => {
    const queryClient = createTestQueryClient()
    const failure = new Error('网络异常')
    stubFetchQuery(queryClient, async () => {
      throw failure
    })

    const thrown = await captureThrown(() =>
      requireAdminRoutePermission(queryClient, PermissionKeys.AUTHORIZATION_READ),
    )

    expect(thrown).toBe(failure)
  })
})
