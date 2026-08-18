import '@admin/i18n'

import { Agents } from '@admin/features/ai/pages/Agents'
import { App as AntdApp } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAdminAgentDefinitionsQuery: vi.fn(),
  useAdminAiToolsQuery: vi.fn(),
  useAdminAiModelsQuery: vi.fn(),
  useCreateAgentDefinitionMutation: vi.fn(),
  useCurrentPermissionsQuery: vi.fn(),
  useSkillsQuery: vi.fn(),
  useSystemPromptsQuery: vi.fn(),
  useUpdateAgentDefinitionMutation: vi.fn(),
  useUpdateAgentDefinitionStatusMutation: vi.fn(),
}))

vi.mock('@admin/api/ai', () => mocks)
vi.mock('@admin/api/authorization', () => ({ useCurrentPermissionsQuery: mocks.useCurrentPermissionsQuery }))

function renderPage() {
  return render(
    <AntdApp>
      <Agents />
    </AntdApp>,
  )
}

const config = {
  schemaVersion: 1 as const,
  model: { providerId: 'openai', modelId: 'gpt-test' },
  systemPromptId: '01900000-0000-7000-8000-000000000001',
  skillIds: ['01900000-0000-7000-8000-000000000002'],
  toolNames: ['read_skill'],
  thinkingLevel: 'medium' as const,
  maxTurns: 8,
}

beforeEach(() => {
  mocks.useCurrentPermissionsQuery.mockReturnValue({
    data: { permissions: ['ai:config:read', 'ai:config:manage'] },
    error: null,
    isError: false,
    isPending: false,
    isSuccess: true,
  })
  mocks.useAdminAgentDefinitionsQuery.mockReturnValue({
    data: {
      items: [
        {
          id: '01900000-0000-7000-8000-000000000010',
          name: 'Code Agent',
          description: 'Review code',
          status: 'draft',
          revision: 1,
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
          config,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  })
  mocks.useAdminAiModelsQuery.mockReturnValue({
    data: {
      items: [
        {
          providerId: 'openai',
          modelId: 'gpt-test',
          name: 'GPT Test',
          providerName: 'OpenAI',
          capabilities: {
            contextWindow: 1000,
            maxOutputTokens: 100,
            supportsImageInput: false,
            supportsReasoning: true,
            supportsTools: true,
          },
          available: true,
          enabled: true,
          unavailableReason: null,
        },
      ],
      globalDefaultModel: null,
    },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  })
  mocks.useSystemPromptsQuery.mockReturnValue({
    data: [
      {
        id: config.systemPromptId,
        name: 'reviewer',
        content: 'hidden from Agent form payload',
        enabled: true,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
    ],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  })
  mocks.useSkillsQuery.mockReturnValue({
    data: [
      {
        id: config.skillIds[0],
        name: 'review-skill',
        description: 'Review helper',
        enabled: true,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
    ],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  })
  mocks.useAdminAiToolsQuery.mockReturnValue({
    data: [{ name: 'read_skill', description: 'Read a skill' }],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  })
  mocks.useCreateAgentDefinitionMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({}),
  })
  mocks.useUpdateAgentDefinitionMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({}),
  })
  mocks.useUpdateAgentDefinitionStatusMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({}),
    variables: undefined,
  })
})

afterEach(() => cleanup())

describe('agentDefinition 管理页', () => {
  it('显示列表和草稿状态，资源查询失败时提供重试', () => {
    renderPage()

    expect(screen.getByText('Code Agent')).toBeTruthy()
    expect(screen.getByText('草稿')).toBeTruthy()

    mocks.useAdminAiToolsQuery.mockReturnValueOnce({
      data: undefined,
      error: new Error('tools failed'),
      isLoading: false,
      refetch: vi.fn(),
    })
    cleanup()
    renderPage()
    expect(screen.getByText('Agent 资源选项加载失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy()
  })

  it('创建 Agent 时只提交配置引用，不提交 Prompt 内容', async () => {
    const create = vi.fn().mockResolvedValue({})
    mocks.useCreateAgentDefinitionMutation.mockReturnValue({ isPending: false, mutateAsync: create })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '新建 Agent' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New Agent' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    const input = create.mock.calls[0]?.[0]
    expect(input).toMatchObject({ name: 'New Agent', config: { schemaVersion: 1, model: null, systemPromptId: null } })
    expect(JSON.stringify(input)).not.toContain('hidden from Agent form payload')
  })

  it('没有 ai:config:manage 时隐藏创建和编辑/状态操作', () => {
    mocks.useCurrentPermissionsQuery.mockReturnValue({
      data: { permissions: ['ai:config:read'] },
      error: null,
      isError: false,
      isPending: false,
      isSuccess: true,
    })
    renderPage()

    expect(screen.queryByRole('button', { name: '新建 Agent' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '启用' })).toBeNull()
  })

  it('空列表显示空态，状态请求 pending 时显示 loading', () => {
    mocks.useAdminAgentDefinitionsQuery.mockReturnValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('还没有 Agent 配置')).toBeTruthy()

    cleanup()
    mocks.useAdminAgentDefinitionsQuery.mockReturnValueOnce({
      data: {
        items: [
          {
            id: '01900000-0000-7000-8000-000000000010',
            name: 'Code Agent',
            description: 'Review code',
            status: 'draft',
            revision: 1,
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
            config,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })
    mocks.useUpdateAgentDefinitionStatusMutation.mockReturnValueOnce({
      isPending: true,
      mutateAsync: vi.fn(),
      variables: { agentId: '01900000-0000-7000-8000-000000000010' },
    })
    renderPage()
    expect(screen.getByRole('button', { name: '启用' }).className).toContain('ant-btn-loading')
  })
})
