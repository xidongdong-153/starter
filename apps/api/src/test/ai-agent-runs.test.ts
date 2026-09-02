import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Logger } from 'pino'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Context, Model, Models, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { ApiErrorCodes, starterRunDataSchema } from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'

import { createActiveRunRegistry, createPiAgentExecutor, type PiAgentExecutor } from '@api/infra/agent/index.js'
import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import {
  aiAgentDefinitions,
  aiAgentRuns,
  aiAgentSessions,
  aiEnabledModels,
  aiModelCalls,
  aiProviderConfigs,
  aiRunSteps,
  aiRunTurns,
  aiSkills,
  aiStructuredOutputs,
  aiToolExecutions,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@api/infra/db/schema/index.js'
import { createAiToolRegistry, defineAiTool } from '@api/modules/ai/tool/tool-registry.js'
import { createAiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'

import {
  createAiAgentRunRepository,
  createAiAgentRunService,
  createAiRunEventRepository,
  createAiRunLifecycleRepository,
} from '@api/modules/ai/run/index.js'
import { createAiAgentSessionRepository } from '@api/modules/ai/session/index.js'
import { createAiUsageAuditRepository } from '@api/modules/ai/usage-audit/usage-audit.repository.js'
import { createAiUsageAuditService } from '@api/modules/ai/usage-audit/usage-audit.service.js'
import { generateId } from '@api/shared/id.js'
import { z } from 'zod'

import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

const model: Model<Api> = {
  id: 'test-model',
  name: 'Test model',
  api: 'openai-completions',
  provider: 'test-provider',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 1024,
}

function assistantMessage(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  }
}

function streamResponse(
  message: AssistantMessage,
  reason: Extract<AssistantMessage['stopReason'], 'stop' | 'length' | 'toolUse' | 'deferred'>,
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  const partial = assistantMessage([], 'pending')
  stream.push({ type: 'start', partial })
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === 'text') {
      stream.push({
        type: 'text_delta',
        contentIndex,
        delta: block.text,
        partial: assistantMessage(message.content.slice(0, contentIndex + 1), 'pending'),
      })
    }
  }
  stream.push({ type: 'done', reason, message })
  return stream
}

function streamError(): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  const partial = assistantMessage([], 'error')
  stream.push({ type: 'start', partial })
  stream.push({ type: 'error', reason: 'error', error: partial })
  return stream
}

async function readSse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('缺少 SSE body')
  const decoder = new TextDecoder()
  let body = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    body += decoder.decode(chunk.value, { stream: true })
  }
  body += decoder.decode()
  reader.releaseLock()
  return body
}

function parseSseEvents(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  let eventType: string | null = null
  const dataLines: string[] = []
  for (const line of body.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
      continue
    }
    if (line.trim() === '' && dataLines.length > 0) {
      const event = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
      events.push({ ...event, _sseType: eventType })
      eventType = null
      dataLines.length = 0
    }
  }
  return events
}

async function setupAgent(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
  admin: { cookie: string },
  name: string,
  maxTurns = 8,
  toolRefs: Array<{ name: string; version: string }> = [],
  outputContract?: import('@api/modules/ai/output/output-contract-registry.js').ResolvedAiOutputContract,
): Promise<{
  agentId: string
  modelRef: { providerId: string; modelId: string }
  promptId: string
}> {
  const prompt = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
    name: `${name}-prompt`,
    content: '只返回事实。',
  })
  const promptBody = await readSuccess<{ id: string }>(prompt)
  const modelRef = seedModel(runtime)
  const created = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
    name,
    config: {
      schemaVersion: 2,
      model: modelRef,
      systemPromptId: promptBody.data.id,
      skillIds: [],
      toolRefs,
      ...(outputContract ? { outputContract: outputContract.ref } : {}),
      thinkingLevel: 'off',
      maxTurns,
    },
  })
  const createdBody = await readSuccess<{ id: string }>(created)
  const enabled = await patchJson(app, `/api/ai/admin/agents/${createdBody.data.id}/status`, admin.cookie, {
    status: 'enabled',
  })
  expect(enabled.status).toBe(200)
  return {
    agentId: createdBody.data.id,
    modelRef,
    promptId: promptBody.data.id,
  }
}

async function createSession(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  title: string,
): Promise<{ sessionId: string }> {
  const created = await postJson(app, '/api/ai/sessions', cookie, { title })
  expect(created.status).toBe(200)
  const body = await readSuccess<{ id: string }>(created)
  return { sessionId: body.data.id }
}

async function startRun(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  sessionId: string,
  input: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

async function getRun(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  sessionId: string,
  runId: string,
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs/${runId}`, {
    headers: { cookie },
  })
}

async function postRunAction(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  sessionId: string,
  runId: string,
  action: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs/${runId}/${action}`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

it('文本 Run 从 starting/running 进入唯一 completed 终态，SSE 顺序正确', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-success-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const streamFn = (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) =>
    streamResponse(assistantMessage([{ type: 'text', text: 'hello from run' }], 'stop'), 'stop')
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-success@example.com')
    const { agentId, modelRef } = await setupAgent(app, runtime, admin, 'success-agent')
    const { sessionId } = await createSession(app, user.cookie, '成功 Run')

    const started = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'hello',
    })
    expect(started.status).toBe(200)
    const body = await readSse(started)
    const events = parseSseEvents(body)
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'turn.started',
      'step.started',
      'message.started',
      'message.delta',
      'message.completed',
      'step.completed',
      'turn.completed',
      'run.completed',
    ])
    const sequences = events.map((event) => event.sequence as number)
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(events.filter((event) => String(event.type).startsWith('run.'))).toHaveLength(2)
    const terminalEvents = events.filter(
      (event) => event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted',
    )
    expect(terminalEvents).toHaveLength(1)
    // 模型自己给出文字回答，停止原因是 model_finished
    expect(terminalEvents[0]?.data).toMatchObject({
      reason: 'model_finished',
    })

    const runId = events[0]?.runId as string
    expect(runId).toBeTruthy()
    const detail = await getRun(app, user.cookie, sessionId, runId)
    expect(detail.status).toBe(200)
    const detailBody = await readSuccess<{
      status: string
      finalEntryId: string | null
      errorCode: string | null
      agentRevision: number
      snapshot: { model: { providerId: string; modelId: string } }
    }>(detail)
    expect(detailBody.data).toMatchObject({
      status: 'completed',
      finalEntryId: expect.any(String),
      errorCode: null,
      agentRevision: 1,
      snapshot: {
        model: modelRef,
      },
    })
    expect(
      runtime.db
        .select({ outcome: aiRunTurns.outcome })
        .from(aiRunTurns)
        .where(eq(aiRunTurns.runId, runId))
        .all()
        .every((row) => row.outcome !== 'running'),
    ).toBe(true)
    expect(
      runtime.db
        .select({ outcome: aiRunSteps.outcome })
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all()
        .every((row) => row.outcome !== 'running'),
    ).toBe(true)
    expect(
      runtime.db
        .select({ result: aiModelCalls.result })
        .from(aiModelCalls)
        .where(eq(aiModelCalls.runId, runId))
        .all()
        .every((row) => row.result !== 'running'),
    ).toBe(true)
    expect(
      runtime.db
        .select({ status: aiToolExecutions.status })
        .from(aiToolExecutions)
        .where(eq(aiToolExecutions.runId, runId))
        .all()
        .every((row) => row.status !== 'running'),
    ).toBe(true)

    // Pi 侧只写一条 starter.run
    const entries = await store.findRunTerminalEntries({
      sessionId,
      lane: 'main',
      runId,
    })
    expect(entries).toHaveLength(1)
    expect(starterRunDataSchema.safeParse(entries[0]?.data).success).toBe(true)

    // 主库记录终态
    const row = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
    expect(row?.status).toBe('completed')
    expect(row?.finalEntryId).toBeTruthy()
    expect(row?.finishedAt).toBeTruthy()
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('run 启动时固定 Tool 版本；改 Agent 配置不影响已启动 Run，新 Run 用新版本', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-fixed-tool-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const captured: Context[] = []
  const streamFn = (_model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => {
    captured.push(context)
    const last = context.messages.at(-1)
    if (last?.role === 'toolResult') {
      return streamResponse(assistantMessage([{ type: 'text', text: 'done' }], 'stop'), 'stop')
    }
    return streamResponse(
      assistantMessage(
        [
          {
            type: 'toolCall',
            id: `fixed-tool-${captured.length}`,
            name: 'lookup',
            arguments: {},
          },
        ],
        'toolUse',
      ),
      'toolUse',
    )
  }
  const lookupV1 = defineAiTool({
    name: 'lookup',
    version: '1.0.0',
    description: 'Lookup v1',
    inputSchema: z.object({}),
    timeoutMs: 1000,
    scope: 'platform',
    requiredPermission: null,
    async execute() {
      return { modelText: 'lookup-v1-result', safeSummary: null }
    },
  })
  const lookupV2 = defineAiTool({
    name: 'lookup',
    version: '2.0.0',
    description: 'Lookup v2',
    inputSchema: z.object({}),
    timeoutMs: 1000,
    scope: 'platform',
    requiredPermission: null,
    async execute() {
      return { modelText: 'lookup-v2-result', safeSummary: null }
    },
  })
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutor: executor,
      aiTools: createAiToolRegistry([lookupV1, lookupV2]),
    },
  )
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-fixed-tool@example.com')
    const { agentId, modelRef, promptId } = await setupAgent(app, runtime, admin, 'fixed-tool-agent', 8, [
      { name: 'lookup', version: '1.0.0' },
    ])
    const sessionOne = await createSession(app, user.cookie, '固定 v1')
    const startedOne = await startRun(app, user.cookie, sessionOne.sessionId, {
      agentId,
      input: 'use lookup',
    })
    expect(startedOne.status).toBe(200)
    const runOneEvents = parseSseEvents(await readSse(startedOne))
    const runOneId = runOneEvents[0]?.runId as string | undefined
    if (!runOneId) throw new Error('SSE 缺少 runId')

    // Run 1 持有 v1：工具结果出现在模型 context 中，snapshot 固定 v1
    const v1Context = captured.find((context) => context.messages.some((message) => message.role === 'toolResult'))
    expect(JSON.stringify(v1Context?.messages)).toContain('lookup-v1-result')
    expect(JSON.stringify(v1Context?.messages)).not.toContain('lookup-v2-result')
    const runOne = await getRun(app, user.cookie, sessionOne.sessionId, runOneId)
    expect(runOne.status).toBe(200)
    expect(
      (
        await readSuccess<{
          snapshot: { toolRefs: { name: string; version: string }[] }
        }>(runOne)
      ).data.snapshot.toolRefs,
    ).toEqual([{ name: 'lookup', version: '1.0.0' }])
    const oneRow = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runOneId)).get()
    expect(oneRow?.snapshotJson).not.toContain('"execute"')
    expect(oneRow?.snapshotJson).not.toContain('inputSchema')
    expect(oneRow?.snapshotJson).not.toContain('timeoutMs')
    expect(oneRow?.snapshotJson).not.toContain('requiredPermission')

    // 修改 Agent 配置到 v2：Run 1 的内存 Tool 不变，新 Run 解析新版本
    const patched = await patchJson(app, `/api/ai/admin/agents/${agentId}`, admin.cookie, {
      config: {
        schemaVersion: 2,
        model: modelRef,
        systemPromptId: promptId,
        skillIds: [],
        toolRefs: [{ name: 'lookup', version: '2.0.0' }],
        thinkingLevel: 'off',
        maxTurns: 8,
      },
    })
    expect(patched.status).toBe(200)
    const runOneAfter = await getRun(app, user.cookie, sessionOne.sessionId, runOneId)
    expect(
      (
        await readSuccess<{
          snapshot: { toolRefs: { name: string; version: string }[] }
        }>(runOneAfter)
      ).data.snapshot.toolRefs,
    ).toEqual([{ name: 'lookup', version: '1.0.0' }])

    const sessionTwo = await createSession(app, user.cookie, '新 v2')
    const startedTwo = await startRun(app, user.cookie, sessionTwo.sessionId, {
      agentId,
      input: 'use lookup again',
    })
    expect(startedTwo.status).toBe(200)
    await readSse(startedTwo)
    const v2Context = captured
      .slice(captured.findIndex((context) => context.messages.some((message) => message.role === 'toolResult')) + 1)
      .find((context) => context.messages.some((message) => message.role === 'toolResult'))
    expect(JSON.stringify(v2Context?.messages)).toContain('lookup-v2-result')
    expect(JSON.stringify(v2Context?.messages)).not.toContain('lookup-v1-result')
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('撞上 maxTurns 时追加收尾轮，run.completed 的 reason 是 max_turns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-max-turns-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  let calls = 0
  const streamFn = (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
    calls += 1
    // 前两轮一直请求工具，收尾轮才给文字
    if (calls <= 2) {
      return streamResponse(
        assistantMessage(
          [
            {
              type: 'toolCall',
              id: `tool-call-${calls}`,
              name: 'lookup',
              arguments: { value: 'input' },
            },
          ],
          'toolUse',
        ),
        'toolUse',
      )
    }
    return streamResponse(assistantMessage([{ type: 'text', text: '收尾总结' }], 'stop'), 'stop')
  }
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-max-turns@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'max-turns-agent', 2)
    const { sessionId } = await createSession(app, user.cookie, '轮次上限')

    const started = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'keep calling tools',
    })
    expect(started.status).toBe(200)
    const events = parseSseEvents(await readSse(started))

    // 2 轮工具轮 + 1 轮收尾
    expect(calls).toBe(3)
    const completed = events.filter((event) => event.type === 'run.completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.data).toMatchObject({
      reason: 'max_turns',
    })
    // 最后一条 assistant 消息是文字总结
    const messages = events.filter((event) => event.type === 'message.completed')
    expect(messages.at(-1)?.data).toMatchObject({ content: '收尾总结' })

    const runId = events[0]?.runId as string
    const row = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
    expect(row?.status).toBe('completed')
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('同一 Session lane 并发返回 AI_SESSION_BUSY，不创建多余 Run row', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-busy-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  let releaseFirst!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const streamFn = (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream()
    void gate.then(() => {
      stream.push({
        type: 'done',
        reason: 'stop',
        message: assistantMessage([{ type: 'text', text: 'done' }], 'stop'),
      })
    })
    return stream
  }
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  })
  const registry = createActiveRunRegistry()
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutor: executor,
      activeRunRegistry: registry,
    },
  )
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-busy@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'busy-agent')
    const { sessionId } = await createSession(app, user.cookie, 'busy')

    const first = startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'first',
    })
    await vi.waitFor(() => {
      expect(registry.getBySessionLane(sessionId, 'main')).toBeDefined()
    })

    const second = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'second',
    })
    expect(second.status).toBe(409)
    expect((await readFailure(second)).error.code).toBe(ApiErrorCodes.AI_SESSION_BUSY)

    releaseFirst()
    const firstResponse = await first
    expect(firstResponse.status).toBe(200)
    const body = await readSse(firstResponse)
    expect(parseSseEvents(body).some((event) => event.type === 'run.completed')).toBe(true)

    // 只创建了一条 Run row
    const rows = runtime.db.select({ id: aiAgentRuns.id }).from(aiAgentRuns).all()
    expect(rows).toHaveLength(1)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('不同 lane 可以并发', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-lanes-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  let releaseA!: () => void
  let releaseB!: () => void
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve
  })
  const gateB = new Promise<void>((resolve) => {
    releaseB = resolve
  })
  const streamFn = (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream()
    void Promise.race([gateA, gateB]).then(() => {
      stream.push({
        type: 'done',
        reason: 'stop',
        message: assistantMessage([{ type: 'text', text: 'done' }], 'stop'),
      })
    })
    return stream
  }
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-lanes@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'lane-agent')
    const { sessionId } = await createSession(app, user.cookie, 'lanes')

    const a = startRun(app, user.cookie, sessionId, {
      agentId,
      lane: 'a',
      input: 'a',
    })
    const b = startRun(app, user.cookie, sessionId, {
      agentId,
      lane: 'b',
      input: 'b',
    })
    const [responseA, responseB] = await Promise.all([a, b])
    expect(responseA.status).toBe(200)
    expect(responseB.status).toBe(200)
    releaseA()
    releaseB()
    const bodyA = await readSse(responseA)
    const bodyB = await readSse(responseB)
    expect(parseSseEvents(bodyA).some((event) => event.type === 'run.completed')).toBe(true)
    expect(parseSseEvents(bodyB).some((event) => event.type === 'run.completed')).toBe(true)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('provider 失败映射为稳定 failed 终态', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-failed-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () => streamError(),
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-failed@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'fail-agent')
    const { sessionId } = await createSession(app, user.cookie, 'fail')

    const started = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'boom',
    })
    expect(started.status).toBe(200)
    const body = await readSse(started)
    const events = parseSseEvents(body)
    const failed = events.find((event) => event.type === 'run.failed')
    expect(failed).toBeDefined()
    expect((failed?.data as { error: { code: string } }).error.code).toBe(ApiErrorCodes.AI_UPSTREAM_ERROR)

    const runId = events[0]?.runId as string
    const detail = await getRun(app, user.cookie, sessionId, runId)
    const detailBody = await readSuccess<{
      status: string
      errorCode: string
    }>(detail)
    expect(detailBody.data.status).toBe('failed')
    expect(detailBody.data.errorCode).toBe(ApiErrorCodes.AI_UPSTREAM_ERROR)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('prepare 失败后释放 lane lease，下一次同 lane Run 可以启动', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-prepare-failed-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const prepare = vi.fn(() => {
    throw new Error('prepare failed')
  })
  const executor = { prepare } as unknown as PiAgentExecutor
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-prepare-failed@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'prepare-failed-agent')
    const { sessionId } = await createSession(app, user.cookie, 'prepare failed')

    const first = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'first',
    })
    expect(first.status).toBe(200)
    const firstEvents = parseSseEvents(await readSse(first))
    expect(firstEvents.map((event) => event.type)).toEqual(['run.failed'])

    const second = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'second',
    })
    expect(second.status).toBe(200)
    const secondEvents = parseSseEvents(await readSse(second))
    expect(secondEvents.map((event) => event.type)).toEqual(['run.failed'])
    expect(prepare).toHaveBeenCalledTimes(2)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('abort 产生 aborted 终态；终态后 steer/follow-up 返回 AI_RUN_NOT_ACTIVE', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-abort-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const streamFn = (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream()
    const partial = assistantMessage([], 'pending')
    stream.push({ type: 'start', partial })
    void gate.then(() => {
      stream.push({
        type: 'done',
        reason: 'stop',
        message: assistantMessage([{ type: 'text', text: 'late' }], 'stop'),
      })
    })
    return stream
  }
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-abort@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'abort-agent')
    const { sessionId } = await createSession(app, user.cookie, 'abort')

    // 从 SSE 首事件拿 runId
    const startedPromise = startRun(app, user.cookie, sessionId, {
      agentId,
      input: 'abort me',
    })
    let runId: string | undefined
    await vi.waitFor(async () => {
      const response = await startedPromise
      void response
      const rows = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).all()
      expect(rows.length).toBe(1)
      runId = rows[0]?.id
      expect(runId).toBeTruthy()
    })
    if (!runId) throw new Error('Run 未创建')

    // active 期间 steer / follow-up 生效
    const steer = await postRunAction(app, user.cookie, sessionId, runId, 'steer', {
      text: 'be brief',
    })
    expect(steer.status).toBe(200)
    const followUp = await postRunAction(app, user.cookie, sessionId, runId, 'follow-ups', { text: 'and now?' })
    expect(followUp.status).toBe(200)

    const abort = await postRunAction(app, user.cookie, sessionId, runId, 'abort')
    expect(abort.status).toBe(200)
    release()

    const started = await startedPromise
    const body = await readSse(started)
    const events = parseSseEvents(body)
    const aborted = events.find((event) => event.type === 'run.aborted')
    expect(aborted).toBeDefined()

    // 终态后控制接口返回 AI_RUN_NOT_ACTIVE
    const steerAfter = await postRunAction(app, user.cookie, sessionId, runId, 'steer', { text: 'too late' })
    expect(steerAfter.status).toBe(409)
    expect((await readFailure(steerAfter)).error.code).toBe(ApiErrorCodes.AI_RUN_NOT_ACTIVE)
    const detail = await getRun(app, user.cookie, sessionId, runId)
    const detailBody = await readSuccess<{
      status: string
      errorCode: string
    }>(detail)
    expect(detailBody.data.status).toBe('aborted')
    expect(detailBody.data.errorCode).toBe(ApiErrorCodes.AI_REQUEST_ABORTED)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('他人 Session 或 Run 一律 404，不能靠 id 探测', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-owner-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () => streamResponse(assistantMessage([{ type: 'text', text: 'ok' }], 'stop'), 'stop'),
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const owner = await register(app, 'run-owner-a@example.com')
    const other = await register(app, 'run-owner-b@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'owner-agent')
    const { sessionId } = await createSession(app, owner.cookie, 'owner')

    const started = await startRun(app, owner.cookie, sessionId, {
      agentId,
      input: 'mine',
    })
    const body = await readSse(started)
    const runId = parseSseEvents(body)[0]?.runId as string

    // 他人读 run / abort / steer / follow-up 全部 404
    const read = await getRun(app, other.cookie, sessionId, runId)
    expect(read.status).toBe(404)
    const abort = await postRunAction(app, other.cookie, sessionId, runId, 'abort')
    expect(abort.status).toBe(404)
    const steer = await postRunAction(app, other.cookie, sessionId, runId, 'steer', {
      text: 'x',
    })
    expect(steer.status).toBe(404)
    // 他人对 owner session 启动 Run 也 404
    const otherStart = await startRun(app, other.cookie, sessionId, {
      agentId,
      input: 'not yours',
    })
    expect(otherStart.status).toBe(404)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('启动恢复：无 terminal entry 标记 interrupted，唯一合法 entry 投影终态', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const owner = await register(app, 'recover-owner@example.com')
    const agentId = await seedAgentDefinition(runtime, 'recover-agent-1')
    const sessionId = generateId()
    await runtime.agentSessionStore.createSession({ id: sessionId })
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: sessionId,
        ownerId: owner.user.id,
        title: '恢复',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()

    const runId = generateId()
    const now = new Date()
    await runtime.db
      .insert(aiAgentRuns)
      .values({
        id: runId,
        sessionId,
        agentId,
        lane: 'main',
        status: 'running',
        agentRevision: 1,
        snapshotJson: JSON.stringify({
          schemaVersion: 2,
          agentId,
          agentRevision: 1,
          model: { providerId: model.provider, modelId: model.id },
          systemPromptId: null,
          skillIds: [],
          toolRefs: [],
          thinkingLevel: 'off',
          maxTurns: 8,
        }),
        requestId: 'request-recover',
        createdAt: now,
        startedAt: now,
      })
      .run()

    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger
    const service = createAiAgentRunService({
      repository: createAiAgentRunRepository(runtime.db),
      sessionRepository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      agentService: {} as never,
      registry: createActiveRunRegistry(),
      executor: {} as never,
      logger,
      eventRepository: createAiRunEventRepository(runtime.db),
      outputContractRegistry: createAiOutputContractRegistry(),
      resolveAttachments: async () => [],
      supportsImageInput: () => false,
    })

    // 无 terminal entry -> interrupted
    const report = await service.recoverInterrupted()
    expect(report.scanned).toBe(1)
    expect(report.interrupted).toBe(1)
    const row = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
    expect(row?.status).toBe('interrupted')
    expect(row?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)
  } finally {
    cleanup()
  }
})

it('启动恢复：唯一合法 entry 投影终态；重复 entry 标记 interrupted', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const owner = await register(app, 'recover-entry@example.com')
    const agentId = await seedAgentDefinition(runtime, 'recover-agent-2')
    const sessionId = generateId()
    await runtime.agentSessionStore.createSession({ id: sessionId })
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: sessionId,
        ownerId: owner.user.id,
        title: '恢复 entry',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()

    const now = new Date()
    const makeRun = async (status: 'running' | 'starting') => {
      const runId = generateId()
      await runtime.db
        .insert(aiAgentRuns)
        .values({
          id: runId,
          sessionId,
          agentId,
          lane: 'main',
          status,
          agentRevision: 1,
          snapshotJson: JSON.stringify({
            schemaVersion: 2,
            agentId,
            agentRevision: 1,
            model: { providerId: model.provider, modelId: model.id },
            systemPromptId: null,
            skillIds: [],
            toolRefs: [],
            thinkingLevel: 'off',
            maxTurns: 8,
          }),
          requestId: 'request-recover-entry',
          createdAt: now,
          startedAt: status === 'running' ? now : null,
        })
        .run()
      return runId
    }

    const recoveredRunId = await makeRun('running')
    const session = await runtime.agentSessionStore.openSession(sessionId)
    const finalEntryId = generateId()
    await session.appendRunTerminalEntry('main', {
      schemaVersion: 1,
      runId: recoveredRunId,
      sessionId,
      lane: 'main',
      agentId,
      agentRevision: 1,
      status: 'completed',
      finalEntryId,
      errorCode: null,
      finishedAt: Date.now(),
    })

    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger
    const service = createAiAgentRunService({
      repository: createAiAgentRunRepository(runtime.db),
      sessionRepository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      agentService: {} as never,
      registry: createActiveRunRegistry(),
      executor: {} as never,
      logger,
      eventRepository: createAiRunEventRepository(runtime.db),
      outputContractRegistry: createAiOutputContractRegistry(),
      resolveAttachments: async () => [],
      supportsImageInput: () => false,
    })
    const report = await service.recoverInterrupted()
    expect(report.recoveredFromEntry).toBe(1)
    const recoveredRow = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, recoveredRunId)).get()
    expect(recoveredRow?.status).toBe('completed')
    expect(recoveredRow?.finalEntryId).toBe(finalEntryId)
    expect(recoveredRow?.finishedAt).toBeTruthy()

    // 重复 entry 视为损坏 -> interrupted
    const corruptedRunId = await makeRun('starting')
    await session.appendRunTerminalEntry('main', {
      schemaVersion: 1,
      runId: corruptedRunId,
      sessionId,
      lane: 'main',
      agentId,
      agentRevision: 1,
      status: 'completed',
      finalEntryId: generateId(),
      errorCode: null,
      finishedAt: Date.now(),
    })
    await session.appendRunTerminalEntry('main', {
      schemaVersion: 1,
      runId: corruptedRunId,
      sessionId,
      lane: 'main',
      agentId,
      agentRevision: 1,
      status: 'failed',
      finalEntryId: null,
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      finishedAt: Date.now(),
    })
    const report2 = await service.recoverInterrupted()
    expect(report2.corrupted).toBe(1)
    const corruptedRow = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, corruptedRunId)).get()
    expect(corruptedRow?.status).toBe('interrupted')
    expect(corruptedRow?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)

    // entry 结构合法但身份字段与主库 Run 不一致，同样视为损坏。
    const mismatchedRunId = await makeRun('running')
    await session.appendRunTerminalEntry('main', {
      schemaVersion: 1,
      runId: mismatchedRunId,
      sessionId,
      lane: 'main',
      agentId: generateId(),
      agentRevision: 1,
      status: 'failed',
      finalEntryId: null,
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      finishedAt: Date.now(),
    })
    const report3 = await service.recoverInterrupted()
    expect(report3.corrupted).toBe(1)
    const mismatchedRow = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, mismatchedRunId)).get()
    expect(mismatchedRow?.status).toBe('interrupted')
    expect(mismatchedRow?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)
  } finally {
    cleanup()
  }
})

it('启动恢复：schema 解析失败标记 AI.RUN_INTERRUPTED', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const owner = await register(app, 'recover-schema@example.com')
    const agentId = await seedAgentDefinition(runtime, 'recover-agent-3')
    const sessionId = generateId()
    await runtime.agentSessionStore.createSession({ id: sessionId })
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: sessionId,
        ownerId: owner.user.id,
        title: '恢复 schema',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()

    const runId = generateId()
    const now = new Date()
    await runtime.db
      .insert(aiAgentRuns)
      .values({
        id: runId,
        sessionId,
        agentId,
        lane: 'main',
        status: 'running',
        agentRevision: 1,
        snapshotJson: JSON.stringify({
          schemaVersion: 2,
          agentId,
          agentRevision: 1,
          model: { providerId: model.provider, modelId: model.id },
          systemPromptId: null,
          skillIds: [],
          toolRefs: [],
          thinkingLevel: 'off',
          maxTurns: 8,
        }),
        requestId: 'request-recover-schema',
        createdAt: now,
        startedAt: now,
      })
      .run()

    // 错误 schema 的 custom entry：schemaVersion 非法但 runId 可匹配
    const session = await runtime.agentSessionStore.openSession(sessionId)
    await session.appendRunTerminalEntry('main', {
      schemaVersion: 99,
      runId,
      status: 'weird',
      finishedAt: 'not-a-number',
    })

    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger
    const service = createAiAgentRunService({
      repository: createAiAgentRunRepository(runtime.db),
      sessionRepository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      agentService: {} as never,
      registry: createActiveRunRegistry(),
      executor: {} as never,
      logger,
      eventRepository: createAiRunEventRepository(runtime.db),
      outputContractRegistry: createAiOutputContractRegistry(),
      resolveAttachments: async () => [],
      supportsImageInput: () => false,
    })
    const report = await service.recoverInterrupted()
    expect(report.corrupted).toBe(1)
    const row = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
    expect(row?.status).toBe('interrupted')
    expect(row?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)
  } finally {
    cleanup()
  }
})

it('transcript 写入侧挂载 runId（S5 约定）', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-runid-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () => streamResponse(assistantMessage([{ type: 'text', text: 'runid ok' }], 'stop'), 'stop'),
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-runid@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'runid-agent')
    const { sessionId } = await createSession(app, user.cookie, 'runid')

    const started = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: '挂 runId',
    })
    await readSse(started)

    const transcript = await app.request(`/api/ai/sessions/${sessionId}/transcript?lane=main`, {
      headers: { cookie: user.cookie },
    })
    const transcriptBody = await readSuccess<{
      items: Array<{
        type: string
        runId: string | null
        content?: string
      }>
    }>(transcript)
    const userItems = transcriptBody.data.items.filter((item) => item.type === 'user_message')
    expect(userItems.length).toBeGreaterThan(0)
    expect(userItems[0]?.runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(userItems[0]?.content).toContain('挂 runId')
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('活跃 Run 返回 live 快照，终态后为 null，他人 Run 仍 404', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-live-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  // 用 gate 把 Run 挂在 running 状态，才能观察到活跃快照。
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const streamFn = (_model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'start', partial: assistantMessage([], 'pending') })
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: '部分输出',
      partial: assistantMessage([{ type: 'text', text: '部分输出' }], 'pending'),
    })
    void gate.then(() => {
      stream.push({
        type: 'done',
        reason: 'stop',
        message: assistantMessage([{ type: 'text', text: '部分输出已完成' }], 'stop'),
      })
    })
    return stream
  }
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-live@example.com')
    const other = await register(app, 'run-live-other@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'live-agent')
    const { sessionId } = await createSession(app, user.cookie, 'live')

    const startedPromise = startRun(app, user.cookie, sessionId, {
      agentId,
      input: '看快照',
    })

    let runId: string | undefined
    await vi.waitFor(async () => {
      const rows = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).all()
      expect(rows.length).toBe(1)
      expect(rows[0]?.status).toBe('running')
      runId = rows[0]?.id
    })
    if (!runId) throw new Error('Run 未创建')

    // AC1：执行中的 Run 返回非空快照，部分文本与已推送 delta 一致
    type LiveDetail = {
      status: string
      live: {
        lastSequence: number
        turn: number
        maxTurns: number
        timeline: Array<{
          kind: string
          blocks?: Array<{ type: string; text: string }>
          completed?: boolean
        }>
      } | null
    }
    await vi.waitFor(async () => {
      const active = await getRun(app, user.cookie, sessionId, runId!)
      expect(active.status).toBe(200)
      const body = await readSuccess<LiveDetail>(active)
      expect(body.data.status).toBe('running')
      expect(body.data.live).not.toBeNull()
      const first = body.data.live?.timeline[0]
      expect(first?.kind).toBe('message')
      expect(first?.blocks).toEqual([{ type: 'text', text: '部分输出' }])
      expect(first?.completed).toBe(false)
      expect(body.data.live?.turn).toBe(1)
      expect(body.data.live?.maxTurns).toBe(8)
      expect(body.data.live?.lastSequence).toBeGreaterThan(0)
    })

    // AC3：他人读同一个 Run 仍 404，不泄露存在性
    const foreign = await getRun(app, other.cookie, sessionId, runId)
    expect(foreign.status).toBe(404)

    release()
    const started = await startedPromise
    const events = parseSseEvents(await readSse(started))
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)

    // AC2：终态后快照为 null，客户端回落 transcript
    const finished = await getRun(app, user.cookie, sessionId, runId)
    const finishedBody = await readSuccess<LiveDetail>(finished)
    expect(finishedBody.data.status).toBe('completed')
    expect(finishedBody.data.live ?? null).toBeNull()
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

async function registerAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
) {
  const owner = await register(app, `run-admin-${Date.now()}@example.com`)
  const adminRole = runtime.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'admin')).get()!
  const aiPermissions = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, 'ai:config:manage'))
    .all()
  const aiReadPermissions = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, 'ai:config:read'))
    .all()
  for (const permission of [...aiPermissions, ...aiReadPermissions]) {
    runtime.db
      .insert(rolePermissions)
      .values({
        roleId: adminRole.id,
        permissionId: permission.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .onConflictDoNothing()
      .run()
  }
  runtime.db.update(userRoles).set({ roleId: adminRole.id }).where(eq(userRoles.userId, owner.user.id)).run()
  return owner
}

async function seedAgentDefinition(
  runtime: ReturnType<typeof createTestApp>['runtime'],
  name: string,
): Promise<string> {
  const id = generateId()
  const now = new Date()
  await runtime.db
    .insert(aiAgentDefinitions)
    .values({
      id,
      name: `${name}-${now.getTime()}`,
      description: '',
      status: 'enabled',
      revision: 1,
      configJson: JSON.stringify({
        schemaVersion: 2,
        model: { providerId: model.provider, modelId: model.id },
        systemPromptId: null,
        skillIds: [],
        toolRefs: [],
        thinkingLevel: 'off',
        maxTurns: 8,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

it('required 输出缺失失败，optional 普通文本完成', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-output-mode-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const streamFn = () => streamResponse(assistantMessage([{ type: 'text', text: 'plain text' }], 'stop'), 'stop')
  const contracts = createAiOutputContractRegistry()
  const required = contracts.define({
    name: 'run.result',
    version: '1.0.0',
    description: 'Run result',
    schema: z.object({ result: z.string() }),
    renderKind: 'json',
    visibility: 'product',
    mode: 'required',
  })
  const optional = contracts.define({
    ...required,
    version: '2.0.0',
    mode: 'optional',
  })
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutorFactory: (testRuntime) =>
        createPiAgentExecutor({
          sessionStore: store,
          resolveModel: () => model,
          streamFn,
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(testRuntime.db),
        }),
      aiOutputContracts: contracts,
    },
  )
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'output-mode@example.com')
    const requiredAgent = await setupAgent(app, runtime, admin, 'required-output', 8, [], required)
    const requiredSession = await createSession(app, user.cookie, 'required')
    const requiredResponse = await startRun(app, user.cookie, requiredSession.sessionId, {
      agentId: requiredAgent.agentId,
      input: 'answer',
    })
    const requiredEvents = parseSseEvents(await readSse(requiredResponse))
    expect(requiredEvents.at(-1)).toMatchObject({
      type: 'run.failed',
      data: { error: { code: ApiErrorCodes.AI_AGENT_CONFIG_INVALID } },
    })

    const optionalAgent = await setupAgent(app, runtime, admin, 'optional-output', 8, [], optional)
    const optionalSession = await createSession(app, user.cookie, 'optional')
    const optionalResponse = await startRun(app, user.cookie, optionalSession.sessionId, {
      agentId: optionalAgent.agentId,
      input: 'answer',
    })
    expect(parseSseEvents(await readSse(optionalResponse)).at(-1)).toMatchObject({
      type: 'run.completed',
      data: { reason: 'model_finished' },
    })
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('结构化输出的数据库、Pi entry、事件和 Trace 关联一致，并按 visibility 投影', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-output-trace-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  let calls = 0
  const streamFn = () => {
    calls += 1
    return streamResponse(
      assistantMessage(
        [
          {
            type: 'toolCall',
            id: `structured-${calls}`,
            name: 'emit_structured_output',
            arguments: { result: 'approved' },
          },
        ],
        'toolUse',
      ),
      'toolUse',
    )
  }
  const contracts = createAiOutputContractRegistry()
  const product = contracts.define({
    name: 'visible.result',
    version: '1.0.0',
    description: 'Visible result',
    schema: z.object({ result: z.string() }),
    renderKind: 'decision',
    visibility: 'product',
    mode: 'optional',
  })
  const admin = contracts.define({
    ...product,
    version: '1.0.1',
    visibility: 'admin',
  })
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutorFactory: (testRuntime) =>
        createPiAgentExecutor({
          sessionStore: store,
          resolveModel: () => model,
          streamFn,
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(testRuntime.db),
        }),
      aiOutputContracts: contracts,
    },
  )
  try {
    const adminUser = await registerAdmin(app, runtime)
    const user = await register(app, 'output-trace@example.com')
    for (const [contract, label] of [
      [product, 'product'],
      [admin, 'admin'],
    ] as const) {
      const agent = await setupAgent(app, runtime, adminUser, `visible-${label}`, 8, [], contract)
      const session = await createSession(app, user.cookie, label)
      const response = await startRun(app, user.cookie, session.sessionId, {
        agentId: agent.agentId,
        input: 'emit',
      })
      const events = parseSseEvents(await readSse(response))
      const outputEvent = events.find((event) => event.type === 'structured_output.available')
      expect(outputEvent).toBeDefined()
      const runId = events[0]?.runId as string
      const output = runtime.db.select().from(aiStructuredOutputs).where(eq(aiStructuredOutputs.runId, runId)).get()
      expect(output).toMatchObject({
        contractName: contract.name,
        contractVersion: contract.version,
        schemaHash: contract.schemaHash,
        renderKind: contract.renderKind,
        valueJson: JSON.stringify({ result: 'approved' }),
      })
      expect(outputEvent).toMatchObject({
        data: {
          contract: contract.ref,
          value: contract.visibility === 'product' ? { result: 'approved' } : null,
          referenceId: output?.id,
        },
      })
      const entries = await store.findRunTerminalEntries({
        sessionId: session.sessionId,
        lane: 'main',
        runId,
      })
      expect(entries).toHaveLength(1)
      const transcript = await store.readTranscript({
        sessionId: session.sessionId,
        lane: 'main',
      })
      const toolResult = transcript.find((entry) => entry.type === 'message' && entry.message.role === 'toolResult')
      const toolResultDetails =
        toolResult && toolResult.type === 'message' && toolResult.message.role === 'toolResult'
          ? toolResult.message.details
          : null
      expect(toolResultDetails).toMatchObject({
        structuredOutputId: output?.id,
      })
      const trace = await app.request(`/api/ai/sessions/${session.sessionId}/runs/${runId}/trace`, {
        headers: { cookie: user.cookie },
      })
      const traceBody = await readSuccess<{
        nodes: Array<{ id: string; attributes: Record<string, string> }>
      }>(trace)
      expect(traceBody.data.nodes.find((node) => node.id === output?.stepId)?.attributes).toMatchObject({
        structuredOutputId: output?.id,
      })
    }
    expect(calls).toBe(2)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('非法结构化参数可在下一轮修正，旧 Run snapshot 固定 Contract ref', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-output-retry-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  let calls = 0
  const streamFn = () => {
    calls += 1
    const invalid = calls === 1
    return streamResponse(
      assistantMessage(
        [
          invalid
            ? {
                type: 'toolCall',
                id: 'bad',
                name: 'emit_structured_output',
                arguments: { result: 42 },
              }
            : {
                type: 'toolCall',
                id: 'good',
                name: 'emit_structured_output',
                arguments: { result: 'fixed' },
              },
        ],
        'toolUse',
      ),
      'toolUse',
    )
  }
  const contracts = createAiOutputContractRegistry()
  const contract = contracts.define({
    name: 'retry.result',
    version: '1.0.0',
    description: 'Retry result',
    schema: z.object({ result: z.string() }),
    renderKind: 'json',
    visibility: 'product',
    mode: 'optional',
  })
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutorFactory: (testRuntime) =>
        createPiAgentExecutor({
          sessionStore: store,
          resolveModel: () => model,
          streamFn,
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(testRuntime.db),
        }),
      aiOutputContracts: contracts,
    },
  )
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'output-retry@example.com')
    const agent = await setupAgent(app, runtime, admin, 'retry-output', 8, [], contract)
    const session = await createSession(app, user.cookie, 'retry')
    const response = await startRun(app, user.cookie, session.sessionId, {
      agentId: agent.agentId,
      input: 'fix',
    })
    const events = parseSseEvents(await readSse(response))
    const runId = events[0]?.runId as string
    expect(events.filter((event) => event.type === 'structured_output.available')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('run.completed')
    const replacement = contracts.define({
      ...contract,
      version: '2.0.0',
      mode: 'required',
    })
    expect(
      runtime.db.select().from(aiStructuredOutputs).where(eq(aiStructuredOutputs.runId, runId)).all(),
    ).toHaveLength(1)
    const detail = await getRun(app, user.cookie, session.sessionId, runId)
    const snapshot = (
      await readSuccess<{
        snapshot: {
          outputContract: {
            version: string
            schemaHash: string
            renderKind: string
            mode: string
          }
        }
      }>(detail)
    ).data.snapshot.outputContract
    expect(snapshot).toMatchObject({
      version: contract.version,
      schemaHash: contract.schemaHash,
      renderKind: contract.renderKind,
      mode: contract.mode,
    })
    expect(snapshot).not.toMatchObject({
      version: replacement.version,
      schemaHash: replacement.schemaHash,
    })
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('unknown Contract 和结构化输出持久化失败都有完整 failed Run 终态', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-output-failure-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const contracts = createAiOutputContractRegistry()
  let calls = 0
  const streamFn = () => {
    calls += 1
    return streamResponse(
      assistantMessage(
        [
          {
            type: 'toolCall',
            id: `storage-${calls}`,
            name: 'emit_structured_output',
            arguments: { result: 'x' },
          },
        ],
        'toolUse',
      ),
      'toolUse',
    )
  }
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutorFactory: (testRuntime) =>
        createPiAgentExecutor({
          sessionStore: store,
          resolveModel: () => model,
          streamFn,
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(testRuntime.db),
        }),
      aiOutputContracts: contracts,
    },
  )
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'output-unknown@example.com')
    const unknown = {
      name: 'missing.result',
      version: '1.0.0',
      schemaHash: '0'.repeat(64),
      renderKind: 'json',
      visibility: 'product',
      mode: 'optional',
    }
    const prompt = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
      name: 'unknown-prompt',
      content: '事实',
    })
    const promptId = (await readSuccess<{ id: string }>(prompt)).data.id
    const modelRef = seedModel(runtime)
    const created = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
      name: 'unknown-output',
      config: {
        schemaVersion: 2,
        model: modelRef,
        systemPromptId: promptId,
        skillIds: [],
        toolRefs: [],
        thinkingLevel: 'off',
        maxTurns: 8,
        outputContract: unknown,
      },
    })
    expect(created.status).toBe(400)
    expect((await readFailure(created)).error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)

    const contract = contracts.define({
      name: 'storage.result',
      version: '1.0.0',
      description: 'Storage result',
      schema: z.object({ result: z.string() }),
      renderKind: 'json',
      visibility: 'product',
      mode: 'optional',
    })
    const agent = await setupAgent(app, runtime, admin, 'storage-output', 8, [], contract)
    const session = await createSession(app, user.cookie, 'storage')
    runtime.database.sqlite.exec('DROP TABLE ai_structured_outputs')
    const response = await startRun(app, user.cookie, session.sessionId, {
      agentId: agent.agentId,
      input: 'emit',
    })
    const events = parseSseEvents(await readSse(response))
    expect(events.at(-1)).toMatchObject({
      type: 'run.failed',
      data: { error: { code: ApiErrorCodes.AI_SESSION_STORAGE_FAILED } },
    })
    expect(events.find((event) => event.type === 'structured_output.available')).toBeUndefined()
    expect(calls).toBe(1)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

function seedModel(runtime: ReturnType<typeof createTestApp>['runtime']): {
  providerId: string
  modelId: string
} {
  const modelRef = runtime.ai.listModels('openai')[0]
  if (!modelRef) throw new Error('测试模型目录为空')
  const now = new Date()
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: modelRef.providerId,
      enabled: true,
      configRevision: 0,
      checkedConfigRevision: 0,
      authStatus: 'ready',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run()
  runtime.db
    .insert(aiEnabledModels)
    .values({
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
      enabledAt: now,
    })
    .onConflictDoNothing()
    .run()
  return { providerId: modelRef.providerId, modelId: modelRef.modelId }
}

async function postJson(
  app: ReturnType<typeof createTestApp>['app'],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function patchJson(
  app: ReturnType<typeof createTestApp>['app'],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 内联配置启动的基本测试环境：真实 executor + 固定回复流 + 用量审计。 */
async function setupInlineApp() {
  const directory = await mkdtemp(join(tmpdir(), 'starter-run-inline-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const streamFn = () => streamResponse(assistantMessage([{ type: 'text', text: 'inline reply' }], 'stop'), 'stop')
  // 审计注入依赖 models 选项（createInstrumentedModels），只传 streamFn 不落审计。
  // getModel 按 ref 构造同 provider/id 的模型对象，审计记录内联配置实际值，
  // 与真实运行时 models.getModel(providerId, modelId) 的解析行为一致。
  const models = {
    getModel: (providerId: string, modelId: string) => ({
      ...model,
      provider: providerId,
      id: modelId,
    }),
    getAuth: async () => ({ auth: { apiKey: 'test' }, source: 'test' }),
    streamSimple: streamFn,
  } as unknown as Models
  const test = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutorFactory: (runtime) => {
        const usage = createAiUsageAuditService(createAiUsageAuditRepository(runtime.db), runtime.logger)
        return createPiAgentExecutor({
          sessionStore: store,
          models,
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(runtime.db),
          audit: usage.createAgentModelCallAudit(),
          toolAudit: usage.createAgentToolExecutionAudit(),
        })
      },
    },
  )
  return { directory, store, ...test }
}

it('内联配置启动 Run：事件流与预设 Agent 同构，快照 v3 且 agentId 为空', async () => {
  const { directory, store, app, cleanup, runtime } = await setupInlineApp()
  try {
    const user = await register(app, 'run-inline@example.com')
    const modelRef = seedModel(runtime)
    const { sessionId } = await createSession(app, user.cookie, '内联 Run')

    const started = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      config: {
        model: modelRef,
        systemPrompt: '你是内联配置的助手。',
        maxTurns: 4,
      },
    })
    expect(started.status).toBe(200)
    const body = await readSse(started)
    const events = parseSseEvents(body)
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'turn.started',
      'step.started',
      'model_call.started',
      'message.started',
      'model_call.first_output',
      'model_call.completed',
      'message.delta',
      'message.completed',
      'step.completed',
      'turn.completed',
      'run.completed',
    ])
    // run.started 的 agent 字段对内联 Run 为空，模型是内联配置实际值
    expect(events[0]?.data).toMatchObject({
      agentId: null,
      agentRevision: null,
      model: modelRef,
    })
    expect(events.at(-1)?.data).toMatchObject({ reason: 'model_finished' })

    const runId = events[0]?.runId as string
    expect(runId).toBeTruthy()
    const detail = await getRun(app, user.cookie, sessionId, runId)
    expect(detail.status).toBe(200)
    const detailBody = await readSuccess<{
      agentId: string | null
      agentRevision: number | null
      status: string
      snapshot: {
        schemaVersion: number
        agentId: string | null
        agentRevision: number | null
        systemPromptId: string | null
        maxTurns: number
        model: { providerId: string; modelId: string }
      }
    }>(detail)
    expect(detailBody.data).toMatchObject({
      agentId: null,
      agentRevision: null,
      status: 'completed',
      snapshot: {
        schemaVersion: 3,
        agentId: null,
        agentRevision: null,
        systemPromptId: null,
        maxTurns: 4,
        model: modelRef,
      },
    })

    // 主库 Run 行 agentId 为 NULL；模型审计照常落库且是内联配置的实际模型
    const row = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
    expect(row?.agentId).toBeNull()
    expect(row?.agentRevision).toBeNull()
    expect(row?.status).toBe('completed')
    // 审计 finalize 是 best-effort，终态后短暂轮询等待落库
    let call: typeof aiModelCalls.$inferSelect | undefined
    for (let attempt = 0; attempt < 50 && !call; attempt += 1) {
      call = runtime.db.select().from(aiModelCalls).where(eq(aiModelCalls.runId, runId)).get()
      if (!call) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(call?.scenario).toBe('agent_run')
    expect(call?.providerId).toBe(modelRef.providerId)
    expect(call?.modelId).toBe(modelRef.modelId)

    // Pi 侧 terminal entry 写入且 agentId 为空
    const entries = await store.findRunTerminalEntries({
      sessionId,
      lane: 'main',
      runId,
    })
    expect(entries).toHaveLength(1)
    expect(starterRunDataSchema.safeParse(entries[0]?.data).success).toBe(true)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('agentId 与 config 同传 400；都缺时回落 defaultAgentId，无默认 400', async () => {
  const { directory, app, cleanup, runtime } = await setupInlineApp()
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-fallback@example.com')
    const { agentId } = await setupAgent(app, runtime, admin, 'fallback-agent')
    const modelRef = seedModel(runtime)
    const { sessionId } = await createSession(app, user.cookie, '回落')

    // 两者都不传且没有默认 Agent
    const missing = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
    })
    expect(missing.status).toBe(400)
    expect((await readFailure(missing)).error.code).toBe(ApiErrorCodes.COMMON_INVALID_REQUEST)

    // agentId 与 config 同传在 schema 层拒绝
    const both = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      agentId,
      config: { model: modelRef, systemPrompt: '内联' },
    })
    expect(both.status).toBe(400)
    expect((await readFailure(both)).error.code).toBe(ApiErrorCodes.COMMON_INVALID_REQUEST)

    // 设置 defaultAgentId 后，都不传的启动回落到默认 Agent
    const patched = await patchJson(app, `/api/ai/sessions/${sessionId}`, user.cookie, { defaultAgentId: agentId })
    expect(patched.status).toBe(200)
    const fallback = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
    })
    expect(fallback.status).toBe(200)
    const events = parseSseEvents(await readSse(fallback))
    expect(events[0]?.data).toMatchObject({ agentId })
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('内联配置校验失败：模型不在 allowlist 403，未注册工具与停用技能 400', async () => {
  const { directory, app, cleanup, runtime } = await setupInlineApp()
  try {
    const user = await register(app, 'run-invalid@example.com')
    const modelRef = seedModel(runtime)
    const { sessionId } = await createSession(app, user.cookie, '校验失败')

    // 模型不在 ai_enabled_models 且 Provider 目录中不存在
    const disallowed = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      config: {
        model: { providerId: modelRef.providerId, modelId: 'not-in-catalog' },
        systemPrompt: '内联',
      },
    })
    expect(disallowed.status).toBe(403)
    expect((await readFailure(disallowed)).error.code).toBe(ApiErrorCodes.AI_MODEL_NOT_ALLOWED)

    // 未注册的工具 ref
    const unknownTool = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      config: {
        model: modelRef,
        systemPrompt: '内联',
        toolRefs: [{ name: 'missing-tool', version: '1.0.0' }],
      },
    })
    expect(unknownTool.status).toBe(400)
    expect((await readFailure(unknownTool)).error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)

    // 停用的技能
    const skillId = generateId()
    const now = new Date()
    runtime.db
      .insert(aiSkills)
      .values({
        id: skillId,
        name: `disabled-skill-${skillId}`,
        description: '已停用',
        content: '内容',
        enabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const disabledSkill = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      config: {
        model: modelRef,
        systemPrompt: '内联',
        skillIds: [skillId],
      },
    })
    expect(disabledSkill.status).toBe(400)
    expect((await readFailure(disabledSkill)).error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)

    // 校验失败不创建 Run 行
    expect(
      runtime.db
        .select()
        .from(aiAgentRuns)
        .all()
        .filter((row) => row.sessionId === sessionId),
    ).toHaveLength(0)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('内联配置 systemPrompt 与 systemPromptId 必须二选一', async () => {
  const { directory, app, cleanup, runtime } = await setupInlineApp()
  try {
    const user = await register(app, 'run-prompt-pair@example.com')
    const modelRef = seedModel(runtime)
    const { sessionId } = await createSession(app, user.cookie, '二选一')

    // 双空：既没有内联文本也没有引用
    const empty = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      config: { model: modelRef },
    })
    expect(empty.status).toBe(400)

    // 双传
    const promptId = generateId()
    const both = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      config: {
        model: modelRef,
        systemPrompt: '内联',
        systemPromptId: promptId,
      },
    })
    expect(both.status).toBe(400)
    expect((await readFailure(both)).error.code).toBe(ApiErrorCodes.COMMON_INVALID_REQUEST)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('内联配置引用 systemPromptId 时正常启动并写入快照', async () => {
  const { directory, app, cleanup, runtime } = await setupInlineApp()
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'run-prompt-ref@example.com')
    const modelRef = seedModel(runtime)
    const prompt = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
      name: 'inline-ref-prompt',
      content: '引用式系统提示词。',
    })
    const promptBody = await readSuccess<{ id: string }>(prompt)
    const { sessionId } = await createSession(app, user.cookie, '引用提示词')

    const started = await startRun(app, user.cookie, sessionId, {
      input: 'hello',
      config: {
        model: modelRef,
        systemPromptId: promptBody.data.id,
      },
    })
    expect(started.status).toBe(200)
    const events = parseSseEvents(await readSse(started))
    expect(events.at(-1)?.type).toBe('run.completed')
    const runId = events[0]?.runId as string
    const detail = await getRun(app, user.cookie, sessionId, runId)
    const detailBody = await readSuccess<{
      snapshot: { systemPromptId: string | null; schemaVersion: number }
    }>(detail)
    expect(detailBody.data.snapshot.systemPromptId).toBe(promptBody.data.id)
    expect(detailBody.data.snapshot.schemaVersion).toBe(3)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})
