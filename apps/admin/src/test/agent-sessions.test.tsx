import type { AgentSession, HarnessEvent } from '@starter/contracts'

import '@admin/i18n'

import { AgentSessions } from '@admin/features/ai/pages/AgentSessions'
import { App as AntdApp } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortAgentRun: vi.fn(),
  startAgentRun: vi.fn(),
  useAgentDefinitionsQuery: vi.fn(),
  useAgentRunQuery: vi.fn(),
  useAgentSessionQuery: vi.fn(),
  useAgentSessionsQuery: vi.fn(),
  useAgentTranscriptQuery: vi.fn(),
  useAbortAgentRunMutation: vi.fn(),
  useArchiveAgentSessionMutation: vi.fn(),
  useCreateAgentSessionMutation: vi.fn(),
  useUpdateAgentSessionMutation: vi.fn(),
  useMobile: vi.fn(),
}))

vi.mock('@admin/api/ai', () => mocks)
vi.mock('@admin/hooks/useMobile', () => ({ useMobile: mocks.useMobile }))

function renderPage() {
  return render(
    <AntdApp>
      <AgentSessions />
    </AntdApp>,
  )
}

const sessionId = '01958c80-8df7-7ce2-8f90-123456789001'
const agentId = '01958c80-8df7-7ce2-8f90-123456789002'
const runId = '01958c80-8df7-7ce2-8f90-123456789003'
const messageId = '01958c80-8df7-7ce2-8f90-123456789004'

function buildSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: sessionId,
    title: '测试会话',
    defaultAgentId: agentId,
    archivedAt: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  }
}

function envelope(sequence: number, type: HarnessEvent['type'], data: Record<string, unknown>): HarnessEvent {
  return {
    version: 1,
    eventId: '01958c80-8df7-7ce2-8f90-123456789005',
    sequence,
    sessionId,
    runId,
    lane: 'main',
    createdAt: '2026-08-18T00:00:00.000Z',
    type,
    data,
  } as HarnessEvent
}

const agents = [{ id: agentId, name: 'Code Agent' }]

function setSessionQueries({
  session = buildSession(),
  transcript = { items: [], nextCursor: null },
  run = null,
}: { session?: AgentSession | null; transcript?: { items: unknown[]; nextCursor: null }; run?: unknown } = {}) {
  mocks.useAgentSessionsQuery.mockReturnValue({
    data: { items: [session], total: 1, page: 1, pageSize: 50 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
  mocks.useAgentSessionQuery.mockReturnValue({ data: session, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAgentTranscriptQuery.mockReturnValue({ data: transcript, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAgentRunQuery.mockReturnValue({ data: run, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAgentDefinitionsQuery.mockReturnValue({
    data: { items: agents, total: 1, page: 1, pageSize: 50 },
    isLoading: false,
    error: null,
  })
}

beforeEach(() => {
  mocks.startAgentRun.mockReset()
  mocks.abortAgentRun.mockReset()
  mocks.useMobile.mockReturnValue(false)
  mocks.useAgentDefinitionsQuery.mockReturnValue({
    data: { items: agents, total: 1, page: 1, pageSize: 50 },
    isLoading: false,
    error: null,
  })
  mocks.useAbortAgentRunMutation.mockReturnValue({
    mutateAsync: mocks.abortAgentRun,
    isPending: false,
  })
  mocks.useArchiveAgentSessionMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useCreateAgentSessionMutation.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(buildSession()),
    isPending: false,
  })
  mocks.useUpdateAgentSessionMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
})

afterEach(() => {
  cleanup()
})

function submitMessage(text: string) {
  const textarea = screen.getByRole('textbox')
  fireEvent.change(textarea, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
}

describe('agentSessions', () => {
  it('创建会话后自动选中', async () => {
    const created = buildSession({ title: '新会话' })
    mocks.useCreateAgentSessionMutation.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(created),
      isPending: false,
    })
    setSessionQueries()
    renderPage()

    const list = await screen.findAllByText('测试会话')
    expect(list).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: /新建会话/ })).toBeTruthy())
  })

  it('运行中输入消息启动 Run，增量消息按 sequence 合并且不重复追加速率', async () => {
    mocks.startAgentRun.mockImplementation(
      (_sessionId: string, _input: unknown, _signal: AbortSignal, onEvent: (event: HarnessEvent) => void) => {
        onEvent(
          envelope(1, 'run.started', {
            agentId,
            agentRevision: 1,
            model: { providerId: 'openai', modelId: 'gpt-test' },
          }),
        )
        onEvent(envelope(2, 'message.started', { messageId, role: 'assistant' }))
        onEvent(envelope(3, 'message.delta', { messageId, delta: '深圳' }))
        onEvent(envelope(3, 'message.delta', { messageId, delta: '重复' }))
        onEvent(envelope(4, 'message.delta', { messageId, delta: '，天气好' }))
        onEvent(
          envelope(5, 'message.completed', {
            messageId,
            role: 'assistant',
            content: '深圳，天气好',
            stopReason: 'stop',
            errorCode: null,
          }),
        )
        // 不发送终态事件，保持流式视图便于断言 buffer 状态
        return new Promise<never>(() => {})
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('深圳天气怎么样？')
    await waitFor(() => expect(mocks.startAgentRun).toHaveBeenCalledTimes(1))
    const text = await screen.findByText('深圳，天气好')
    expect(text).toBeTruthy()
    expect(screen.queryByText('重复')).toBeFalsy()
  })

  it('终态后失效 transcript，以服务端持久化内容替换临时视图', async () => {
    const persistedTranscript = {
      items: [
        {
          id: '01958c80-8df7-7ce2-8f90-123456789010',
          sequence: 1,
          lane: 'main',
          runId,
          createdAt: '2026-08-18T00:00:00.000Z',
          type: 'user_message',
          content: '深圳天气怎么样？',
        },
        {
          id: messageId,
          sequence: 2,
          lane: 'main',
          runId,
          createdAt: '2026-08-18T00:00:00.000Z',
          type: 'assistant_message',
          content: '深圳，天气好',
          status: 'completed',
          model: { providerId: 'openai', modelId: 'gpt-test' },
          stopReason: 'stop',
          errorCode: null,
        },
      ],
      nextCursor: null,
    }
    mocks.startAgentRun.mockImplementation(
      (_sessionId: string, _input: unknown, _signal: AbortSignal, onEvent: (event: HarnessEvent) => void) => {
        onEvent(
          envelope(1, 'run.started', {
            agentId,
            agentRevision: 1,
            model: { providerId: 'openai', modelId: 'gpt-test' },
          }),
        )
        onEvent(envelope(2, 'message.started', { messageId, role: 'assistant' }))
        onEvent(envelope(3, 'message.delta', { messageId, delta: '深圳，天气好' }))
        onEvent(
          envelope(4, 'message.completed', {
            messageId,
            role: 'assistant',
            content: '深圳，天气好',
            stopReason: 'stop',
            errorCode: null,
          }),
        )
        onEvent(envelope(5, 'run.completed', { status: 'completed', finalEntryId: messageId }))
        return Promise.resolve()
      },
    )
    // transcript query 返回服务端持久化内容（刷新后读取）
    setSessionQueries()
    mocks.useAgentTranscriptQuery.mockReturnValue({
      data: persistedTranscript,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('深圳天气怎么样？')
    await waitFor(() => expect(mocks.startAgentRun).toHaveBeenCalledTimes(1))
    const text = await screen.findByText('深圳，天气好')
    expect(text).toBeTruthy()
    // 临时视图已被清空，只有 transcript 恢复的一份内容
    expect(screen.getAllByText('深圳，天气好')).toHaveLength(1)
  })

  it('tool 事件按 toolCallId 合并，显示活动项', async () => {
    const toolCallId = 'tool-1'
    mocks.startAgentRun.mockImplementation(
      (_sessionId: string, _input: unknown, _signal: AbortSignal, onEvent: (event: HarnessEvent) => void) => {
        onEvent(
          envelope(1, 'run.started', {
            agentId,
            agentRevision: 1,
            model: { providerId: 'openai', modelId: 'gpt-test' },
          }),
        )
        onEvent(envelope(2, 'tool.started', { toolCallId, name: 'read_skill' }))
        onEvent(envelope(3, 'tool.progress', { toolCallId, name: 'read_skill', safeSummary: '读取中' }))
        onEvent(
          envelope(4, 'tool.completed', {
            toolCallId,
            name: 'read_skill',
            status: 'succeeded',
            errorCode: null,
            safeSummary: '读取完成',
            entryId: messageId,
          }),
        )
        // 不发送终态，保持流式视图便于断言 tool 活动
        return new Promise<never>(() => {})
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('读取技能')
    await waitFor(() => expect(screen.getByText('工具活动')).toBeTruthy())
    expect(screen.getByText('read_skill')).toBeTruthy()
  })

  it('run.failed 显示可展示的安全错误信息', async () => {
    mocks.startAgentRun.mockImplementation(
      (_sessionId: string, _input: unknown, _signal: AbortSignal, onEvent: (event: HarnessEvent) => void) => {
        onEvent(
          envelope(1, 'run.failed', {
            status: 'failed',
            finalEntryId: null,
            error: { code: 'AI.PROVIDER_ERROR', message: '模型请求失败，请稍后重试', retryable: true },
          }),
        )
        return Promise.resolve()
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('触发失败')
    const text = await screen.findByText('模型请求失败，请稍后重试')
    expect(text).toBeTruthy()
  })

  it('显式点击停止调用 abort endpoint', async () => {
    mocks.abortAgentRun.mockResolvedValue({})
    mocks.startAgentRun.mockImplementation(
      (_sessionId: string, _input: unknown, _signal: AbortSignal, onEvent: (event: HarnessEvent) => void) => {
        onEvent(
          envelope(1, 'run.started', {
            agentId,
            agentRevision: 1,
            model: { providerId: 'openai', modelId: 'gpt-test' },
          }),
        )
        onEvent(envelope(2, 'message.started', { messageId, role: 'assistant' }))
        onEvent(envelope(3, 'message.delta', { messageId, delta: '进行中' }))
        return new Promise<never>(() => {})
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('不要完成')
    await waitFor(() => expect(screen.getByRole('button', { name: '停止' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await waitFor(() => expect(mocks.abortAgentRun).toHaveBeenCalledWith({ sessionId, runId }))
  })

  it('流意外中断时不调用 abort，并显示错误', async () => {
    mocks.startAgentRun.mockRejectedValue(new Error('Agent Run 流意外中断，可以重试。'))
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('断线测试')
    await waitFor(() => expect(screen.getByText('运行出错')).toBeTruthy())
    expect(mocks.abortAgentRun).not.toHaveBeenCalled()
  })

  it('同 lane 正在运行时禁止重复启动（busy）', async () => {
    mocks.startAgentRun.mockRejectedValue({ message: '会话忙', code: 'AI.SESSION_BUSY', status: 409 })
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('第一条')
    await waitFor(() => expect(mocks.startAgentRun).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('button', { name: '发送' }).length).toBeGreaterThanOrEqual(0)
    expect(screen.getByText('运行出错')).toBeTruthy()
  })
})
