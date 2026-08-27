import { expect, it } from 'vitest'
import type { RunEvent } from '@starter/contracts'
import { applyRunEvent, createChatRunState, toLiveSnapshot } from '@web/lib/ai/chat-events'

const sessionId = '01958c80-8df7-7ce2-8f90-1234567890a1'
const runId = '01958c80-8df7-7ce2-8f90-1234567890a2'
const agentId = '01958c80-8df7-7ce2-8f90-1234567890a7'
const messageId = '01958c80-8df7-7ce2-8f90-1234567890a3'
function event<T extends RunEvent['type']>(
  type: T,
  data: Extract<RunEvent, { type: T }>['data'],
  sequence: number,
  associations: Partial<RunEvent> = {},
): RunEvent {
  return {
    eventId: `01958c80-8df7-7ce2-8f90-${sequence.toString(16).padStart(12, '0')}`,
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

it('按 sequence 折叠消息、工具、压缩和终态', () => {
  let state = createChatRunState(4)
  state = applyRunEvent(
    state,
    event(
      'run.started',
      { agentId, agentRevision: 1, model: { providerId: 'openai', modelId: 'gpt-test' }, outputContract: null },
      1,
    ),
  )
  state = applyRunEvent(state, event('turn.started', { stepLimit: 4 }, 2, { turnIndex: 1 }))
  state = applyRunEvent(
    state,
    event('message.started', { role: 'assistant', partPolicy: 'text_and_thinking' }, 3, { messageId }),
  )
  state = applyRunEvent(state, event('thinking.started', { blockIndex: 0, display: false }, 4, { messageId }))
  state = applyRunEvent(state, event('thinking.delta', { blockIndex: 0, delta: '先想' }, 5, { messageId }))
  state = applyRunEvent(state, event('message.delta', { partId: messageId, delta: '答案' }, 6, { messageId }))
  state = applyRunEvent(
    state,
    event('thinking.completed', { blockIndex: 0, display: false, summary: '先想一下' }, 7, { messageId }),
  )
  state = applyRunEvent(
    state,
    event('message.completed', { role: 'assistant', content: '答案', stopReason: 'tool_use' }, 8, { messageId }),
  )
  const toolCallId = 'tool-1'
  state = applyRunEvent(state, event('tool.started', { name: 'lookup', version: '1.0.0' }, 9, { toolCallId }))
  state = applyRunEvent(state, event('tool.progress', { summary: '已读 2 页', state: 'running' }, 10, { toolCallId }))
  state = applyRunEvent(
    state,
    event(
      'tool.completed',
      {
        name: 'lookup',
        version: '1.0.0',
        status: 'succeeded',
        summary: '共 3 页',
        entryId: '01958c80-8df7-7ce2-8f90-000000000011',
        error: null,
      },
      11,
      { toolCallId },
    ),
  )
  state = applyRunEvent(
    state,
    event(
      'context.compacted',
      { entryId: '01958c80-8df7-7ce2-8f90-000000000012', tokensBefore: 12, summary: '压缩摘要' },
      12,
    ),
  )
  state = applyRunEvent(state, event('run.completed', { finalEntryId: null, reason: 'model_finished' }, 13))
  expect(toLiveSnapshot(state).timeline.map((item) => item.kind)).toEqual(['message', 'tool', 'compaction'])
  expect(state.status).toBe('completed')
})

it('重复 sequence 不重复折叠', () => {
  let state = createChatRunState()
  state = applyRunEvent(state, event('message.started', { role: 'assistant', partPolicy: 'text' }, 1, { messageId }))
  const next = applyRunEvent(
    state,
    event('message.started', { role: 'assistant', partPolicy: 'text' }, 1, { messageId }),
  )
  expect(next).toBe(state)
})
