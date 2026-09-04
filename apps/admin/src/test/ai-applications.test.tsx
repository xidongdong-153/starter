import '@admin/i18n'

import type { AiApplication } from '@starter/contracts'

import { AiApplications } from '@admin/features/ai/pages/AiApplications'
import { PermissionKeys } from '@starter/contracts'
import { App as AntdApp } from 'antd'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCurrentPermissions, createTestQueryClient, renderWithQueryClient } from './helpers'

const mocks = vi.hoisted(() => ({
  useAgentDefinitionsQuery: vi.fn(),
  useAiApplicationsQuery: vi.fn(),
  useCreateAiApplicationMutation: vi.fn(),
  useRevokeAiApplicationMutation: vi.fn(),
  useRotateAiApplicationSecretMutation: vi.fn(),
}))

const fixedUuid = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const scopeFromUuid = (prefix: 'ten' | 'prj', uuid: string) => `${prefix}_${uuid.replaceAll('-', '')}`
const fixedTenantId = scopeFromUuid('ten', fixedUuid)
const fixedProjectId = scopeFromUuid('prj', fixedUuid)
// 创建表单不动策略字段时的默认提交值：空 executables（拒绝全部 Agent）+ 只读。
const defaultPolicy = {
  schemaVersion: 1,
  executables: [],
  controls: ['abort', 'steer', 'follow_up'],
  maxSideEffect: 'read_only',
} as const

const { getCurrentPermissions } = vi.hoisted(() => ({
  getCurrentPermissions: vi.fn(),
}))

vi.mock('@admin/api/ai', () => mocks)

vi.mock('@admin/api/authorization/authorization.api', () => ({
  getAuthorizationAuditEvents: vi.fn(),
  getCurrentPermissions,
  getAuthorizationRoles: vi.fn(),
  getAuthorizationUsers: vi.fn(),
  replaceAuthorizationRolePermissions: vi.fn(),
  replaceAuthorizationUserRoles: vi.fn(),
}))

const activeApplication: AiApplication = {
  appId: '01958c80-8df7-7ce2-8f90-1234567890c1',
  name: 'web-chat',
  tenantId: 'acme',
  projectId: 'chat',
  policy: null,
  status: 'active',
  secretPrefix: 'ai_abcd01234',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
}

const revokedApplication: AiApplication = {
  ...activeApplication,
  appId: '01958c80-8df7-7ce2-8f90-1234567890c2',
  name: 'legacy-bot',
  status: 'revoked',
  secretPrefix: 'ai_efgh01234',
  revokedAt: '2026-08-21T00:00:00.000Z',
}

function renderPage() {
  return renderWithQueryClient(
    <AntdApp>
      <AiApplications />
    </AntdApp>,
    createTestQueryClient(),
  )
}

beforeEach(() => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(fixedUuid)
  getCurrentPermissions.mockReset()
  getCurrentPermissions.mockResolvedValue(createCurrentPermissions([PermissionKeys.AI_CONFIG_MANAGE]))
  mocks.useAgentDefinitionsQuery.mockReturnValue({
    data: { items: [], total: 0, page: 1, pageSize: 100 },
    isLoading: false,
    error: null,
  })
  mocks.useAiApplicationsQuery.mockReturnValue({
    data: [activeApplication, revokedApplication],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
  mocks.useCreateAiApplicationMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useRevokeAiApplicationMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useRotateAiApplicationSecretMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
})

afterEach(() => cleanup())

describe('应用凭据管理页', () => {
  it('列表只显示 secret 前缀、状态和最近调用时间', () => {
    renderPage()

    expect(screen.getByRole('columnheader', { name: 'secret 前缀' })).toBeTruthy()
    expect(screen.getByText('ai_abcd01234')).toBeTruthy()
    expect(screen.getByText('web-chat')).toBeTruthy()
    expect(screen.getByText('可用')).toBeTruthy()
    expect(screen.getByText('已撤销')).toBeTruthy()
    expect(screen.getAllByText('未调用过')).toHaveLength(2)
  })

  it('创建成功后用一次性弹窗展示完整 secret，scope 自动生成', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      application: activeApplication,
      secret: 'ai_abcd012345678901234567890123456789012345678',
    })
    mocks.useCreateAiApplicationMutation.mockReturnValue({ mutateAsync, isPending: false })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '新建应用' }))
    // 高级设置默认收起（jsdom 不应用 CSS 隐藏，用 aria-expanded 断言）
    await waitFor(() =>
      expect(screen.getByText('高级设置').closest('[role="button"]')?.getAttribute('aria-expanded')).toBe('false'),
    )
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'web-chat' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'web-chat',
        tenantId: fixedTenantId,
        projectId: fixedProjectId,
        policy: defaultPolicy,
      }),
    )
    expect(await screen.findByText('ai_abcd012345678901234567890123456789012345678')).toBeTruthy()
    expect(screen.getByText('应用：web-chat')).toBeTruthy()
    expect(screen.getByText('关闭这个窗口后无法再查看 secret，丢了只能轮换生成新的。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制 secret' })).toBeTruthy()
  })

  it('展开高级设置可看到并修改自动生成的 scope', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      application: activeApplication,
      secret: 'ai_abcd012345678901234567890123456789012345678',
    })
    mocks.useCreateAiApplicationMutation.mockReturnValue({ mutateAsync, isPending: false })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '新建应用' }))
    fireEvent.click(screen.getByText('高级设置'))

    const tenantInput = screen.getByLabelText('Tenant ID') as HTMLInputElement
    expect(tenantInput.value).toBe(fixedTenantId)
    expect((screen.getByLabelText('Project ID') as HTMLInputElement).value).toBe(fixedProjectId)

    fireEvent.change(tenantInput, { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'chat' } })
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'web-chat' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'web-chat',
        tenantId: 'acme',
        projectId: 'chat',
        policy: defaultPolicy,
      }),
    )
  })

  it('每次打开弹窗都重新生成 scope', async () => {
    const uuids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ] as const
    let index = 0
    const uuidSpy = vi
      .mocked(crypto.randomUUID)
      .mockReset()
      .mockImplementation(() => uuids[index++] ?? uuids[0]!)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '新建应用' }))
    fireEvent.click(screen.getByText('高级设置'))
    expect((screen.getByLabelText('Tenant ID') as HTMLInputElement).value).toBe(scopeFromUuid('ten', uuids[0]!))
    expect(uuidSpy).toHaveBeenCalledTimes(2)

    // 关闭弹窗不会重新生成
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(uuidSpy).toHaveBeenCalledTimes(2)

    // 再次打开时生成新值，不沿用上次
    fireEvent.click(screen.getByRole('button', { name: '新建应用' }))
    expect(uuidSpy).toHaveBeenCalledTimes(4)
  })

  it('scope 字段不符合格式时给出具体提示', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '新建应用' }))
    fireEvent.click(screen.getByText('高级设置'))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'web-chat' } })
    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: 'acme 1' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    expect(await screen.findByText('只能用字母、数字、下划线、点、冒号和连字符，首字符不能是点或冒号')).toBeTruthy()
  })

  it('已撤销的凭据不提供轮换和撤销操作', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: '轮换 secret' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '轮换 secret' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '撤销' })).toHaveLength(1)
  })

  it('没有管理权限时不显示写操作入口', async () => {
    getCurrentPermissions.mockResolvedValue(createCurrentPermissions([PermissionKeys.AI_CONFIG_READ]))
    renderPage()

    await waitFor(() => expect(getCurrentPermissions).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('button', { name: '新建应用' })).toBeNull())
    expect(screen.queryByRole('button', { name: '轮换 secret' })).toBeNull()
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull()
  })

  it('加载中显示表格 loading', () => {
    mocks.useAiApplicationsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })
    const { container } = renderPage()

    expect(container.querySelector('.ant-spin')).toBeTruthy()
  })

  it('加载失败显示错误提示和重试按钮', async () => {
    const refetch = vi.fn()
    mocks.useAiApplicationsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch,
    })
    renderPage()

    expect(screen.getByText('应用凭据列表加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
