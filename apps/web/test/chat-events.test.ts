import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { agentRunLiveSnapshotSchema, harnessEventSchema } from '@starter/contracts'
import type { HarnessEvent } from '@starter/contracts'
import { expect, it } from 'vitest'
import { applyHarnessEvent, createChatRunState, toLiveSnapshot } from '@web/lib/ai/chat-events'

// 事件与期望快照放在仓库根的 test-fixtures/：API 侧的 run-live-snapshot.test.ts 读同一份文件，
// 两边都不 import 对方源码，靠这份 JSON 保证折叠结果同构。
const fixturePath = path.resolve(import.meta.dirname, '../../../test-fixtures/harness-timeline-isomorphism.json')

const sessionId = randomUUID()
const runId = randomUUID()

let sequence = 0

/** 按当前递增 sequence 造一个合法 envelope 的事件。 */
function event<T extends HarnessEvent['type']>(
  type: T,
  data: Extract<HarnessEvent, { type: T }>['data'],
): HarnessEvent {
  sequence += 1
  return {
    version: 1,
    eventId: randomUUID(),
    sequence,
    sessionId,
    runId,
    lane: 'main',
    createdAt: new Date().toISOString(),
    type,
    data,
  } as HarnessEvent
}

/** message.completed 必填字段多，只有 content 需要逐例变。 */
function completed(messageId: string, content: string): HarnessEvent {
  return event('message.completed', {
    messageId,
    role: 'assistant',
    content,
    stopReason: 'stop',
    errorCode: null,
    usage: null,
  })
}

it('共享 fixture 折叠出的结果与 API live 快照一致', () => {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    events: unknown[]
    liveSnapshot: unknown
  }
  // 先校验 fixture 本身仍符合当前契约，避免拿过期事件做同构断言
  const events = fixture.events.map((item): HarnessEvent => harnessEventSchema.parse(item))
  const expected = agentRunLiveSnapshotSchema.parse(fixture.liveSnapshot)
  expect(events).toHaveLength(18)

  let state = createChatRunState(expected.maxTurns)
  for (const item of events) state = applyHarnessEvent(state, item)

  const snapshot = toLiveSnapshot(state)
  expect(snapshot).toEqual(expected)
  expect(snapshot.lastSequence).toBe(18)
  expect(snapshot.turn).toBe(2)
  expect(snapshot.maxTurns).toBe(4)
  expect(snapshot.timeline.map((item) => item.kind)).toEqual(['message', 'tool', 'compaction', 'message'])
  // 第二条 message 保留 delta 累积出来的 text / thinking / text 顺序
  expect(snapshot.timeline[3]).toMatchObject({
    kind: 'message',
    completed: true,
    blocks: [
      { type: 'text', text: '先给结论。' },
      { type: 'thinking', text: '还要补一句' },
      { type: 'text', text: '补充一句。' },
    ],
  })
  // 终态事件只改 status，不进时间线
  expect(state.status).toBe('completed')
  expect(state.errorCode).toBeNull()
})

it('重复或更小的 sequence 被丢弃', () => {
  sequence = 0
  const messageId = randomUUID()
  let state = createChatRunState(4)
  state = applyHarnessEvent(state, event('message.started', { messageId, role: 'assistant' }))

  const delta = event('message.delta', { messageId, delta: 'a' })
  state = applyHarnessEvent(state, delta)
  const applied = state

  // 重放同一条事件和更小的 sequence 都不改状态，state 引用也不变
  state = applyHarnessEvent(state, delta)
  state = applyHarnessEvent(state, { ...delta, sequence: 1 })
  expect(state).toBe(applied)
  expect(toLiveSnapshot(state).timeline[0]).toMatchObject({ blocks: [{ type: 'text', text: 'a' }] })
  expect(state.lastSequence).toBe(2)
})

it('终态事件只改 status 和错误码，不进时间线', () => {
  sequence = 0
  const messageId = randomUUID()
  let state = createChatRunState(4)
  state = applyHarnessEvent(
    state,
    event('run.started', {
      agentId: randomUUID(),
      agentRevision: 1,
      model: { providerId: 'openai', modelId: 'gpt-test' },
    }),
  )
  expect(state.status).toBe('running')

  state = applyHarnessEvent(state, event('message.started', { messageId, role: 'assistant' }))
  state = applyHarnessEvent(state, event('message.delta', { messageId, delta: '写了一半' }))
  state = applyHarnessEvent(
    state,
    event('run.aborted', { status: 'aborted', finalEntryId: null, errorCode: 'AI.REQUEST_ABORTED' }),
  )

  expect(state.status).toBe('aborted')
  expect(state.errorCode).toBe('AI.REQUEST_ABORTED')
  // 已经产生的内容保留，终态本身不作为时间线元素
  expect(state.timeline).toHaveLength(1)
  expect(state.timeline[0]).toMatchObject({ kind: 'message', blocks: [{ type: 'text', text: '写了一半' }] })

  let failed = createChatRunState(4)
  sequence = 0
  failed = applyHarnessEvent(
    failed,
    event('run.failed', {
      status: 'failed',
      finalEntryId: null,
      error: { code: 'AI.UPSTREAM_ERROR', message: '上游失败', retryable: true },
    }),
  )
  expect(failed.status).toBe('failed')
  expect(failed.errorCode).toBe('AI.UPSTREAM_ERROR')
  expect(failed.timeline).toHaveLength(0)
})

it('timeline 超过 128 条时丢最旧的', () => {
  sequence = 0
  let state = createChatRunState(4)
  for (let index = 0; index < 200; index += 1) {
    state = applyHarnessEvent(state, event('tool.started', { toolCallId: `tool-${index}`, name: 'lookup' }))
  }

  const snapshot = toLiveSnapshot(state)
  expect(snapshot.timeline).toHaveLength(128)
  expect(snapshot.timeline[0]).toMatchObject({ toolCallId: 'tool-72' })
  expect(snapshot.timeline[127]).toMatchObject({ toolCallId: 'tool-199' })
  expect(agentRunLiveSnapshotSchema.safeParse(snapshot).success).toBe(true)
})

it('message.completed 的 content 覆盖唯一的 text 块', () => {
  sequence = 0
  const messageId = randomUUID()
  let state = createChatRunState(4)
  state = applyHarnessEvent(state, event('message.started', { messageId, role: 'assistant' }))
  state = applyHarnessEvent(state, event('message.delta', { messageId, delta: '丢了后半句' }))
  // content 与 delta 累积结果不一致（中间 delta 丢帧）时，content 是权威值
  state = applyHarnessEvent(state, completed(messageId, '丢了后半句，这里补回来。'))

  expect(state.timeline[0]).toMatchObject({
    kind: 'message',
    completed: true,
    blocks: [{ type: 'text', text: '丢了后半句，这里补回来。' }],
  })
})

it('message.completed 在没有 text 块时追加一个', () => {
  sequence = 0
  const messageId = randomUUID()
  let state = createChatRunState(4)
  state = applyHarnessEvent(state, event('message.started', { messageId, role: 'assistant' }))
  state = applyHarnessEvent(state, event('thinking.started', { messageId, blockIndex: 0 }))
  state = applyHarnessEvent(state, event('thinking.delta', { messageId, blockIndex: 0, delta: '先想一下' }))
  state = applyHarnessEvent(state, completed(messageId, '结论在这里。'))

  expect(state.timeline[0]).toMatchObject({
    kind: 'message',
    completed: true,
    blocks: [
      { type: 'thinking', text: '先想一下' },
      { type: 'text', text: '结论在这里。' },
    ],
  })

  // content 为空时不追加空 text 块
  sequence = 0
  const otherId = randomUUID()
  let blank = createChatRunState(4)
  blank = applyHarnessEvent(blank, event('message.started', { messageId: otherId, role: 'assistant' }))
  blank = applyHarnessEvent(blank, completed(otherId, ''))
  expect(blank.timeline[0]).toMatchObject({ kind: 'message', completed: true, blocks: [] })
})

it('两个 thinking 块交替续写时各自累积', () => {
  sequence = 0
  const messageId = randomUUID()
  let state = createChatRunState(4)
  state = applyHarnessEvent(state, event('message.started', { messageId, role: 'assistant' }))
  state = applyHarnessEvent(state, event('thinking.started', { messageId, blockIndex: 0 }))
  state = applyHarnessEvent(state, event('thinking.delta', { messageId, blockIndex: 0, delta: '第一块' }))
  state = applyHarnessEvent(state, event('thinking.started', { messageId, blockIndex: 1 }))
  state = applyHarnessEvent(state, event('thinking.delta', { messageId, blockIndex: 1, delta: '第二块' }))
  // 回头给第一块继续补字，它不能写到第二块上
  state = applyHarnessEvent(state, event('thinking.delta', { messageId, blockIndex: 0, delta: '的后半' }))
  state = applyHarnessEvent(state, event('thinking.completed', { messageId, blockIndex: 1, content: '第二块完整内容' }))

  expect(state.timeline[0]).toMatchObject({
    kind: 'message',
    blocks: [
      { type: 'thinking', text: '第一块的后半' },
      { type: 'thinking', text: '第二块完整内容' },
    ],
  })
})

it('单条 message 的块数停在 64', () => {
  sequence = 0
  const messageId = randomUUID()
  let state = createChatRunState(4)
  state = applyHarnessEvent(state, event('message.started', { messageId, role: 'assistant' }))
  // text 和 thinking 交替推 70 个块：连续 delta 会往同一个 text 块里拼，得靠 thinking 隔开才能新建块
  for (let index = 0; index < 35; index += 1) {
    state = applyHarnessEvent(state, event('message.delta', { messageId, delta: `t${index}` }))
    state = applyHarnessEvent(state, event('thinking.started', { messageId, blockIndex: index }))
  }

  const message = state.timeline[0]
  expect(message).toMatchObject({ kind: 'message' })
  if (message?.kind !== 'message') throw new Error('第一条应该是 message')
  expect(message.blocks).toHaveLength(64)
  expect(message.blocks[63]).toMatchObject({ type: 'thinking' })
})

it('tool.progress 把 safeSummary 写进同一个 tool 元素', () => {
  sequence = 0
  const toolCallId = randomUUID()
  let state = createChatRunState(4)
  state = applyHarnessEvent(state, event('tool.started', { toolCallId, name: 'lookup' }))
  state = applyHarnessEvent(state, event('tool.progress', { toolCallId, name: 'lookup', safeSummary: '已读 2 页' }))

  expect(state.timeline).toHaveLength(1)
  expect(state.timeline[0]).toMatchObject({
    kind: 'tool',
    toolCallId,
    name: 'lookup',
    status: 'running',
    safeSummary: '已读 2 页',
  })

  state = applyHarnessEvent(
    state,
    event('tool.completed', {
      toolCallId,
      name: 'lookup',
      status: 'succeeded',
      errorCode: null,
      safeSummary: '共 3 页',
      entryId: randomUUID(),
    }),
  )
  expect(state.timeline).toHaveLength(1)
  expect(state.timeline[0]).toMatchObject({ kind: 'tool', status: 'succeeded', safeSummary: '共 3 页' })
})

it('run.failed 保留 API 的可读说明', () => {
  sequence = 0
  let state = createChatRunState(4)
  state = applyHarnessEvent(
    state,
    event('run.failed', {
      status: 'failed',
      finalEntryId: null,
      error: { code: 'AI.UPSTREAM_ERROR', message: '上游模型返回 503。', retryable: true },
    }),
  )

  expect(state.errorMessage).toBe('上游模型返回 503。')
  expect(state.errorCode).toBe('AI.UPSTREAM_ERROR')
})
