import type { AiConversationStreamEvent } from '@starter/contracts'

import '@admin/i18n'

import { AiConversations } from '@admin/features/ai/pages/AiConversations'
import { App as AntdApp } from 'antd'
import { fireEvent, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  retryAiConversation: vi.fn(),
  stopGeneration: vi.fn(),
  streamAiConversation: vi.fn(),
  useAiConversationQuery: vi.fn(),
  useAiConversationsQuery: vi.fn(),
  useAiModelsQuery: vi.fn(),
  useAiPreferenceQuery: vi.fn(),
  useCreateAiConversationMutation: vi.fn(),
  useDeleteAiConversationMutation: vi.fn(),
  useStopAiConversationGenerationMutation: vi.fn(),
  useMobile: vi.fn(),
}))

vi.mock('@admin/api/ai', () => mocks)
vi.mock('@admin/hooks/useMobile', () => ({ useMobile: mocks.useMobile }))

function renderPage() {
  return render(
    <AntdApp>
      <AiConversations />
    </AntdApp>,
  )
}

const conversationId = '01958c80-8df7-7ce2-8f90-123456789001'
const oldGenerationId = '01958c80-8df7-7ce2-8f90-123456789002'
const currentGenerationId = '01958c80-8df7-7ce2-8f90-123456789003'
const model = {
  providerId: 'openai',
  modelId: 'gpt-4o',
  name: 'GPT-4o',
  providerName: 'OpenAI',
  capabilities: {
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsImageInput: false,
    supportsReasoning: false,
    supportsTools: true,
  },
}

const summary = {
  id: conversationId,
  title: '测试会话',
  status: 'idle',
  activeGenerationId: null,
  lastModel: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

function setConversationQueries(
  detail: Record<string, unknown>,
  list = { items: [summary], total: 1, page: 1, pageSize: 20 },
) {
  mocks.useAiConversationsQuery.mockReturnValue({ data: list, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAiConversationQuery.mockReturnValue({ data: detail, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAiModelsQuery.mockReturnValue({ data: [model], isLoading: false, error: null, refetch: vi.fn() })
}

beforeEach(() => {
  mocks.retryAiConversation.mockReset()
  mocks.stopGeneration.mockReset()
  mocks.streamAiConversation.mockReset()
  mocks.useMobile.mockReturnValue(false)
  mocks.useAiModelsQuery.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAiPreferenceQuery.mockReturnValue({ data: { effectiveModel: null }, isLoading: false, error: null })
  mocks.useAiConversationQuery.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useAiConversationsQuery.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() })
  mocks.useCreateAiConversationMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useDeleteAiConversationMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mocks.useStopAiConversationGenerationMutation.mockReturnValue({
    mutateAsync: mocks.stopGeneration,
    isPending: false,
  })
})

afterEach(() => {
  cleanup()
})

describe('ai conversations page state', () => {
  it('显示会话为空状态和创建入口', () => {
    mocks.useAiConversationsQuery.mockReturnValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText('还没有会话')).toBeTruthy()
    expect(screen.getAllByText('新建会话').length).toBeGreaterThan(0)
  })

  it('加载会话列表时显示 loading 状态', () => {
    mocks.useAiConversationsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() })
    mocks.useAiModelsQuery.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() })

    renderPage()

    expect(document.querySelector('.ant-spin')).toBeTruthy()
  })

  it('会话列表失败时显示错误和重试入口', () => {
    mocks.useAiConversationsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('request failed'),
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText('会话列表加载失败')).toBeTruthy()
    expect(screen.getByText('request failed')).toBeTruthy()
    expect(screen.getByText('重新加载')).toBeTruthy()
  })

  it('服务端已有 active generation 时禁用发送并提供停止操作', async () => {
    setConversationQueries({
      ...summary,
      status: 'generating',
      activeGenerationId: oldGenerationId,
      messages: [],
    })

    renderPage()

    expect(await screen.findByRole('button', { name: '停止生成' })).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('当前 stream generation 优先于详情缓存中的旧 generation', async () => {
    let cachedGenerationId: string | null = null
    mocks.useAiConversationsQuery.mockReturnValue({
      data: { items: [summary], total: 1, page: 1, pageSize: 20 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useAiConversationQuery.mockImplementation(() => ({
      data: {
        ...summary,
        status: cachedGenerationId ? 'generating' : 'idle',
        activeGenerationId: cachedGenerationId,
        messages: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }))
    mocks.useAiModelsQuery.mockReturnValue({ data: [model], isLoading: false, error: null, refetch: vi.fn() })
    mocks.streamAiConversation.mockImplementation(
      (_input: unknown, signal: AbortSignal, onEvent: (event: AiConversationStreamEvent) => void) => {
        cachedGenerationId = oldGenerationId
        onEvent({
          type: 'start',
          requestId: 'request-1',
          conversationId,
          generationId: currentGenerationId,
          assistantMessageId: '01958c80-8df7-7ce2-8f90-123456789004',
          model: { providerId: model.providerId, modelId: model.modelId },
        })
        return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      },
    )
    mocks.stopGeneration.mockResolvedValue({
      id: currentGenerationId,
      conversationId,
      status: 'generating',
      userMessageId: '01958c80-8df7-7ce2-8f90-123456789005',
      assistantMessageId: '01958c80-8df7-7ce2-8f90-123456789004',
      retryOfGenerationId: null,
      errorCode: null,
      startedAt: '2025-01-01T00:00:00.000Z',
      finishedAt: null,
    })

    renderPage()
    const input = await screen.findByRole('textbox')
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('hello')).toBeTruthy()
    const stopButton = await screen.findByRole('button', { name: '停止生成' })
    expect((input as HTMLTextAreaElement).disabled).toBe(true)
    fireEvent.click(stopButton)

    await waitFor(() =>
      expect(mocks.stopGeneration).toHaveBeenCalledWith({
        conversationId,
        generationId: currentGenerationId,
      }),
    )
  })

  it('新建会话成功后取消旧 stream 并隔离旧 generation', async () => {
    setConversationQueries({ ...summary, activeGenerationId: null, messages: [] })
    let oldSignal: AbortSignal | undefined
    mocks.streamAiConversation.mockImplementation(
      (_input: unknown, signal: AbortSignal, onEvent: (event: AiConversationStreamEvent) => void) => {
        oldSignal = signal
        onEvent({
          type: 'start',
          requestId: 'request-1',
          conversationId,
          generationId: currentGenerationId,
          assistantMessageId: '01958c80-8df7-7ce2-8f90-123456789004',
          model: { providerId: model.providerId, modelId: model.modelId },
        })
        return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      },
    )
    mocks.useCreateAiConversationMutation.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        ...summary,
        id: '01958c80-8df7-7ce2-8f90-123456789099',
      }),
      isPending: false,
    })

    renderPage()
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByRole('button', { name: '停止生成' })
    fireEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]!)

    await waitFor(() => expect(oldSignal?.aborted).toBe(true))
  })

  it('停止请求失败时保持当前 generation 和禁用状态', async () => {
    setConversationQueries({
      ...summary,
      status: 'generating',
      activeGenerationId: oldGenerationId,
      messages: [],
    })
    mocks.stopGeneration.mockRejectedValue(new Error('stop failed'))

    renderPage()
    const input = await screen.findByRole('textbox')
    fireEvent.click(await screen.findByRole('button', { name: '停止生成' }))

    await waitFor(() => expect(mocks.stopGeneration).toHaveBeenCalledTimes(1))
    expect((input as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '停止生成' })).toBeTruthy()
  })

  it('最新 interrupted assistant 可以重试', async () => {
    setConversationQueries({
      ...summary,
      messages: [
        {
          id: '01958c80-8df7-7ce2-8f90-123456789004',
          conversationId,
          sequence: 1,
          role: 'assistant',
          blocks: [],
          status: 'interrupted',
          model: null,
          stopReason: null,
          errorCode: 'AI.GENERATION_INTERRUPTED',
          generationId: oldGenerationId,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
          completedAt: '2025-01-01T00:00:01.000Z',
        },
      ],
    })

    renderPage()

    expect(await screen.findByRole('button', { name: '重试生成' })).toBeTruthy()
  })
})
