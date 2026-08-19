import type { HarnessEvent } from '@starter/contracts'
import { describe, expect, it } from 'vitest'

import { createEmptyHarnessStreamState, reduceHarnessEvent } from '@admin/features/ai/harness/stream-reducer'

const sessionId = '01958c80-8df7-7ce2-8f90-123456789001'
const runId = '01958c80-8df7-7ce2-8f90-123456789002'
const lane = 'main'
const createdAt = '2026-08-18T00:00:00.000Z'

function envelope(sequence: number, type: HarnessEvent['type'], data: Record<string, unknown>): HarnessEvent {
  return {
    version: 1,
    eventId: '01958c80-8df7-7ce2-8f90-123456789003',
    sequence,
    sessionId,
    runId,
    lane,
    createdAt,
    type,
    data,
  } as HarnessEvent
}

describe('reduceHarnessEvent', () => {
  it('run.started 记录模型并推进 sequence', () => {
    const state = reduceHarnessEvent(
      createEmptyHarnessStreamState(),
      envelope(1, 'run.started', {
        agentId: sessionId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
      }),
    )
    expect(state.runId).toBe(runId)
    expect(state.lastSequence).toBe(1)
    expect(state.model).toEqual({ providerId: 'openai', modelId: 'gpt-test' })
  })

  it('同一 Run 内 sequence 去重，重复或乱序事件不重复追加', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789004'
    let state = createEmptyHarnessStreamState()
    state = reduceHarnessEvent(
      state,
      envelope(1, 'run.started', {
        agentId: sessionId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
      }),
    )
    state = reduceHarnessEvent(state, envelope(2, 'message.started', { messageId, role: 'assistant' }))
    state = reduceHarnessEvent(state, envelope(3, 'message.delta', { messageId, delta: '深圳' }))
    state = reduceHarnessEvent(state, envelope(3, 'message.delta', { messageId, delta: '重复' }))
    state = reduceHarnessEvent(state, envelope(4, 'message.delta', { messageId, delta: '，天气好' }))
    expect(state.messages[0]?.content).toBe('深圳，天气好')
  })

  it('message.completed 用服务端内容替换临时 buffer', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789005'
    let state = createEmptyHarnessStreamState()
    state = reduceHarnessEvent(
      state,
      envelope(1, 'run.started', {
        agentId: sessionId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
      }),
    )
    state = reduceHarnessEvent(state, envelope(2, 'message.started', { messageId, role: 'assistant' }))
    state = reduceHarnessEvent(state, envelope(3, 'message.delta', { messageId, delta: '草稿' }))
    state = reduceHarnessEvent(
      state,
      envelope(4, 'message.completed', {
        messageId,
        role: 'assistant',
        content: '最终内容',
        stopReason: 'stop',
        errorCode: null,
      }),
    )
    const message = state.messages.find((item) => item.messageId === messageId)
    expect(message?.content).toBe('最终内容')
    expect(message?.completed).toBe(true)
    expect(message?.stopReason).toBe('stop')
  })

  it('tool 事件按 toolCallId 合并为同一活动项', () => {
    const toolCallId = 'tool-1'
    let state = createEmptyHarnessStreamState()
    state = reduceHarnessEvent(
      state,
      envelope(1, 'run.started', {
        agentId: sessionId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
      }),
    )
    state = reduceHarnessEvent(state, envelope(2, 'tool.started', { toolCallId, name: 'read_skill' }))
    state = reduceHarnessEvent(
      state,
      envelope(3, 'tool.progress', { toolCallId, name: 'read_skill', safeSummary: '读取中' }),
    )
    state = reduceHarnessEvent(
      state,
      envelope(4, 'tool.completed', {
        toolCallId,
        name: 'read_skill',
        status: 'succeeded',
        errorCode: null,
        safeSummary: '完成',
        entryId: '01958c80-8df7-7ce2-8f90-123456789006',
      }),
    )
    expect(state.tools).toHaveLength(1)
    expect(state.tools[0]).toMatchObject({
      toolCallId,
      name: 'read_skill',
      status: 'succeeded',
      safeSummary: '完成',
    })
  })

  it('第一个 terminal event 固定终态，后续终态事件被忽略', () => {
    let state = createEmptyHarnessStreamState()
    state = reduceHarnessEvent(
      state,
      envelope(1, 'run.started', {
        agentId: sessionId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
      }),
    )
    state = reduceHarnessEvent(
      state,
      envelope(2, 'run.completed', { status: 'completed', finalEntryId: '01958c80-8df7-7ce2-8f90-123456789007' }),
    )
    state = reduceHarnessEvent(
      state,
      envelope(3, 'run.failed', {
        status: 'failed',
        finalEntryId: null,
        error: { code: 'AI.PROVIDER_ERROR', message: '不会被覆盖', retryable: false },
      }),
    )
    expect(state.terminal).toMatchObject({ status: 'completed' })
    expect(state.terminal?.errorMessage).toBeNull()
  })

  it('run.failed 保存可展示的安全错误信息', () => {
    let state = createEmptyHarnessStreamState()
    state = reduceHarnessEvent(
      state,
      envelope(1, 'run.failed', {
        status: 'failed',
        finalEntryId: null,
        error: { code: 'AI.PROVIDER_ERROR', message: '模型请求失败，请稍后重试', retryable: true },
      }),
    )
    expect(state.terminal).toMatchObject({
      status: 'failed',
      errorMessage: '模型请求失败，请稍后重试',
    })
  })

  it('run.aborted 记录 aborted 终态', () => {
    let state = createEmptyHarnessStreamState()
    state = reduceHarnessEvent(
      state,
      envelope(1, 'run.aborted', { status: 'aborted', finalEntryId: null, errorCode: 'AI.REQUEST_ABORTED' }),
    )
    expect(state.terminal).toMatchObject({ status: 'aborted' })
  })

  it('其他 Run 的事件被忽略，不污染当前视图', () => {
    let state = createEmptyHarnessStreamState()
    state = reduceHarnessEvent(
      state,
      envelope(1, 'run.started', {
        agentId: sessionId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
      }),
    )
    const otherRun = {
      ...envelope(2, 'message.started', { messageId: '01958c80-8df7-7ce2-8f90-123456789008', role: 'assistant' }),
      runId: '01958c80-8df7-7ce2-8f90-123456789009',
    } as HarnessEvent
    state = reduceHarnessEvent(state, otherRun)
    expect(state.messages).toHaveLength(0)
    expect(state.lastSequence).toBe(1)
  })
})
