import type { AiModelCallAuditDetail, AiModelCallAuditList } from '@starter/contracts'

import '@admin/i18n'

import { AiUsageAudit } from '@admin/features/ai/pages/AiUsageAudit'
import { App as AntdApp } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAiUsageCallQuery: vi.fn(),
  useAiUsageCallsQuery: vi.fn(),
}))

vi.mock('@admin/api/ai', () => mocks)

const call = {
  id: '01958c80-8df7-7ce2-8f90-123456789001',
  requestId: 'request-1',
  userId: 'user-1',
  scenario: 'model_test',
  conversationId: null,
  generationId: null,
  providerId: 'openai',
  modelId: 'gpt-4o',
  startedAt: '2025-01-01T00:00:00.000Z',
  timeoutMs: 120000,
  finishedAt: '2025-01-01T00:00:01.000Z',
  durationMs: 1000,
  result: 'succeeded',
  stopReason: 'stop',
  errorCode: null,
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    totalTokens: 0,
  },
  cost: { currency: 'USD', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} satisfies AiModelCallAuditList['items'][number]

function renderPage() {
  return render(
    <AntdApp>
      <AiUsageAudit />
    </AntdApp>,
  )
}

beforeEach(() => {
  mocks.useAiUsageCallsQuery.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAiUsageCallQuery.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() })
})

afterEach(() => cleanup())

describe('ai usage audit page', () => {
  it('显示 loading、empty 和 error 状态', () => {
    mocks.useAiUsageCallsQuery.mockReturnValueOnce({ data: undefined, isLoading: true, error: null, refetch: vi.fn() })
    renderPage()
    expect(document.querySelector('.ant-spin')).toBeTruthy()
    cleanup()

    mocks.useAiUsageCallsQuery.mockReturnValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('没有模型调用记录')).toBeTruthy()
    cleanup()

    mocks.useAiUsageCallsQuery.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error('load failed'),
      refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('AI 用量记录加载失败')).toBeTruthy()
  })

  it('显示字段白名单、筛选和分页结果', () => {
    const list: AiModelCallAuditList = { items: [call], total: 1, page: 1, pageSize: 20 }
    mocks.useAiUsageCallsQuery.mockReturnValue({ data: list, isLoading: false, error: null, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('gpt-4o')).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('request-1')).toBeTruthy()
    expect(screen.queryByText('prompt')).toBeNull()
    expect(screen.queryByText('response')).toBeNull()
    expect(screen.getByText('查询')).toBeTruthy()
  })

  it('点击调用打开详情 Drawer 并展示工具状态', async () => {
    const detail: AiModelCallAuditDetail = {
      ...call,
      toolExecutions: [
        {
          id: '01958c80-8df7-7ce2-8f90-123456789002',
          toolName: 'lookup',
          status: 'succeeded',
          startedAt: call.startedAt,
          finishedAt: call.finishedAt,
          durationMs: 10,
          timeoutMs: 5000,
          errorCode: null,
        },
      ],
    }
    mocks.useAiUsageCallsQuery.mockReturnValue({
      data: { items: [call], total: 1, page: 1, pageSize: 20 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useAiUsageCallQuery.mockReturnValue({ data: detail, isLoading: false, error: null, refetch: vi.fn() })
    renderPage()

    fireEvent.click(screen.getByText('gpt-4o'))
    await waitFor(() => expect(screen.getByText('模型调用详情')).toBeTruthy())
    expect(screen.getByText('lookup')).toBeTruthy()
  })
})
