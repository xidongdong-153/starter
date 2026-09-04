import { Hono } from 'hono'
import type { Context } from 'hono'
import { expect, it } from 'vitest'
import { runEventSchema, type RunEvent } from '@starter/contracts'

import type { HonoEnv } from '@api/shared/hono-env.js'
import { starterRuntimeAccess } from '@api/modules/ai/principal.js'
import type {
  AgentRuntimeEventCursor,
  AgentRuntimePort,
  AgentRuntimeStartInput,
} from '@api/modules/ai/runtime/index.js'
import { resolveRunEventCursor, resumeRunTransport, startRunTransport } from '@api/modules/ai/run/run-transport.js'
import { generateId } from '@api/shared/id.js'

const access = starterRuntimeAccess('user-1')
const sessionId = generateId()
const runId = generateId()
const startInput: AgentRuntimeStartInput = {
  access,
  sessionId,
  input: { input: 'hello' },
  requestId: 'request-1',
}

it.each([
  [undefined, true],
  ['*/*', true],
  ['text/event-stream', true],
  ['application/json', false],
  ['application/json, text/event-stream', true],
] as const)('start transport 的 Accept=%s 使用%s', async (accept, useSse) => {
  const tracked = trackedEvents()
  let subscribeCalled = false
  const port = {
    start: async () => ({ runId, events: tracked.iterable }),
    subscribe: () => {
      subscribeCalled = true
      throw new Error('start transport 不应调用 subscribe')
    },
  } as unknown as AgentRuntimePort
  const app = createStartApp(port)
  const headers = accept === undefined ? undefined : { Accept: accept }
  const response = await app.request('/', {
    method: 'POST',
    ...(headers ? { headers } : {}),
  })

  expect(response.status).toBe(200)
  if (useSse) {
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body).toContain('event: run.started')
    expect(body).toContain('event: run.completed')
    expect(tracked.nextCalls).toBe(2)
    expect(tracked.returnCalls).toBe(1)
  } else {
    expect(response.headers.get('content-type')).toContain('application/json')
    expect((await response.json()) as unknown).toMatchObject({ ok: true, data: { runId } })
    expect(tracked.nextCalls).toBe(0)
    expect(tracked.returnCalls).toBe(0)
  }
  expect(subscribeCalled).toBe(false)
})

it('resume transport 按 afterSequence 优先级选择 port cursor', async () => {
  expect(resolveRunEventCursor(4, 'event-1')).toEqual({ afterSequence: 4 })
  expect(resolveRunEventCursor(0, 'event-1')).toEqual({ lastEventId: 'event-1' })
  expect(resolveRunEventCursor(0, undefined)).toEqual({ afterSequence: 0 })

  const cursors: AgentRuntimeEventCursor[] = []
  const cases = [
    { path: '/?afterSequence=4', headers: { 'Last-Event-ID': 'event-1' }, expected: { afterSequence: 4 } },
    { path: '/?afterSequence=0', headers: { 'Last-Event-ID': 'event-1' }, expected: { lastEventId: 'event-1' } },
    { path: '/?afterSequence=0', headers: {}, expected: { afterSequence: 0 } },
  ] as const

  for (const current of cases) {
    const port = {
      subscribe: (_access: typeof access, _session: string, _run: string, cursor: AgentRuntimeEventCursor) => {
        cursors.push(cursor)
        return trackedEvents().iterable
      },
    } as unknown as AgentRuntimePort
    const app = createResumeApp(port)
    const response = await app.request(current.path, { headers: current.headers })
    expect(response.status).toBe(200)
    await response.text()
  }

  expect(cursors).toEqual(cases.map((current) => current.expected))
})

function createStartApp(port: AgentRuntimePort) {
  const app = new Hono<{ Variables: { requestId: string } }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'request-1')
    await next()
  })
  app.post('/', (c) => startRunTransport(c as unknown as Context<HonoEnv>, port, startInput))
  return app
}

function createResumeApp(port: AgentRuntimePort) {
  const app = new Hono<{ Variables: { requestId: string } }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'request-1')
    await next()
  })
  app.get('/', (c) =>
    resumeRunTransport(c as unknown as Context<HonoEnv>, port, {
      access,
      sessionId,
      runId,
      afterSequence: Number(c.req.query('afterSequence') ?? 0),
    }),
  )
  return app
}

function trackedEvents() {
  const started = makeEvent(1, 'run.started')
  const completed = makeEvent(2, 'run.completed')
  const values = [started, completed]
  let index = 0
  let nextCalls = 0
  let returnCalls = 0
  const iterator: AsyncIterator<RunEvent> = {
    next: async () => {
      nextCalls += 1
      const value = values[index]
      index += 1
      if (!value) return { done: true, value: undefined }
      return { done: false, value }
    },
    return: async () => {
      returnCalls += 1
      return { done: true, value: undefined }
    },
  }
  return {
    iterable: { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<RunEvent>,
    get nextCalls() {
      return nextCalls
    },
    get returnCalls() {
      return returnCalls
    },
  }
}

function makeEvent(sequence: number, type: 'run.started' | 'run.completed'): RunEvent {
  return runEventSchema.parse({
    eventId: generateId(),
    runId,
    sessionId,
    lane: 'main',
    sequence,
    occurredAt: new Date().toISOString(),
    turnIndex: null,
    stepId: null,
    modelCallId: null,
    messageId: null,
    toolCallId: null,
    toolExecutionId: null,
    type,
    data:
      type === 'run.started'
        ? {
            agentId: generateId(),
            agentRevision: 1,
            model: { providerId: 'test-provider', modelId: 'test-model' },
            outputContract: null,
          }
        : { finalEntryId: null, reason: 'model_finished' },
  })
}
