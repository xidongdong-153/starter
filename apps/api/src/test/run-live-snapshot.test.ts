import { agentRunLiveSnapshotSchema, runEventSchema, type RunEvent } from '@starter/contracts'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { generateId } from '@api/shared/id.js'
import { applyRunEvent, createRunLiveSnapshot, toAgentRunLiveSnapshot } from '@api/modules/ai/run/run.live-snapshot.js'

const fixturePath = new URL('../../../../test-fixtures/run-event-timeline-isomorphism.json', import.meta.url)
const fixtureText = readFileSync(fixturePath, 'utf8')
const fixture = JSON.parse(fixtureText) as {
  events: unknown[]
  liveSnapshot: unknown
}

const sessionId = generateId()
const runId = generateId()
let sequence = 0

function event<T extends RunEvent['type']>(
  type: T,
  data: Extract<RunEvent, { type: T }>['data'],
  associations: Partial<
    Pick<RunEvent, 'turnIndex' | 'stepId' | 'modelCallId' | 'messageId' | 'toolCallId' | 'toolExecutionId'>
  > = {},
): RunEvent {
  sequence += 1
  return {
    eventId: generateId(),
    sequence,
    occurredAt: new Date().toISOString(),
    sessionId,
    runId,
    lane: 'main',
    turnIndex: null,
    stepId: null,
    modelCallId: null,
    messageId: null,
    toolCallId: null,
    toolExecutionId: null,
    type,
    data,
    ...associations,
  } as RunEvent
}

it('live 快照按 RunEvent envelope 折叠消息、工具和压缩', () => {
  sequence = 0
  const state = createRunLiveSnapshot(4)
  const messageId = generateId()
  const toolCallId = 'tool-1'
  const compactionEntry = generateId()
  const events = [
    event('turn.started', { stepLimit: 4 }, { turnIndex: 1 }),
    event('message.started', { role: 'assistant', partPolicy: 'text_and_thinking' }, { turnIndex: 1, messageId }),
    event('thinking.started', { blockIndex: 0, display: false }, { turnIndex: 1, messageId }),
    event('thinking.delta', { blockIndex: 0, delta: '先想' }, { turnIndex: 1, messageId }),
    event('message.delta', { partId: messageId, delta: '答案' }, { turnIndex: 1, messageId }),
    event('thinking.completed', { blockIndex: 0, display: false, summary: '先想一下' }, { turnIndex: 1, messageId }),
    event(
      'message.completed',
      { role: 'assistant', content: '答案', stopReason: 'tool_use' },
      { turnIndex: 1, messageId },
    ),
    event('tool.started', { name: 'lookup', version: '1.0.0' }, { turnIndex: 1, toolCallId }),
    event(
      'tool.completed',
      {
        name: 'lookup',
        version: '1.0.0',
        status: 'succeeded',
        summary: '查到了',
        entryId: generateId(),
        error: null,
      },
      { turnIndex: 1, toolCallId },
    ),
    event(
      'context.compacted',
      { entryId: compactionEntry, tokensBefore: 12000, summary: '压缩摘要' },
      { turnIndex: 1 },
    ),
  ]
  for (const item of events) applyRunEvent(state, item)
  const snapshot = toAgentRunLiveSnapshot(state)
  expect(agentRunLiveSnapshotSchema.safeParse(snapshot).success).toBe(true)
  expect(snapshot.timeline.map((item) => item.kind)).toEqual(['message', 'tool', 'compaction'])
  expect(snapshot.timeline[0]).toMatchObject({ messageId, completed: true })
  expect(snapshot.timeline[1]).toMatchObject({
    toolCallId,
    status: 'succeeded',
    safeSummary: '查到了',
  })
  expect(snapshot.lastSequence).toBe(events.length)
})

it('重复 sequence 不重复折叠', () => {
  sequence = 0
  const state = createRunLiveSnapshot(4)
  const messageId = generateId()
  const delta = event('message.delta', { partId: messageId, delta: 'a' }, { messageId })
  applyRunEvent(state, delta)
  applyRunEvent(state, delta)
  expect(toAgentRunLiveSnapshot(state).timeline).toHaveLength(0)
})

it('完整 RunEvent fixture 折叠结果与期望 live snapshot 同构', () => {
  const events = fixture.events.map((item) => runEventSchema.parse(item))
  const expected = agentRunLiveSnapshotSchema.parse(fixture.liveSnapshot)
  const state = createRunLiveSnapshot(expected.maxTurns)

  for (const item of events) applyRunEvent(state, item)

  expect(toAgentRunLiveSnapshot(state)).toEqual(expected)
})

it('完整 RunEvent fixture 不包含禁止字段', () => {
  const serialized = JSON.stringify(fixture).toLowerCase()
  const forbiddenFields = [
    'arguments',
    'rawresult',
    'raw_result',
    'systemprompt',
    'system_prompt',
    'secret',
    'rawprovidererror',
    'raw_provider_error',
  ]

  for (const field of forbiddenFields) {
    expect(serialized).not.toContain(`\"${field}\"`)
  }
})

it('publisher 合并 delta 前后的折叠结果同构', () => {
  const messageId = generateId()
  const chunks = ['答', '案', '很长']
  const build = (deltas: string[]) => {
    sequence = 0
    const state = createRunLiveSnapshot(4)
    applyRunEvent(
      state,
      event('message.started', { role: 'assistant', partPolicy: 'text_and_thinking' }, { turnIndex: 1, messageId }),
    )
    for (const delta of deltas) {
      applyRunEvent(state, event('message.delta', { partId: messageId, delta }, { turnIndex: 1, messageId }))
    }
    applyRunEvent(
      state,
      event(
        'message.completed',
        {
          role: 'assistant',
          content: chunks.join(''),
          stopReason: 'stop',
        },
        { turnIndex: 1, messageId },
      ),
    )
    return toAgentRunLiveSnapshot(state).timeline
  }

  // 逐个 Pi 增量 vs Publisher 按窗口合并后的一个增量
  expect(build(chunks)).toEqual(build([chunks.join('')]))
})
