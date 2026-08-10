import type { AuthorizationAuditEventPage } from '@starter/contracts'

import { requireAdminRoutePermission } from '@admin/app/router/auth-guard'
import { authorizationQueryKeys } from '@admin/api/authorization'
import { authorizationRoutes } from '@admin/features/authorization/routes'
import { AuditActions, PermissionKeys, RoleKeys } from '@starter/contracts'
import { fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCurrentPermissions, createTestQueryClient, renderWithQueryClient } from './helpers'

const { getAuthorizationAuditEvents, getCurrentPermissions } = vi.hoisted(() => ({
  getAuthorizationAuditEvents: vi.fn(),
  getCurrentPermissions: vi.fn(),
}))

vi.mock('@admin/api/authorization/authorization.api', () => ({
  getAuthorizationAuditEvents,
  getCurrentPermissions,
  getAuthorizationRoles: vi.fn(),
  getAuthorizationUsers: vi.fn(),
  replaceAuthorizationRolePermissions: vi.fn(),
  replaceAuthorizationUserRoles: vi.fn(),
}))

function createPage(items: AuthorizationAuditEventPage['items']): AuthorizationAuditEventPage {
  return { items, total: items.length, page: 1, pageSize: 20 }
}

const roleEvent: AuthorizationAuditEventPage['items'][number] = {
  id: '019c3e00-0002-7000-8000-000000000001',
  actorType: 'user',
  actorId: 'actor-user-id',
  action: AuditActions.PLATFORM_ADMIN_REVOKED,
  targetType: 'user',
  targetId: 'target-user-id',
  before: { roleKeys: [RoleKeys.ADMIN] },
  after: { roleKeys: [RoleKeys.OPERATOR] },
  reason: null,
  requestId: 'request-abc',
  createdAt: new Date('2026-08-09T10:00:00.000Z').toISOString(),
}

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

describe('审计 route 记录', () => {
  it('审计 route 要求 authorization-audit:read，与授权设置页分开', () => {
    const audit = authorizationRoutes.find((route) => route.path === '/settings/authorization-audit')

    expect(audit).toBeDefined()
    expect(audit!.permission).toBe(PermissionKeys.AUTHORIZATION_AUDIT_READ)

    const settings = authorizationRoutes.find((route) => route.path === '/settings/authorization')
    expect(settings!.permission).toBe(PermissionKeys.AUTHORIZATION_READ)
  })
  it('审计 permission guard 允许持有者进入，缺少权限时跳转 403', async () => {
    const allowedClient = createTestQueryClient()
    getCurrentPermissions.mockResolvedValueOnce(createCurrentPermissions([PermissionKeys.AUTHORIZATION_AUDIT_READ]))
    await expect(
      requireAdminRoutePermission(allowedClient, PermissionKeys.AUTHORIZATION_AUDIT_READ),
    ).resolves.toBeUndefined()

    const deniedClient = createTestQueryClient()
    getCurrentPermissions.mockResolvedValueOnce(createCurrentPermissions([PermissionKeys.AUTHORIZATION_READ]))
    const thrown = await captureThrown(() =>
      requireAdminRoutePermission(deniedClient, PermissionKeys.AUTHORIZATION_AUDIT_READ),
    )
    expect(redirectOptions(thrown)).toMatchObject({ to: '/403', replace: true })
  })
})

describe('审计 query key', () => {
  it('把查询参数带进 query key，不同筛选不共用缓存', () => {
    const first = authorizationQueryKeys.auditEvents({ page: 1, pageSize: 20 })
    const second = authorizationQueryKeys.auditEvents({ page: 2, pageSize: 20 })

    expect(first).toEqual(['authorization', 'audit-events', { page: 1, pageSize: 20 }])
    expect(first).not.toEqual(second)
  })
})

describe('审计页三态渲染', () => {
  beforeEach(() => {
    getAuthorizationAuditEvents.mockReset()
  })

  async function renderPage() {
    // 动态导入：让 vi.mock 在模块求值前生效
    const { AuthorizationAudit } = await import('@admin/features/authorization/pages/AuthorizationAudit')
    return renderWithQueryClient(<AuthorizationAudit />, createTestQueryClient())
  }

  it('加载中显示 spinner，不渲染数据行', async () => {
    getAuthorizationAuditEvents.mockReturnValue(new Promise(() => {}))

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.ant-spin')).not.toBeNull()
    })
    // Antd 在 loading 时仍会把空态节点留在 DOM 里，只是被遮罩层盖住，
    // 所以只断言“没有数据行”，不断言空态文案不存在。
    expect(container.querySelectorAll('.ant-table-row')).toHaveLength(0)
  })

  it('加载失败时显示错误提示和重试按钮', async () => {
    getAuthorizationAuditEvents.mockRejectedValue(new Error('boom'))

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.ant-alert-error')).not.toBeNull()
    })
    expect(container.textContent).toContain('boom')
    expect(container.textContent).toContain('common.retry')

    getAuthorizationAuditEvents.mockResolvedValueOnce(createPage([]))
    const retry = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('common.retry'),
    )
    expect(retry).toBeDefined()
    fireEvent.click(retry!)
    await waitFor(() => {
      expect(getAuthorizationAuditEvents).toHaveBeenCalledTimes(2)
    })
  })

  it('数据为空时显示空状态', async () => {
    getAuthorizationAuditEvents.mockResolvedValue(createPage([]))

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.textContent).toContain('audit.empty')
    })
    expect(container.querySelector('.ant-alert-error')).toBeNull()
    expect(container.querySelectorAll('.ant-table-row')).toHaveLength(0)
  })

  it('提交 actor 和 target 筛选后用新参数查询第一页', async () => {
    getAuthorizationAuditEvents.mockResolvedValue(createPage([]))

    const { container } = await renderPage()
    await waitFor(() => {
      expect(getAuthorizationAuditEvents).toHaveBeenCalledTimes(1)
    })

    const actorInput = container.querySelector<HTMLInputElement>('input[placeholder="audit.filters.actorId"]')
    const targetInput = container.querySelector<HTMLInputElement>('input[placeholder="audit.filters.targetId"]')
    expect(actorInput).not.toBeNull()
    expect(targetInput).not.toBeNull()

    fireEvent.change(actorInput!, { target: { value: ' actor-1 ' } })
    fireEvent.change(targetInput!, { target: { value: 'target-1' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => {
      expect(getAuthorizationAuditEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          actorId: 'actor-1',
          targetId: 'target-1',
        }),
      )
    })
  })

  it('渲染结构化 before/after，不显示原始 JSON', async () => {
    getAuthorizationAuditEvents.mockResolvedValue(createPage([roleEvent]))

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.textContent).toContain(AuditActions.PLATFORM_ADMIN_REVOKED)
    })

    const text = container.textContent ?? ''
    expect(text).toContain(RoleKeys.ADMIN)
    expect(text).toContain(RoleKeys.OPERATOR)
    expect(text).toContain('target-user-id')
    expect(text).toContain('request-abc')
    // before/after 是对象渲染出的标签，页面上不应出现 JSON 字面量
    expect(text).not.toContain('roleKeys')
    expect(text).not.toContain('{"')
  })
})
