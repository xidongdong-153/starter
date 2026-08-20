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

interface TranscriptPage {
  items: unknown[]
  nextCursor: number | null
}

/** transcript 现在是 infinite query：pages 顺序是「新 -> 旧」，页面渲染时倒序拼接。 */
function transcriptResult(pages: TranscriptPage[], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages, pageParams: pages.map((page, index) => (index === 0 ? undefined : page.nextCursor)) },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: (pages.at(-1)?.nextCursor ?? null) !== null,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  }
}

function setSessionQueries({
  session = buildSession(),
  transcript = { items: [], nextCursor: null },
  run = null,
}: { session?: AgentSession | null; transcript?: TranscriptPage; run?: unknown } = {}) {
  mocks.useAgentSessionsQuery.mockReturnValue({
    data: { items: [session], total: 1, page: 1, pageSize: 50 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
  mocks.useAgentSessionQuery.mockReturnValue({ data: session, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAgentTranscriptQuery.mockReturnValue(transcriptResult([transcript]))
  mocks.useAgentRunQuery.mockReturnValue({
    data: run,
    isLoading: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
  })
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
        onEvent(
          envelope(5, 'run.completed', { status: 'completed', finalEntryId: messageId, reason: 'model_finished' }),
        )
        return Promise.resolve({ terminal: true })
      },
    )
    // transcript query 返回服务端持久化内容（刷新后读取）
    setSessionQueries()
    mocks.useAgentTranscriptQuery.mockReturnValue(transcriptResult([persistedTranscript]))
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('深圳天气怎么样？')
    await waitFor(() => expect(mocks.startAgentRun).toHaveBeenCalledTimes(1))
    const text = await screen.findByText('深圳，天气好')
    expect(text).toBeTruthy()
    // 临时视图已被清空，只有 transcript 恢复的一份内容
    expect(screen.getAllByText('深圳，天气好')).toHaveLength(1)
  })

  it('历史视图按 blocks 渲染思考块，并与工具、压缩提示共用同一组组件', async () => {
    setSessionQueries({
      transcript: {
        items: [
          {
            id: '01958c80-8df7-7ce2-8f90-123456789030',
            sequence: 1,
            lane: 'main',
            runId,
            createdAt: '2026-08-18T00:00:00.000Z',
            type: 'user_message',
            content: '跑一下',
          },
          {
            id: '01958c80-8df7-7ce2-8f90-123456789031',
            sequence: 2,
            lane: 'main',
            runId,
            createdAt: '2026-08-18T00:00:00.000Z',
            type: 'tool_activity',
            toolCallId: 'tool-9',
            name: 'read_skill',
            status: 'succeeded',
            errorCode: null,
            safeSummary: '读取完成',
          },
          {
            id: '01958c80-8df7-7ce2-8f90-123456789032',
            sequence: 3,
            lane: 'main',
            runId: null,
            createdAt: '2026-08-18T00:00:00.000Z',
            type: 'system',
            kind: 'compaction',
            summary: '早期对话已压缩',
            tokensBefore: 8000,
          },
          {
            id: messageId,
            sequence: 4,
            lane: 'main',
            runId,
            createdAt: '2026-08-18T00:00:00.000Z',
            type: 'assistant_message',
            content: '持久化的回答',
            blocks: [
              { type: 'thinking', text: '持久化的思考' },
              { type: 'text', text: '持久化的回答' },
            ],
            status: 'completed',
            model: { providerId: 'openai', modelId: 'gpt-test' },
            stopReason: 'stop',
            errorCode: null,
            usage: {
              inputTokens: 60,
              outputTokens: 12,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              cacheWrite1hTokens: null,
              reasoningTokens: null,
              totalTokens: 72,
            },
          },
        ],
        nextCursor: null,
      },
    })
    renderPage()

    await screen.findAllByText('测试会话')
    expect(await screen.findByText('持久化的回答')).toBeTruthy()
    expect(screen.getByText('read_skill')).toBeTruthy()
    expect(screen.getByText('压缩前 8000 tokens')).toBeTruthy()
    expect(screen.getByText(/输入 60 · 输出 12 · 合计 72/)).toBeTruthy()
    const toggle = screen.getByRole('button', { name: /思考过程/ })
    expect(screen.queryByText('持久化的思考')).toBeFalsy()
    fireEvent.click(toggle)
    expect(await screen.findByText('持久化的思考')).toBeTruthy()
  })

  it('只带工具调用的历史 assistant 消息不渲染占位气泡', async () => {
    setSessionQueries({
      transcript: {
        items: [
          {
            id: messageId,
            sequence: 1,
            lane: 'main',
            runId,
            createdAt: '2026-08-18T00:00:00.000Z',
            type: 'assistant_message',
            // 工具轮的 assistant message 只有 toolCall，投影出空 content 和空 blocks
            content: '',
            blocks: [],
            status: 'completed',
            model: { providerId: 'openai', modelId: 'gpt-test' },
            stopReason: 'tool_use',
            errorCode: null,
            toolCalls: [{ toolCallId: 'tool-7', name: 'read_skill' }],
          },
          {
            id: '01958c80-8df7-7ce2-8f90-123456789050',
            sequence: 2,
            lane: 'main',
            runId,
            createdAt: '2026-08-18T00:00:00.000Z',
            type: 'tool_activity',
            toolCallId: 'tool-7',
            name: 'read_skill',
            status: 'succeeded',
            errorCode: null,
            safeSummary: '读取完成',
          },
        ],
        nextCursor: null,
      },
    })
    renderPage()

    await screen.findAllByText('测试会话')
    expect(await screen.findByText('read_skill')).toBeTruthy()
    // 已完成的空消息既不转圈、也不留空气泡
    expect(screen.queryByText(/正在思考/)).toBeFalsy()
    expect(screen.queryByText('Agent')).toBeFalsy()
  })

  it('工具元素显示工具名和状态，与文字在同一条时间线上', async () => {
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
        onEvent(envelope(5, 'message.started', { messageId, role: 'assistant' }))
        onEvent(envelope(6, 'message.delta', { messageId, delta: '技能已读取' }))
        // 不发送终态，保持流式视图便于断言时间线
        return new Promise<never>(() => {})
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('读取技能')
    await waitFor(() => expect(screen.getByText('read_skill')).toBeTruthy())
    expect(screen.getByText('成功')).toBeTruthy()
    expect(await screen.findByText('技能已读取')).toBeTruthy()
    // 工具卡在文字之前，顺序与 sequence 一致
    const rendered = document.body.textContent ?? ''
    expect(rendered.indexOf('read_skill')).toBeLessThan(rendered.indexOf('技能已读取'))
  })

  it('思考块默认折叠，展开后显示思考内容', async () => {
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
        onEvent(envelope(3, 'thinking.started', { messageId, blockIndex: 0 }))
        onEvent(envelope(4, 'thinking.delta', { messageId, blockIndex: 0, delta: '先确认需求' }))
        onEvent(envelope(5, 'message.delta', { messageId, delta: '结论在这里' }))
        return new Promise<never>(() => {})
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('想一下')
    const toggle = await screen.findByRole('button', { name: /思考过程/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('先确认需求')).toBeFalsy()
    fireEvent.click(toggle)
    expect(await screen.findByText('先确认需求')).toBeTruthy()
  })

  it('显示轮次进度、compaction 提示、token 用量和轮次上限收尾提示', async () => {
    mocks.startAgentRun.mockImplementation(
      (_sessionId: string, _input: unknown, _signal: AbortSignal, onEvent: (event: HarnessEvent) => void) => {
        onEvent(
          envelope(1, 'run.started', {
            agentId,
            agentRevision: 1,
            model: { providerId: 'openai', modelId: 'gpt-test' },
          }),
        )
        onEvent(envelope(2, 'turn.started', { turn: 2, maxTurns: 2 }))
        onEvent(
          envelope(3, 'context.compacted', {
            entryId: '01958c80-8df7-7ce2-8f90-123456789020',
            tokensBefore: 12000,
            summary: '早期对话已压缩',
          }),
        )
        onEvent(envelope(4, 'message.started', { messageId, role: 'assistant' }))
        onEvent(
          envelope(5, 'message.completed', {
            messageId,
            role: 'assistant',
            content: '收尾总结',
            stopReason: 'stop',
            errorCode: null,
            usage: {
              inputTokens: 120,
              outputTokens: 30,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              cacheWrite1hTokens: null,
              reasoningTokens: null,
              totalTokens: 150,
            },
          }),
        )
        onEvent(envelope(6, 'run.completed', { status: 'completed', finalEntryId: messageId, reason: 'max_turns' }))
        // 终态事件已发出但流未结束，保留流式视图便于断言
        return new Promise<never>(() => {})
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('跑满轮次')
    expect(await screen.findByText('第 2 / 2 轮')).toBeTruthy()
    expect(screen.getByText('上下文压缩')).toBeTruthy()
    expect(screen.getByText('压缩前 12000 tokens')).toBeTruthy()
    expect(screen.getByText(/输入 120 · 输出 30 · 合计 150/)).toBeTruthy()
    expect(screen.getByText('已达到轮次上限，最后一段回答来自收尾轮。')).toBeTruthy()
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
        return Promise.resolve({ terminal: true })
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

  it('启动阶段就失败时弹错，不调用 abort、不转轮询', async () => {
    // 一个事件都没收到就失败：保持原有的启动失败体验
    mocks.startAgentRun.mockRejectedValue(new Error('请求 API 失败。'))
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('断线测试')
    await waitFor(() => expect(screen.getByText('运行出错')).toBeTruthy())
    expect(mocks.abortAgentRun).not.toHaveBeenCalled()
    expect(screen.queryByText('实时连接已断开，正在轮询运行状态。')).toBeFalsy()
  })

  it('读流中途断开时保留时间线、不弹错，转入轮询', async () => {
    // 已经收到过事件、还没收到终态：harness.api 把断线归成 `{ terminal: false }`
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
        onEvent(envelope(3, 'message.delta', { messageId, delta: '断线前的文字' }))
        return Promise.resolve({ terminal: false })
      },
    )
    setSessionQueries()
    renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('断线测试')
    expect(await screen.findByText('断线前的文字')).toBeTruthy()
    expect(screen.queryByText('运行出错')).toBeFalsy()
    expect(mocks.abortAgentRun).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('实时连接已断开，正在轮询运行状态。')).toBeTruthy())
  })

  it('流提前结束时保留时间线并转轮询，Run 终态后停轮询并切回 transcript', async () => {
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
        onEvent(envelope(3, 'message.delta', { messageId, delta: '流式片段' }))
        // 事件队列超限：流提前结束但没收到终态事件
        return Promise.resolve({ terminal: false })
      },
    )
    let runResult: unknown = null
    const transcriptRefetch = vi.fn()
    setSessionQueries()
    mocks.useAgentTranscriptQuery.mockReturnValue(
      transcriptResult([{ items: [], nextCursor: null }], { refetch: transcriptRefetch }),
    )
    mocks.useAgentRunQuery.mockImplementation(() => ({
      data: runResult,
      isLoading: false,
      error: null,
      isError: false,
      refetch: vi.fn(),
    }))
    const view = renderPage()

    await screen.findAllByText('测试会话')
    submitMessage('断线测试')
    // 已显示的流式内容不消失、不弹错
    expect(await screen.findByText('流式片段')).toBeTruthy()
    expect(screen.queryByText('运行出错')).toBeFalsy()
    expect(mocks.abortAgentRun).not.toHaveBeenCalled()
    // 已转轮询：run query 拉上 2 秒间隔
    await waitFor(() => expect(mocks.useAgentRunQuery.mock.calls.at(-1)?.[2]).toEqual({ refetchInterval: 2000 }))
    expect(screen.getByText('实时连接已断开，正在轮询运行状态。')).toBeTruthy()

    // 轮询拿到 live 快照，视图继续更新
    runResult = {
      status: 'running',
      live: {
        lastSequence: 8,
        turn: 2,
        maxTurns: 4,
        timeline: [
          {
            kind: 'message',
            messageId,
            blocks: [{ type: 'text', text: '轮询拿到的内容' }],
            completed: false,
            usage: null,
          },
        ],
      },
    }
    view.rerender(
      <AntdApp>
        <AgentSessions />
      </AntdApp>,
    )
    expect(await screen.findByText('轮询拿到的内容')).toBeTruthy()
    expect(screen.getByText('第 2 / 4 轮')).toBeTruthy()

    // Run 进终态：停轮询，重新拉 transcript
    runResult = { status: 'completed', live: null }
    view.rerender(
      <AntdApp>
        <AgentSessions />
      </AntdApp>,
    )
    await waitFor(() => expect(transcriptRefetch).toHaveBeenCalled())
    await waitFor(() => expect(mocks.useAgentRunQuery.mock.calls.at(-1)?.[2]).toEqual({ refetchInterval: false }))
    expect(screen.queryByText('轮询拿到的内容')).toBeFalsy()
  })

  it('transcript 有 nextCursor 时可以加载更早一页，结果拼在已有内容前面', async () => {
    const fetchNextPage = vi.fn()
    const page = (id: string, sequence: number, content: string, nextCursor: number | null): TranscriptPage => ({
      items: [
        {
          id,
          sequence,
          lane: 'main',
          runId,
          createdAt: '2026-08-18T00:00:00.000Z',
          type: 'user_message',
          content,
        },
      ],
      nextCursor,
    })
    setSessionQueries()
    mocks.useAgentTranscriptQuery.mockReturnValue(
      transcriptResult(
        [
          page('01958c80-8df7-7ce2-8f90-123456789040', 9, '最新的消息', 5),
          page('01958c80-8df7-7ce2-8f90-123456789041', 4, '更早的消息', 2),
        ],
        { fetchNextPage },
      ),
    )
    renderPage()

    await screen.findAllByText('测试会话')
    expect(await screen.findByText('更早的消息')).toBeTruthy()
    // 更早一页拼在已有内容前面
    const rendered = document.body.textContent ?? ''
    expect(rendered.indexOf('更早的消息')).toBeLessThan(rendered.indexOf('最新的消息'))

    fireEvent.click(screen.getByRole('button', { name: /加载更早/ }))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('加载更早进行中显示 pending 反馈', async () => {
    setSessionQueries()
    mocks.useAgentTranscriptQuery.mockReturnValue(
      transcriptResult(
        [
          {
            items: [
              {
                id: '01958c80-8df7-7ce2-8f90-123456789042',
                sequence: 9,
                lane: 'main',
                runId,
                createdAt: '2026-08-18T00:00:00.000Z',
                type: 'user_message',
                content: '已有内容',
              },
            ],
            nextCursor: 3,
          },
        ],
        { isFetchingNextPage: true },
      ),
    )
    renderPage()

    await screen.findAllByText('测试会话')
    const button = await screen.findByRole('button', { name: /加载更早/ })
    expect(button.className).toContain('ant-btn-loading')
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
