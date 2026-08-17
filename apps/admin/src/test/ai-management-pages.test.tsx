import '@admin/i18n'

import { Skills } from '@admin/features/ai/pages/Skills'
import { SystemPrompts } from '@admin/features/ai/pages/SystemPrompts'
import { App as AntdApp } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAiSkillDetailQuery: vi.fn(),
  useCreateAiSkillMutation: vi.fn(),
  useDeleteAiSkillMutation: vi.fn(),
  useSkillsQuery: vi.fn(),
  useUpdateAiSkillMutation: vi.fn(),
  useCreateSystemPromptMutation: vi.fn(),
  useDeleteSystemPromptMutation: vi.fn(),
  useGlobalSystemPromptQuery: vi.fn(),
  useSetGlobalSystemPromptMutation: vi.fn(),
  useSystemPromptsQuery: vi.fn(),
  useUpdateSystemPromptMutation: vi.fn(),
}))

vi.mock('@admin/api/ai', () => mocks)

function renderPage(page: 'skills' | 'system-prompts') {
  return render(<AntdApp>{page === 'skills' ? <Skills /> : <SystemPrompts />}</AntdApp>)
}

beforeEach(() => {
  mocks.useAiSkillDetailQuery.mockReturnValue({ data: undefined, isLoading: false, error: null })
  mocks.useCreateAiSkillMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useDeleteAiSkillMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useSkillsQuery.mockReturnValue({
    data: [{ id: 'skill-1', name: 'sql-expert', description: 'SQL help', enabled: true }],
    isLoading: false,
    error: null,
  })
  mocks.useUpdateAiSkillMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useCreateSystemPromptMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useDeleteSystemPromptMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useGlobalSystemPromptQuery.mockReturnValue({ data: { systemPromptId: null }, isLoading: false, error: null })
  mocks.useSetGlobalSystemPromptMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useSystemPromptsQuery.mockReturnValue({
    data: [{ id: 'prompt-1', name: 'reviewer', content: 'Review code', enabled: true }],
    isLoading: false,
    error: null,
  })
  mocks.useUpdateSystemPromptMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
})

afterEach(() => cleanup())

describe('管理页面文案和无障碍入口', () => {
  it('技能页面使用独立的描述字段文案和必填提示', async () => {
    renderPage('skills')

    expect(
      screen.getByText(
        '管理模型可用的技能。技能名称和描述会注入系统提示词，完整内容由模型按需通过 read_skill 工具读取。',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '描述' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '新建技能' }))
    const descriptionInput = screen.getByLabelText('描述')
    fireEvent.change(descriptionInput, { target: { value: 'temporary' } })
    fireEvent.change(descriptionInput, { target: { value: '' } })

    await waitFor(() => expect(screen.getByText('请输入技能描述')).toBeTruthy())
  })

  it('系统提示词删除按钮有可访问名称', () => {
    renderPage('system-prompts')

    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()
  })
})
