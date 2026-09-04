// Chat / Flow 产品模块薄代理的 smoke tests。
// 每个用例用 helpers.ts 注入的临时 SQLite 和临时附件目录，不读写开发库。
// 薄代理不新增 DTO，这里校验 /api/chat/* 与对应 /api/ai/* 端点返回同构 data。
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { expect, it } from 'vitest'
import type { AgentRun, AgentTranscript } from '@starter/contracts'

import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import { createAiToolRegistry } from '@api/modules/ai/tool/tool-registry.js'

import { createTestApp, readFailure, readSuccess, register } from './helpers.js'
import {
  assistantMessage,
  parseSseEvents,
  readSseBody,
  runTestApp,
  seedAgent,
  seedEnabledModel,
  streamAssistant,
} from './ai-run-harness.js'

async function requestJson(
  app: ReturnType<typeof createTestApp>['app'],
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      cookie,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

it('chat agents：未登录 401，登录后与 /api/ai/agents 同构', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const unauthenticated = await app.request('/api/chat/agents')
    expect(unauthenticated.status).toBe(401)
    expect((await readFailure(unauthenticated)).error.code).toBe('AUTH.UNAUTHENTICATED')

    const { cookie } = await register(app, 'chat-agents@example.com')

    const chatBody = await readSuccess<unknown>(await app.request('/api/chat/agents', { headers: { cookie } }))
    const aiBody = await readSuccess<unknown>(await app.request('/api/ai/agents', { headers: { cookie } }))
    expect(chatBody.data).toEqual(aiBody.data)
  } finally {
    cleanup()
  }
})

it('chat sessions：创建、改名、列表、归档全链路', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const { cookie } = await register(app, 'chat-sessions@example.com')

    expect((await requestJson(app, 'POST', '/api/chat/sessions', '', {})).status).toBe(401)

    const created = await requestJson(app, 'POST', '/api/chat/sessions', cookie, {
      title: '  首轮会话  ',
    })
    expect(created.status).toBe(200)
    const createdBody = await readSuccess<{
      id: string
      title: string
      archivedAt: string | null
    }>(created)
    expect(createdBody.data.title).toBe('首轮会话')
    expect(createdBody.data.archivedAt).toBeNull()

    // 改名
    const renamed = await requestJson(app, 'PATCH', `/api/chat/sessions/${createdBody.data.id}`, cookie, {
      title: '改名',
    })
    expect(renamed.status).toBe(200)
    expect((await readSuccess<{ title: string }>(renamed)).data.title).toBe('改名')

    // 列表包含它
    const list = await readSuccess<{
      items: Array<{ id: string }>
      total: number
    }>(await app.request('/api/chat/sessions', { headers: { cookie } }))
    expect(list.data.items.some((item) => item.id === createdBody.data.id)).toBe(true)
    expect(list.data.total).toBe(1)

    // 归档后列表不含它
    const archived = await requestJson(app, 'DELETE', `/api/chat/sessions/${createdBody.data.id}`, cookie)
    expect(archived.status).toBe(200)
    const listAfter = await readSuccess<{
      items: Array<{ id: string }>
      total: number
    }>(await app.request('/api/chat/sessions', { headers: { cookie } }))
    expect(listAfter.data.items.some((item) => item.id === createdBody.data.id)).toBe(false)
    expect(listAfter.data.total).toBe(0)
  } finally {
    cleanup()
  }
})

it('flow agents：与 /api/ai/agents 同构', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const { cookie } = await register(app, 'flow-agents@example.com')

    const flowBody = await readSuccess<unknown>(await app.request('/api/flow/agents', { headers: { cookie } }))
    const aiBody = await readSuccess<unknown>(await app.request('/api/ai/agents', { headers: { cookie } }))
    expect(flowBody.data).toEqual(aiBody.data)
  } finally {
    cleanup()
  }
})

it('flow sessions：创建后读取 lane=main transcript；未登录 401', async () => {
  const { app, cleanup } = createTestApp()
  try {
    expect((await requestJson(app, 'POST', '/api/flow/sessions', '', {})).status).toBe(401)

    const { cookie } = await register(app, 'flow-sessions@example.com')

    const created = await requestJson(app, 'POST', '/api/flow/sessions', cookie, {
      title: 'flow 会话',
    })
    expect(created.status).toBe(200)
    const createdBody = await readSuccess<{ id: string }>(created)

    const transcript = await app.request(`/api/flow/sessions/${createdBody.data.id}/transcript?lane=main`, {
      headers: { cookie },
    })
    expect(transcript.status).toBe(200)
    const transcriptBody = await readSuccess<{
      items: unknown[]
      nextCursor: number | null
    }>(transcript)
    expect(Array.isArray(transcriptBody.data.items)).toBe(true)
    expect(transcriptBody.data.items).toHaveLength(0)
  } finally {
    cleanup()
  }
})

it('chat 和 flow 的 Run 入口共用 JSON/SSE transport，active、transcript、outputs 保持同构', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-product-runtime-'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const test = runTestApp({
    store,
    tools: createAiToolRegistry([]),
    streamSimple: () => delayedStream(gate, 'product answer'),
  })

  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'product-runtime@example.com')

    const chatSessionResponse = await test.app.request('/api/chat/sessions', {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'chat runtime' }),
    })
    const chatSession = await readSuccess<{ id: string }>(chatSessionResponse)
    const chatStart = await test.app.request(`/api/chat/sessions/${chatSession.data.id}/runs`, {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ agentId, input: 'chat input' }),
    })
    expect(chatStart.status).toBe(200)
    expect(chatStart.headers.get('content-type')).toContain('application/json')
    const chatStartBody = await readSuccess<{ runId: string }>(chatStart)

    const active = await test.app.request(`/api/chat/sessions/${chatSession.data.id}/active-run`, {
      headers: { cookie: user.cookie },
    })
    expect(active.status).toBe(200)
    const activeBody = await readSuccess<AgentRun | null>(active)
    expect(activeBody.data).toMatchObject({ id: chatStartBody.data.runId, status: 'running' })

    release()
    const chatRun = await waitForCompletedRun(test.app, user.cookie, chatSession.data.id, chatStartBody.data.runId)
    expect(chatRun.status).toBe('completed')
    const chatTranscript = await readSuccess<AgentTranscript>(
      await test.app.request(`/api/chat/sessions/${chatSession.data.id}/transcript`, {
        headers: { cookie: user.cookie },
      }),
    )
    expect(chatTranscript.data.items.some((item) => item.type === 'assistant_message')).toBe(true)

    const flowSessionResponse = await test.app.request('/api/flow/sessions', {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'flow runtime' }),
    })
    const flowSession = await readSuccess<{ id: string }>(flowSessionResponse)
    const flowStart = await test.app.request(`/api/flow/sessions/${flowSession.data.id}/runs`, {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ agentId, input: 'flow input' }),
    })
    expect(flowStart.status).toBe(200)
    expect(flowStart.headers.get('content-type')).toContain('text/event-stream')
    const flowEvents = parseSseEvents(await readSseBody(flowStart))
    expect(flowEvents.at(-1)?.type).toBe('run.completed')
    const flowRunId = flowEvents[0]?.runId
    if (!flowRunId) throw new Error('flow SSE 缺少 runId')

    const flowRun = await waitForCompletedRun(test.app, user.cookie, flowSession.data.id, flowRunId)
    expect(flowRun.status).toBe('completed')
    const flowOutputs = await test.app.request(
      `/api/flow/sessions/${flowSession.data.id}/runs/${flowRunId}/structured-outputs`,
      { headers: { cookie: user.cookie } },
    )
    expect(flowOutputs.status).toBe(200)
    expect((await readSuccess<{ items: unknown[] }>(flowOutputs)).data.items).toEqual([])
  } finally {
    test.cleanup()
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('flow 恢复端点：断开后按 afterSequence 从 sequence 1 恢复并终态收尾；未知 Last-Event-ID 400', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-flow-recovery-'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const test = runTestApp({
    store,
    tools: createAiToolRegistry([]),
    streamSimple: () => delayedStream(gate, 'flow recovery answer'),
  })
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const { cookie } = await register(test.app, 'flow-recovery@example.com')

    const sessionResponse = await test.app.request('/api/flow/sessions', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'flow recovery' }),
    })
    const session = await readSuccess<{ id: string }>(sessionResponse)
    const started = await test.app.request(`/api/flow/sessions/${session.data.id}/runs`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: 'flow recovery input' }),
    })
    expect(started.status).toBe(200)
    // 读到 run.started 帧后断开，模拟页面刷新；断开不中止 Run。
    const reader = started.body?.getReader()
    if (!reader) throw new Error('SSE 缺少 response body')
    const firstChunk = await reader.read()
    expect(firstChunk.done).toBe(false)
    const runId = parseSseEvents(new TextDecoder().decode(firstChunk.value))[0]?.runId
    if (!runId) throw new Error('首个 SSE chunk 缺少 runId')
    await reader.cancel()

    release()
    await waitForCompletedRun(test.app, cookie, session.data.id, runId)

    const resumed = await test.app.request(
      `/api/flow/sessions/${session.data.id}/runs/${runId}/events/stream?afterSequence=0`,
      { headers: { cookie } },
    )
    expect(resumed.status).toBe(200)
    expect(resumed.headers.get('content-type')).toContain('text/event-stream')
    const events = parseSseEvents(await readSseBody(resumed))
    const sequences = events.map((event) => event.sequence)
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, index) => index + 1))
    expect(events[0]?.type).toBe('run.started')
    expect(events.at(-1)?.type).toBe('run.completed')

    const unknownEvent = await test.app.request(`/api/flow/sessions/${session.data.id}/runs/${runId}/events/stream`, {
      headers: { cookie, 'Last-Event-ID': '00000000-0000-7000-8000-000000000000' },
    })
    expect(unknownEvent.status).toBe(400)
    expect((await readFailure(unknownEvent)).error.code).toBe('COMMON.INVALID_REQUEST')
  } finally {
    test.cleanup()
    await store.close()
    await rm(directory, { recursive: true, force: true })
  }
})

async function waitForCompletedRun(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  sessionId: string,
  runId: string,
): Promise<AgentRun> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.request(`/api/ai/sessions/${sessionId}/runs/${runId}`, {
      headers: { cookie },
    })
    const body = await readSuccess<AgentRun>(response)
    if (body.data.status !== 'starting' && body.data.status !== 'running') return body.data
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Run 未在预期时间内进入终态')
}

function delayedStream(gate: Promise<void>, text: string): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  void gate.then(async () => {
    const source = streamAssistant(assistantMessage([{ type: 'text', text }], 'stop'), 'stop')
    for await (const event of source) stream.push(event)
  })
  return stream
}
