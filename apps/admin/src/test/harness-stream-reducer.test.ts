import type { HarnessEvent } from '@starter/contracts'
import { describe, expect, it } from 'vitest'

import type { HarnessStreamState } from '@admin/features/ai/harness/stream-reducer'
import { createEmptyHarnessStreamState, reduceHarnessEvent } from '@admin/features/ai/harness/stream-reducer'
import type { TimelineMessageItem, TimelineToolItem } from '@admin/features/ai/harness/timeline'

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

function runStarted(sequence = 1): HarnessEvent {
  return envelope(sequence, 'run.started', {
    agentId: sessionId,
    agentRevision: 1,
    model: { providerId: 'openai', modelId: 'gpt-test' },
  })
}

function apply(events: HarnessEvent[], initial = createEmptyHarnessStreamState()): HarnessStreamState {
  return events.reduce((state, event) => reduceHarnessEvent(state, event), initial)
}

function messages(state: HarnessStreamState): TimelineMessageItem[] {
  return state.timeline.filter((item): item is TimelineMessageItem => item.kind === 'message')
}

function tools(state: HarnessStreamState): TimelineToolItem[] {
  return state.timeline.filter((item): item is TimelineToolItem => item.kind === 'tool')
}

function messageText(message: TimelineMessageItem | undefined): string {
  return (message?.blocks ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

describe('reduceHarnessEvent', () => {
  it('run.started 记录模型并推进 sequence', () => {
    const state = apply([runStarted()])
    expect(state.runId).toBe(runId)
    expect(state.lastSequence).toBe(1)
    expect(state.model).toEqual({ providerId: 'openai', modelId: 'gpt-test' })
  })

  it('同一 Run 内 sequence 去重，重复或乱序事件不重复追加', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789004'
    const state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId, role: 'assistant' }),
      envelope(3, 'message.delta', { messageId, delta: '深圳' }),
      envelope(3, 'message.delta', { messageId, delta: '重复' }),
      envelope(4, 'message.delta', { messageId, delta: '，天气好' }),
    ])
    expect(messageText(messages(state)[0])).toBe('深圳，天气好')
  })

  it('message.delta 追加到当前 message 最后一个 text 块', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789004'
    const state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId, role: 'assistant' }),
      envelope(3, 'message.delta', { messageId, delta: '第一段' }),
      envelope(4, 'message.delta', { messageId, delta: '继续' }),
    ])
    expect(messages(state)[0]?.blocks).toEqual([{ type: 'text', text: '第一段继续' }])
  })

  it('message.completed 用服务端内容替换临时 buffer 并写入用量', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789005'
    const state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId, role: 'assistant' }),
      envelope(3, 'message.delta', { messageId, delta: '草稿' }),
      envelope(4, 'message.completed', {
        messageId,
        role: 'assistant',
        content: '最终内容',
        stopReason: 'stop',
        errorCode: null,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          cacheWrite1hTokens: null,
          reasoningTokens: null,
          totalTokens: 30,
        },
      }),
    ])
    const message = messages(state).find((item) => item.messageId === messageId)
    expect(message?.blocks).toEqual([{ type: 'text', text: '最终内容' }])
    expect(message?.completed).toBe(true)
    expect(message?.usage?.totalTokens).toBe(30)
  })

  it('thinking 事件按 blockIndex 累积成独立的思考块', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789005'
    const state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId, role: 'assistant' }),
      envelope(3, 'thinking.started', { messageId, blockIndex: 0 }),
      envelope(4, 'thinking.delta', { messageId, blockIndex: 0, delta: '先看' }),
      envelope(5, 'thinking.delta', { messageId, blockIndex: 0, delta: '需求' }),
      envelope(6, 'thinking.delta', { messageId, blockIndex: 2, delta: '再看代码' }),
      envelope(7, 'message.delta', { messageId, delta: '结论是' }),
    ])
    expect(messages(state)[0]?.blocks).toEqual([
      { type: 'thinking', text: '先看需求', blockIndex: 0 },
      { type: 'thinking', text: '再看代码', blockIndex: 2 },
      { type: 'text', text: '结论是' },
    ])
  })

  it('thinking.completed 用完整内容覆盖，且 message.completed 保留思考块', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789005'
    const state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId, role: 'assistant' }),
      envelope(3, 'thinking.delta', { messageId, blockIndex: 0, delta: '片段' }),
      envelope(4, 'thinking.completed', { messageId, blockIndex: 0, content: '完整思考' }),
      envelope(5, 'message.delta', { messageId, delta: '草稿' }),
      envelope(6, 'message.completed', {
        messageId,
        role: 'assistant',
        content: '最终内容',
        stopReason: 'stop',
        errorCode: null,
      }),
    ])
    expect(messages(state)[0]?.blocks).toEqual([
      { type: 'thinking', text: '完整思考', blockIndex: 0 },
      { type: 'text', text: '最终内容' },
    ])
  })

  it('interleaved thinking 的块顺序在 message.completed 后不变', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789015'
    const state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId, role: 'assistant' }),
      envelope(3, 'message.delta', { messageId, delta: '先给结论。' }),
      envelope(4, 'thinking.started', { messageId, blockIndex: 1 }),
      envelope(5, 'thinking.delta', { messageId, blockIndex: 1, delta: '再想一步' }),
      envelope(6, 'message.delta', { messageId, delta: '补充一句。' }),
      envelope(7, 'message.completed', {
        messageId,
        role: 'assistant',
        content: '先给结论。补充一句。',
        stopReason: 'stop',
        errorCode: null,
      }),
    ])
    // 多个 text 块时保留原顺序和原内容，不重排也不折叠，和服务端快照同构
    expect(messages(state)[0]?.blocks).toEqual([
      { type: 'text', text: '先给结论。' },
      { type: 'thinking', text: '再想一步', blockIndex: 1 },
      { type: 'text', text: '补充一句。' },
    ])
    expect(messages(state)[0]?.completed).toBe(true)
  })

  it('tool 事件按 toolCallId 合并为同一时间线元素', () => {
    const toolCallId = 'tool-1'
    const state = apply([
      runStarted(),
      envelope(2, 'tool.started', { toolCallId, name: 'read_skill' }),
      envelope(3, 'tool.progress', { toolCallId, name: 'read_skill', safeSummary: '读取中' }),
      envelope(4, 'tool.completed', {
        toolCallId,
        name: 'read_skill',
        status: 'succeeded',
        errorCode: null,
        safeSummary: '完成',
        entryId: '01958c80-8df7-7ce2-8f90-123456789006',
      }),
    ])
    expect(tools(state)).toHaveLength(1)
    expect(tools(state)[0]).toMatchObject({
      toolCallId,
      name: 'read_skill',
      status: 'succeeded',
      safeSummary: '完成',
    })
  })

  it('文字与工具在同一条时间线上按 sequence 交错', () => {
    const first = '01958c80-8df7-7ce2-8f90-123456789011'
    const second = '01958c80-8df7-7ce2-8f90-123456789012'
    const state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId: first, role: 'assistant' }),
      envelope(3, 'message.delta', { messageId: first, delta: '先查一下' }),
      envelope(4, 'tool.started', { toolCallId: 'tool-1', name: 'read_skill' }),
      envelope(5, 'tool.completed', {
        toolCallId: 'tool-1',
        name: 'read_skill',
        status: 'succeeded',
        errorCode: null,
        safeSummary: '完成',
        entryId: '01958c80-8df7-7ce2-8f90-123456789013',
      }),
      envelope(6, 'message.started', { messageId: second, role: 'assistant' }),
      envelope(7, 'message.delta', { messageId: second, delta: '查到了' }),
    ])
    expect(state.timeline.map((item) => item.kind)).toEqual(['message', 'tool', 'message'])
    expect(messageText(messages(state)[0])).toBe('先查一下')
    expect(messageText(messages(state)[1])).toBe('查到了')
  })

  it('turn 事件记录当前轮次和上限', () => {
    const state = apply([
      runStarted(),
      envelope(2, 'turn.started', { turn: 1, maxTurns: 2 }),
      envelope(3, 'turn.completed', { turn: 1, maxTurns: 2, toolCallCount: 1 }),
      envelope(4, 'turn.started', { turn: 2, maxTurns: 2 }),
    ])
    expect(state.turn).toBe(2)
    expect(state.maxTurns).toBe(2)
  })

  it('context.compacted 作为时间线元素追加', () => {
    const entryId = '01958c80-8df7-7ce2-8f90-123456789014'
    const state = apply([
      runStarted(),
      envelope(2, 'context.compacted', { entryId, tokensBefore: 12000, summary: '压缩摘要' }),
    ])
    expect(state.timeline).toEqual([
      {
        key: `compaction:${entryId}`,
        kind: 'compaction',
        entryId,
        summary: '压缩摘要',
        tokensBefore: 12000,
        createdAt,
      },
    ])
  })

  it('第一个 terminal event 固定终态并记录停止原因，后续终态事件被忽略', () => {
    const state = apply([
      runStarted(),
      envelope(2, 'run.completed', {
        status: 'completed',
        finalEntryId: '01958c80-8df7-7ce2-8f90-123456789007',
        reason: 'max_turns',
      }),
      envelope(3, 'run.failed', {
        status: 'failed',
        finalEntryId: null,
        error: { code: 'AI.PROVIDER_ERROR', message: '不会被覆盖', retryable: false },
      }),
    ])
    expect(state.terminal).toMatchObject({ status: 'completed', reason: 'max_turns' })
    expect(state.terminal?.errorMessage).toBeNull()
  })

  it('run.completed 的 model_finished 也被记录', () => {
    const state = apply([
      runStarted(),
      envelope(2, 'run.completed', {
        status: 'completed',
        finalEntryId: '01958c80-8df7-7ce2-8f90-123456789007',
        reason: 'model_finished',
      }),
    ])
    expect(state.terminal?.reason).toBe('model_finished')
  })

  it('run.failed 保存可展示的安全错误信息', () => {
    const state = apply([
      envelope(1, 'run.failed', {
        status: 'failed',
        finalEntryId: null,
        error: { code: 'AI.PROVIDER_ERROR', message: '模型请求失败，请稍后重试', retryable: true },
      }),
    ])
    expect(state.terminal).toMatchObject({
      status: 'failed',
      errorMessage: '模型请求失败，请稍后重试',
      reason: null,
    })
  })

  it('run.aborted 记录 aborted 终态', () => {
    const state = apply([
      envelope(1, 'run.aborted', { status: 'aborted', finalEntryId: null, errorCode: 'AI.REQUEST_ABORTED' }),
    ])
    expect(state.terminal).toMatchObject({ status: 'aborted', reason: null })
  })

  it('时间线超过 128 条丢最旧的，已丢弃元素的后续 delta 不会把它插回来', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789016'
    let state = apply([
      runStarted(),
      envelope(2, 'message.started', { messageId, role: 'assistant' }),
      envelope(3, 'message.delta', { messageId, delta: '会被挤掉' }),
    ])
    for (let index = 0; index < 128; index += 1) {
      state = reduceHarnessEvent(
        state,
        envelope(4 + index, 'tool.started', { toolCallId: `tool-${index}`, name: 'lookup' }),
      )
    }

    expect(state.timeline).toHaveLength(128)
    // 最旧的 message 元素已被挤出，剩下的 128 条全是工具
    expect(state.timeline.every((item) => item.kind === 'tool')).toBe(true)
    expect(state.timeline[0]).toMatchObject({ kind: 'tool', toolCallId: 'tool-0' })

    // 已丢弃的 message 再来 delta 时不重新插入，避免顺序错位
    const after = reduceHarnessEvent(state, envelope(200, 'message.delta', { messageId, delta: '迟到的文字' }))
    expect(after.timeline).toHaveLength(128)
    expect(after.timeline.some((item) => item.kind === 'message')).toBe(false)
  })

  it('单条 message 的内容块超过 64 个时不再追加', () => {
    const messageId = '01958c80-8df7-7ce2-8f90-123456789017'
    let state = apply([runStarted(), envelope(2, 'message.started', { messageId, role: 'assistant' })])
    for (let index = 0; index < 64; index += 1) {
      state = reduceHarnessEvent(
        state,
        envelope(3 + index, 'thinking.delta', { messageId, blockIndex: index, delta: `思考${index}` }),
      )
    }
    expect(messages(state)[0]?.blocks).toHaveLength(64)

    // 第 65 个块（新的 thinking 和新的 text）都不再进入，已有块保持原内容
    state = reduceHarnessEvent(state, envelope(100, 'thinking.delta', { messageId, blockIndex: 64, delta: '超出' }))
    state = reduceHarnessEvent(state, envelope(101, 'message.delta', { messageId, delta: '超出的文字' }))
    const blocks = messages(state)[0]?.blocks ?? []
    expect(blocks).toHaveLength(64)
    expect(blocks.every((block) => block.type === 'thinking')).toBe(true)
    expect(blocks[0]).toEqual({ type: 'thinking', text: '思考0', blockIndex: 0 })
    expect(blocks.at(-1)).toEqual({ type: 'thinking', text: '思考63', blockIndex: 63 })
  })

  it('其他 Run 的事件被忽略，不污染当前视图', () => {
    const otherRun = {
      ...envelope(2, 'message.started', { messageId: '01958c80-8df7-7ce2-8f90-123456789008', role: 'assistant' }),
      runId: '01958c80-8df7-7ce2-8f90-123456789009',
    } as HarnessEvent
    const state = apply([runStarted(), otherRun])
    expect(state.timeline).toHaveLength(0)
    expect(state.lastSequence).toBe(1)
  })
})
