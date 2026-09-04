import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Api, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createApp } from '@api/bootstrap/create-app.js'
import { createRuntime } from '@api/bootstrap/create-runtime.js'
import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import { createAiToolRegistry, defineAiTool } from '@api/modules/ai/tool/tool-registry.js'
import { AsyncEventQueue } from '@api/infra/agent/pi-event-mapper.js'

import { readSuccess, register } from './helpers.js'
import {
  assistantMessage,
  parseSseEvents,
  readSseBody,
  runTestApp,
  seedAgent,
  seedEnabledModel,
  streamAssistant,
} from './ai-run-harness.js'

async function createSession(app: ReturnType<typeof createApp>, cookie: string) {
  const response = await app.request('/api/ai/sessions', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '恢复测试' }),
  })
  return (await readSuccess<{ id: string }>(response)).data.id
}

function delayedTextStream(gate: Promise<void>, text: string) {
  const stream = createAssistantMessageEventStream()
  const partial = assistantMessage([], 'pending')
  void gate.then(() => {
    const message = assistantMessage([{ type: 'text', text }], 'stop')
    stream.push({ type: 'start', partial })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial })
    stream.push({ type: 'done', reason: 'stop', message })
  })
  return stream
}

async function readFirstSseFrame(response: Response): Promise<{
  prefix: string
  reader: ReadableStreamDefaultReader<Uint8Array>
}> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('缺少 SSE body')
  const decoder = new TextDecoder()
  let prefix = ''
  while (!prefix.includes('\n\n')) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error('首个 SSE 事件前流已结束')
    prefix += decoder.decode(chunk.value, { stream: true })
  }
  return { prefix, reader }
}

async function readRemainingSse(prefix: string, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let body = prefix
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    body += decoder.decode(chunk.value, { stream: true })
  }
  body += decoder.decode()
  reader.releaseLock()
  return body
}

it('查询与订阅之间产生新事件时不丢不重', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-recovery-race-'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const streamSimple = (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) =>
    delayedTextStream(gate, '窗口期事件')
  const test = runTestApp({
    store,
    tools: createAiToolRegistry([]),
    streamSimple,
  })
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'recovery-race@example.com')
    const sessionId = await createSession(test.app, user.cookie)
    const responsePromise = test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: '开始' }),
    })
    const response = await responsePromise
    const { prefix, reader } = await readFirstSseFrame(response)
    expect(parseSseEvents(prefix).map((event) => event.sequence)).toEqual([1])
    release()
    const events = parseSseEvents(await readRemainingSse(prefix, reader))
    const sequences = events.map((event) => event.sequence)
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, index) => index + 1))
    expect(new Set(sequences).size).toBe(sequences.length)
    expect(events.some((event) => event.type === 'message.delta' && event.data.delta === '窗口期事件')).toBe(true)
    expect(events.at(-1)?.type).toBe('run.completed')
  } finally {
    test.cleanup()
    await store.close()
  }
})

it('按 session 查到进行中的 Run 后可以从 sequence 1 恢复事件流', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-recovery-active-'))
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
    streamSimple: () => delayedTextStream(gate, '恢复流正文'),
  })
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'recovery-active@example.com')
    const sessionId = await createSession(test.app, user.cookie)
    const response = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: '刷新前的提问' }),
    })
    // 等到第一帧（run.started），说明主库 Run 已经是 running。
    const { prefix, reader } = await readFirstSseFrame(response)
    const startedRunId = parseSseEvents(prefix)[0]?.runId
    expect(startedRunId).toBeTruthy()
    // 刷新页面就是原来那条 SSE 断开：断开只结束订阅，Run 继续跑。
    await reader.cancel()

    const active = await test.app.request(`/api/ai/sessions/${sessionId}/active-run`, {
      headers: { cookie: user.cookie },
    })
    const activeBody = await readSuccess<{ id: string; status: string } | null>(active)
    expect(activeBody.data?.id).toBe(startedRunId)
    expect(activeBody.data?.status).toBe('running')

    // 他人查同一个 session 的进行中 Run 不暴露存在性。
    const other = await register(test.app, 'recovery-active-other@example.com')
    const foreign = await test.app.request(`/api/ai/sessions/${sessionId}/active-run`, {
      headers: { cookie: other.cookie },
    })
    expect(foreign.status).toBe(404)

    // 这一轮的用户提问已经在 transcript 里，assistant 消息要等终态才落盘。
    const transcript = await test.app.request(`/api/ai/sessions/${sessionId}/transcript`, {
      headers: { cookie: user.cookie },
    })
    const transcriptBody = await readSuccess<{
      items: Array<{ content?: string; type: string }>
    }>(transcript)
    expect(
      transcriptBody.data.items.some((item) => item.type === 'user_message' && item.content === '刷新前的提问'),
    ).toBe(true)
    expect(transcriptBody.data.items.some((item) => item.type === 'assistant_message')).toBe(false)

    const resumed = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs/${startedRunId}/events/stream?afterSequence=0`,
      { headers: { cookie: user.cookie } },
    )
    expect(resumed.status).toBe(200)
    const resumedBody = readSseBody(resumed)
    release()
    const resumedEvents = parseSseEvents(await resumedBody)
    const sequences = resumedEvents.map((event) => event.sequence)
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, index) => index + 1))
    expect(resumedEvents[0]?.type).toBe('run.started')
    expect(resumedEvents.some((event) => event.type === 'message.delta' && event.data.delta === '恢复流正文')).toBe(
      true,
    )
    expect(resumedEvents.at(-1)?.type).toBe('run.completed')

    const afterTerminal = await test.app.request(`/api/ai/sessions/${sessionId}/active-run`, {
      headers: { cookie: user.cookie },
    })
    const afterTerminalBody = await readSuccess<{ id: string } | null>(afterTerminal)
    expect(afterTerminalBody.data).toBeNull()
  } finally {
    test.cleanup()
    await store.close()
  }
})

it('恢复 SSE 断开会立即清理挂起的 subscriber', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-recovery-cancel-'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const endSpy = vi.spyOn(AsyncEventQueue.prototype, 'end')
  const test = runTestApp({
    store,
    tools: createAiToolRegistry([]),
    streamSimple: () => delayedTextStream(gate, '恢复取消后继续完成'),
  })
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'recovery-cancel@example.com')
    const sessionId = await createSession(test.app, user.cookie)
    const response = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: '取消恢复流' }),
    })
    const { prefix, reader } = await readFirstSseFrame(response)
    const startedRunId = parseSseEvents(prefix)[0]?.runId
    expect(startedRunId).toBeTruthy()
    await reader.cancel()
    await vi.waitFor(() => expect(endSpy.mock.calls.length).toBeGreaterThan(0))

    const endsBeforeResumeCancel = endSpy.mock.calls.length
    const resumed = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs/${startedRunId}/events/stream?afterSequence=0`,
      { headers: { cookie: user.cookie } },
    )
    const { prefix: resumedPrefix, reader: resumedReader } = await readFirstSseFrame(resumed)
    expect(parseSseEvents(resumedPrefix)[0]?.type).toBe('run.started')
    await resumedReader.cancel()
    await vi.waitFor(() => expect(endSpy.mock.calls.length).toBeGreaterThan(endsBeforeResumeCancel))

    release()
    const completed = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs/${startedRunId}/events/stream?afterSequence=0`,
      { headers: { cookie: user.cookie } },
    )
    const completedEvents = parseSseEvents(await readSseBody(completed))
    expect(completedEvents.at(-1)?.type).toBe('run.completed')
  } finally {
    release()
    endSpy.mockRestore()
    test.cleanup()
    await store.close()
  }
})

it('终态事务返回 false 时仍关闭初始 SSE queue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-terminal-false-'))
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
    streamSimple: () => delayedTextStream(gate, '终态事务已被其他写入抢先完成'),
  })
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'terminal-false@example.com')
    const sessionId = await createSession(test.app, user.cookie)
    const response = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: '终态事务 false' }),
    })
    const { prefix, reader } = await readFirstSseFrame(response)
    const runId = parseSseEvents(prefix)[0]?.runId
    if (!runId) throw new Error('SSE 缺少 runId')
    test.runtime.database.sqlite
      .prepare('UPDATE ai_agent_runs SET status = ?, finished_at = ? WHERE id = ?')
      .run('completed', new Date().toISOString(), runId)

    release()
    const events = parseSseEvents(await readRemainingSse(prefix, reader))
    expect(events.some((event) => ['run.completed', 'run.failed', 'run.aborted'].includes(event.type))).toBe(false)
  } finally {
    release()
    test.cleanup()
    await store.close()
  }
})

it('终态事务抛异常时仍关闭初始 SSE queue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-terminal-throw-'))
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
    streamSimple: () => delayedTextStream(gate, '终态事务抛错后仍收尾'),
  })
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'terminal-throw@example.com')
    const sessionId = await createSession(test.app, user.cookie)
    const response = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: '终态事务 throw' }),
    })
    const { prefix, reader } = await readFirstSseFrame(response)
    expect(parseSseEvents(prefix)[0]?.type).toBe('run.started')
    test.runtime.database.sqlite.exec('DROP TABLE ai_agent_runs')

    release()
    const events = parseSseEvents(await readRemainingSse(prefix, reader))
    expect(events.some((event) => ['run.completed', 'run.failed', 'run.aborted'].includes(event.type))).toBe(false)
  } finally {
    release()
    test.cleanup()
    await store.close()
  }
})

it('从最后一个 message.delta 和 tool.progress 之后继续到 terminal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-recovery-cursor-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const tools = createAiToolRegistry([
    defineAiTool({
      sideEffect: 'read_only',
      name: 'progress-tool',
      version: '1.0.0',
      description: '报告进度',
      inputSchema: z.object({}),
      timeoutMs: 1000,
      scope: 'platform',
      requiredPermission: null,
      execute: async (context) => {
        context.reportProgress('处理中')
        return { modelText: '完成', safeSummary: '已完成' }
      },
    }),
  ])
  let calls = 0
  const test = runTestApp({
    store,
    tools,
    streamSimple: (_model, context) => {
      calls += 1
      const last = context.messages.at(-1)
      if (last?.role === 'toolResult') {
        return streamAssistant(assistantMessage([{ type: 'text', text: '完成' }], 'stop'), 'stop')
      }
      return streamAssistant(
        assistantMessage(
          [
            {
              type: 'toolCall',
              id: 'progress-call',
              name: 'progress-tool',
              arguments: {},
            },
          ],
          'toolUse',
        ),
        'toolUse',
      )
    },
  })
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [{ name: 'progress-tool', version: '1.0.0' }])
    const user = await register(test.app, 'recovery-cursor@example.com')
    const sessionId = await createSession(test.app, user.cookie)
    const response = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: '执行' }),
    })
    const all = parseSseEvents(await readSseBody(response))
    const delta = [...all].reverse().find((event) => event.type === 'message.delta')
    const progress = [...all].reverse().find((event) => event.type === 'tool.progress')
    expect(delta).toBeDefined()
    expect(progress).toBeDefined()

    for (const consumed of [delta, progress]) {
      const cursor = consumed?.sequence ?? 0
      const resumed = await test.app.request(
        `/api/ai/sessions/${sessionId}/runs/${all[0]?.runId}/events?afterSequence=${cursor}`,
        { headers: { cookie: user.cookie } },
      )
      const body = await readSuccess<{
        items: Array<{ sequence: number; type: string }>
      }>(resumed)
      const sequences = body.data.items.map((event) => event.sequence)
      expect(sequences).toEqual(
        Array.from({ length: (all.at(-1)?.sequence ?? cursor) - cursor }, (_, index) => cursor + index + 1),
      )
      expect(body.data.items.every((event) => event.sequence > cursor)).toBe(true)
      expect(body.data.items.some((event) => event.type === 'run.completed')).toBe(true)
      expect(
        body.data.items.some((event) => event.sequence === consumed?.sequence && event.type === consumed.type),
      ).toBe(false)
    }
    expect(calls).toBe(2)

    const firstEvent = all[0]
    if (!firstEvent) throw new Error('Run 没有事件')
    const resumedSse = await test.app.request(`/api/ai/sessions/${sessionId}/runs/${firstEvent.runId}/events/stream`, {
      headers: {
        cookie: user.cookie,
        'Last-Event-ID': firstEvent.eventId,
      },
    })
    expect(resumedSse.status).toBe(200)
    const resumedEvents = parseSseEvents(await readSseBody(resumedSse))
    expect(resumedEvents.every((event) => event.sequence > firstEvent.sequence)).toBe(true)
    expect(resumedEvents.at(-1)?.type).toBe('run.completed')
    expect(new Set(resumedEvents.map((event) => event.runId))).toEqual(new Set([firstEvent.runId]))

    const unknownEvent = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs/${firstEvent.runId}/events/stream`,
      {
        headers: {
          cookie: user.cookie,
          'Last-Event-ID': '00000000-0000-7000-8000-000000000000',
        },
      },
    )
    expect(unknownEvent.status).toBe(400)
  } finally {
    test.cleanup()
    await store.close()
  }
})

it('进程重启后可以查询完整持久 Timeline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-recovery-restart-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const test = runTestApp({
    store,
    tools: createAiToolRegistry([]),
    streamSimple: () => streamAssistant(assistantMessage([{ type: 'text', text: '持久结果' }], 'stop'), 'stop'),
  })
  let secondRuntime: ReturnType<typeof createRuntime> | undefined
  try {
    seedEnabledModel(test.runtime)
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'recovery-restart@example.com')
    const sessionId = await createSession(test.app, user.cookie)
    const response = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, input: '持久化' }),
    })
    const events = parseSseEvents(await readSseBody(response))
    const runId = events[0]?.runId
    expect(runId).toBeTruthy()
    const databasePath = test.runtime.env.DATABASE_PATH
    const sessionDatabasePath = test.runtime.env.AGENT_SESSION_DATABASE_PATH
    await test.runtime.close()
    secondRuntime = createRuntime(
      {
        ...process.env,
        APP_ENV: 'test',
        DATABASE_PATH: databasePath,
        AGENT_SESSION_DATABASE_PATH: sessionDatabasePath,
        FILES_DIR: join(directory, 'files'),
        BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters',
        BETTER_AUTH_URL: 'http://localhost:7788',
        AI_CREDENTIAL_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      },
      {
        agentSessionStore: createPiSessionStore({
          cwd: directory,
          databasePath: sessionDatabasePath,
        }),
      },
    )
    const restartedApp = createApp(secondRuntime)
    const timeline = await restartedApp.request(`/api/ai/sessions/${sessionId}/runs/${runId}/timeline?pageSize=200`, {
      headers: { cookie: user.cookie },
    })
    const timelineBody = await readSuccess<{
      items: Array<{ sequence: number }>
    }>(timeline)
    const sequences = timelineBody.data.items.map((event) => event.sequence)
    expect(sequences).toEqual(Array.from({ length: events.length }, (_, index) => index + 1))
    const detail = await restartedApp.request(`/api/ai/sessions/${sessionId}/runs/${runId}`, {
      headers: { cookie: user.cookie },
    })
    const detailBody = await readSuccess<{ status: string; live: unknown }>(detail)
    expect(detailBody.data.status).toBe('completed')
    expect(detailBody.data.live).toBeNull()
  } finally {
    await secondRuntime?.close().catch(() => undefined)
    test.cleanup()
    await store.close().catch(() => undefined)
  }
})
