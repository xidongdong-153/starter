import { expect, it, vi } from 'vitest'
import type { RunEvent } from '@starter/contracts'

const post = vi.fn()
const flowPost = vi.fn()
const streamGet = vi.fn()
vi.mock('@web/lib/rpc', () => ({
  chatRpc: {
    api: {
      chat: {
        sessions: {
          ':sessionId': {
            runs: { $post: post, ':runId': { events: { stream: { $get: streamGet } } } },
          },
        },
      },
    },
  },
  flowRpc: {
    api: {
      flow: {
        sessions: {
          ':sessionId': {
            runs: { $post: flowPost },
          },
        },
      },
    },
  },
}))
const { resumeRunStream, startRunStream } = await import('@web/lib/ai/run-event-stream')

const ids = {
  sessionId: '01958c80-8df7-7ce2-8f90-1234567890a1',
  runId: '01958c80-8df7-7ce2-8f90-1234567890a2',
  agentId: '01958c80-8df7-7ce2-8f90-1234567890a7',
  messageId: '01958c80-8df7-7ce2-8f90-1234567890a3',
}
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
    sessionId: ids.sessionId,
    runId: ids.runId,
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
function sseResponse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

it('按 SSE 帧产出 RunEvent，跳过心跳和坏帧', async () => {
  const events = [
    event(
      'run.started',
      {
        agentId: ids.agentId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
        outputContract: null,
      },
      1,
    ),
    event('message.started', { role: 'assistant', partPolicy: 'text_and_thinking' }, 2, { messageId: ids.messageId }),
  ]
  post.mockResolvedValue(
    sseResponse(
      `: heartbeat\n\n${events.map((item) => `id: ${item.eventId}\nevent: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`).join('')}data: {"broken":true}\n\n`,
    ),
  )
  const received: RunEvent[] = []
  for await (const item of startRunStream({
    agentId: ids.agentId,
    input: 'hi',
    product: 'chat',
    sessionId: ids.sessionId,
    signal: new AbortController().signal,
  }))
    received.push(item)
  expect(received.map((item) => item.sequence)).toEqual([1, 2])
})

it('非 2xx 抛出带 status 的错误', async () => {
  post.mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'COMMON.NOT_FOUND', message: '找不到 Session' },
        meta: { requestId: 'r', timestamp: new Date().toISOString() },
      }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ),
  )
  await expect(
    startRunStream({
      agentId: ids.agentId,
      input: 'hi',
      product: 'chat',
      sessionId: ids.sessionId,
      signal: new AbortController().signal,
    }).next(),
  ).rejects.toThrow('找不到 Session')
})

it('恢复流按 afterSequence 请求，从 sequence 1 产出到终态事件', async () => {
  const events = [
    event(
      'run.started',
      {
        agentId: ids.agentId,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-test' },
        outputContract: null,
      },
      1,
    ),
    event('message.started', { role: 'assistant', partPolicy: 'text_and_thinking' }, 2, { messageId: ids.messageId }),
    event('message.delta', { partId: 'text-0', delta: '恢复' }, 3, { messageId: ids.messageId }),
    event('run.completed', { finalEntryId: null, reason: 'model_finished' }, 4),
  ]
  streamGet.mockResolvedValue(
    sseResponse(
      `: heartbeat\n\n${events.map((item) => `id: ${item.eventId}\nevent: ${item.type}\r\ndata: ${JSON.stringify(item)}\n\n`).join('')}`,
    ),
  )
  const received: RunEvent[] = []
  for await (const item of resumeRunStream({
    afterSequence: 0,
    runId: ids.runId,
    sessionId: ids.sessionId,
    signal: new AbortController().signal,
  }))
    received.push(item)
  expect(received.map((item) => item.sequence)).toEqual([1, 2, 3, 4])
  expect(received.at(-1)?.type).toBe('run.completed')
  expect(streamGet.mock.calls[0]?.[0]).toEqual({
    param: { runId: ids.runId, sessionId: ids.sessionId },
    query: { afterSequence: '0' },
  })
  expect(streamGet).toHaveBeenCalledTimes(1)
})

it('恢复流非 2xx 抛出带 status 的错误', async () => {
  streamGet.mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'COMMON.NOT_FOUND', message: '找不到 Run' },
        meta: { requestId: 'r', timestamp: new Date().toISOString() },
      }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ),
  )
  await expect(
    resumeRunStream({
      afterSequence: 0,
      runId: ids.runId,
      sessionId: ids.sessionId,
      signal: new AbortController().signal,
    }).next(),
  ).rejects.toThrow('找不到 Run')
})
