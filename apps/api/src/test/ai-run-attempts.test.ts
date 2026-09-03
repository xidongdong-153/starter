import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Api, Model, Models } from '@earendil-works/pi-ai'
import { ApiErrorCodes } from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createPiToolAdapter, toolIdempotencyToken } from '@api/infra/agent/pi-tool-adapter.js'
import { createRunExecutionContext } from '@api/infra/agent/run-execution-context.js'
import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import {
  aiAgentLaneLeases,
  aiAgentRuns,
  aiRunAttempts,
  aiRunSteps,
  aiRunTurns,
  aiToolExecutions,
} from '@api/infra/db/schema/index.js'
import { starterRuntimeAccess } from '@api/modules/ai/principal.js'
import { createAiToolRegistry, defineAiTool } from '@api/modules/ai/tool/tool-registry.js'

import {
  assistantMessage,
  createSessionId,
  parseSseEvents,
  readSseBody,
  runTestApp,
  seedAgent,
  seedEnabledModel,
  streamAssistant,
  streamModel,
  streamProviderError,
  type RunSseEvent,
} from './ai-run-harness.js'
import { readSuccess, register } from './helpers.js'

type Runtime = ReturnType<typeof runTestApp>['runtime']

/** SSE 事件顶层的新增字段；缺省时视为 attempt 1。 */
interface AttemptRunSseEvent extends RunSseEvent {
  attemptNo?: number
}

/** 按模型调用次数依次返回不同结果；超出队列长度直接抛错，暴露意外重试。 */
function streamQueue(
  factories: Array<() => ReturnType<typeof createAssistantMessageEventStream>>,
): Models['streamSimple'] {
  let calls = 0
  return ((_model: Model<Api>, _context: unknown, _options: unknown) => {
    const factory = factories[calls]
    calls += 1
    if (!factory) throw new Error(`模型调用超出预期次数: ${calls}`)
    return factory()
  }) as unknown as Models['streamSimple']
}

function providerErrorFactory() {
  return () => streamProviderError()
}

function textFactory(text: string) {
  return () => streamAssistant(assistantMessage([{ type: 'text', text }], 'stop'), 'stop')
}

/** 挂住的模型流：release 前保持 pending，abort signal 或 release 后收尾。 */
function gatedStream() {
  let released = false
  const pending: Array<() => void> = []
  const factory = () => {
    const stream = createAssistantMessageEventStream()
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      stream.push({
        type: 'done',
        reason: 'stop',
        message: assistantMessage([{ type: 'text', text: 'late' }], 'stop'),
      })
    }
    if (released) finish()
    else pending.push(finish)
    return stream
  }
  return {
    factory,
    release() {
      released = true
      for (const finish of pending.splice(0)) finish()
    },
  }
}

/** 非幂等写 Tool：只进 manifest 副作用判定，不真正执行。 */
function nonIdempotentWriteTools() {
  return createAiToolRegistry([
    defineAiTool({
      sideEffect: 'non_idempotent_write',
      name: 'charge_card',
      version: '1.0.0',
      description: 'Charge a card once',
      inputSchema: z.object({ amount: z.number() }),
      timeoutMs: 1000,
      scope: 'platform',
      requiredPermission: null,
      async execute() {
        return { modelText: 'charged', safeSummary: null }
      },
    }),
  ])
}

async function withAttemptsApp(
  input: {
    streamSimple: Models['streamSimple']
    tools?: ReturnType<typeof createAiToolRegistry>
    toolRefs?: Array<{ name: string; version: string }>
    retryPolicy?: { maxAttempts: number }
    email: string
    prefix: string
  },
  run: (context: {
    app: ReturnType<typeof runTestApp>['app']
    runtime: Runtime
    user: { cookie: string }
    agentId: string
    sessionId: string
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), `starter-${input.prefix}-`))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const { app, cleanup, runtime } = runTestApp({
    store,
    streamSimple: input.streamSimple,
    tools: input.tools ?? createAiToolRegistry([]),
  })
  try {
    const user = await register(app, input.email)
    seedEnabledModel(runtime)
    const agentId = seedAgent(runtime, input.toolRefs ?? [], {
      ...(input.retryPolicy ? { retryPolicy: input.retryPolicy } : {}),
    })
    const sessionId = await createSessionId(app, user.cookie)
    await run({ app, runtime, user, agentId, sessionId })
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
}

async function startRunRequest(
  app: ReturnType<typeof runTestApp>['app'],
  cookie: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 跑完一个 Run 并读全量 SSE 事件。 */
async function runToCompletion(
  app: ReturnType<typeof runTestApp>['app'],
  cookie: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<{ runId: string; events: AttemptRunSseEvent[] }> {
  const response = await startRunRequest(app, cookie, sessionId, body)
  if (response.status !== 200) {
    throw new Error(`Run 启动失败: ${response.status} ${await response.text()}`)
  }
  const events = parseSseEvents(await readSseBody(response)) as AttemptRunSseEvent[]
  const runId = events[0]?.runId ?? ''
  expect(runId).toBeTruthy()
  return { runId, events }
}

function terminalEvents(events: AttemptRunSseEvent[]): AttemptRunSseEvent[] {
  return events.filter((event) => ['run.completed', 'run.failed', 'run.aborted'].includes(event.type))
}

function attemptRows(runtime: Runtime, runId: string) {
  return runtime.db.select().from(aiRunAttempts).where(eq(aiRunAttempts.runId, runId)).all()
}

function agentStepRows(runtime: Runtime, runId: string) {
  return runtime.db
    .select()
    .from(aiRunSteps)
    .where(eq(aiRunSteps.runId, runId))
    .all()
    .filter((row) => row.kind === 'agent')
}

it('invocation 重放返回同一 logical Run，不创建新 Run 或新 Attempt', async () => {
  await withAttemptsApp(
    {
      prefix: 'attempt-replay',
      email: 'attempt-replay@example.com',
      streamSimple: textFactory('first answer') as unknown as Models['streamSimple'],
    },
    async ({ app, runtime, user, agentId, sessionId }) => {
      const first = await runToCompletion(app, user.cookie, sessionId, {
        agentId,
        input: 'hello',
        idempotencyKey: 'replay-key-1',
      })
      const second = await runToCompletion(app, user.cookie, sessionId, {
        agentId,
        input: 'hello',
        idempotencyKey: 'replay-key-1',
      })

      // 同 key 重放：同一 logical Run，事件从头回放
      expect(second.runId).toBe(first.runId)
      expect(second.events.map((event) => event.type)).toContain('run.completed')

      const runs = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).all()
      expect(runs).toHaveLength(1)
      expect(attemptRows(runtime, first.runId)).toHaveLength(1)
      expect(agentStepRows(runtime, first.runId)).toHaveLength(1)
    },
  )
})

it('模型失败且 maxAttempts=2 时创建 Attempt 2：事件 attemptNo 变化、单一 terminal、终态全部落库', async () => {
  await withAttemptsApp(
    {
      prefix: 'attempt-retry-success',
      email: 'attempt-retry-success@example.com',
      streamSimple: streamQueue([providerErrorFactory(), textFactory('recovered answer')]),
      retryPolicy: { maxAttempts: 2 },
    },
    async ({ app, runtime, user, agentId, sessionId }) => {
      const { runId, events } = await runToCompletion(app, user.cookie, sessionId, {
        agentId,
        input: 'retry me',
      })

      // 单一 terminal 事件，Run 完成
      const terminals = terminalEvents(events)
      expect(terminals).toHaveLength(1)
      expect(terminals[0]?.type).toBe('run.completed')
      expect(terminals[0]?.attemptNo).toBe(2)

      // 事件 attemptNo 随执行尝试切换：Attempt 1 的失败与 Attempt 2 的成功各归各
      expect(events.find((event) => event.type === 'run.started')?.attemptNo).toBe(1)
      expect(events.find((event) => event.type === 'model_call.failed')?.attemptNo).toBe(1)
      expect(events.find((event) => event.type === 'model_call.completed')?.attemptNo).toBe(2)
      const turnStartedAttempts = events
        .filter((event) => event.type === 'turn.started')
        .map((event) => event.attemptNo)
      expect(turnStartedAttempts).toEqual([1, 2])

      // Run 行：completed，current_attempt_no 指向 2
      const run = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
      expect(run?.status).toBe('completed')
      expect(run?.currentAttemptNo).toBe(2)

      // 两条 Attempt 行：Attempt 1 failed（记录错误码），Attempt 2 auto_retry + succeeded
      const attempts = attemptRows(runtime, runId)
      expect(attempts).toHaveLength(2)
      expect(attempts[0]).toMatchObject({
        attemptNo: 1,
        trigger: 'initial',
        status: 'failed',
        errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
        retryReason: null,
      })
      expect(attempts[0]?.finishedAt).not.toBeNull()
      expect(attempts[1]).toMatchObject({
        attemptNo: 2,
        trigger: 'auto_retry',
        status: 'succeeded',
        retryReason: ApiErrorCodes.AI_UPSTREAM_ERROR,
        errorCode: null,
      })

      // 每个 Attempt 一条顶层 agent Step，outcome 与 Attempt 终态一致
      const agentSteps = agentStepRows(runtime, runId)
      expect(agentSteps).toHaveLength(2)
      expect(agentSteps[0]).toMatchObject({
        attemptNo: 1,
        turnId: null,
        outcome: 'failed',
        errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      })
      expect(agentSteps[1]).toMatchObject({ attemptNo: 2, turnId: null, outcome: 'succeeded' })

      // turn 与 turn 内 Step 的 attempt_no 归属正确
      const turns = runtime.db.select().from(aiRunTurns).where(eq(aiRunTurns.runId, runId)).all()
      expect(turns.map((turn) => turn.attemptNo)).toEqual([1, 2])
      const turnScopedSteps = runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all()
        .filter((row) => row.kind === 'assistant')
      expect(turnScopedSteps.map((step) => step.attemptNo)).toEqual([1, 2])
      expect(turnScopedSteps.map((step) => step.outcome)).toEqual(['failed', 'succeeded'])
    },
  )
})

it('用户 abort 不创建新 Attempt', async () => {
  const gate = gatedStream()
  await withAttemptsApp(
    {
      prefix: 'attempt-abort',
      email: 'attempt-abort@example.com',
      streamSimple: streamQueue([gate.factory]) as unknown as Models['streamSimple'],
      retryPolicy: { maxAttempts: 2 },
    },
    async ({ app, runtime, user, agentId, sessionId }) => {
      const started = startRunRequest(app, user.cookie, sessionId, { agentId, input: 'hold' })
      await vi.waitFor(() => {
        expect(runtime.activeRunRegistry.getBySessionLane(sessionId, 'main')).toBeDefined()
      })
      const runId = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).get()?.id
      expect(runId).toBeTruthy()

      const aborted = await app.request(`/api/ai/sessions/${sessionId}/runs/${runId}/abort`, {
        method: 'POST',
        headers: { cookie: user.cookie },
      })
      expect(aborted.status).toBe(200)
      gate.release()

      const events = parseSseEvents(await readSseBody(await started)) as AttemptRunSseEvent[]
      const terminals = terminalEvents(events)
      expect(terminals).toHaveLength(1)
      expect(terminals[0]?.type).toBe('run.aborted')

      // abort 是不可重试错误：只有 Attempt 1，落 aborted
      const attempts = attemptRows(runtime, runId ?? '')
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ attemptNo: 1, trigger: 'initial', status: 'aborted' })
      const agentSteps = agentStepRows(runtime, runId ?? '')
      expect(agentSteps).toHaveLength(1)
      expect(agentSteps[0]).toMatchObject({ attemptNo: 1, outcome: 'aborted' })
      const run = runtime.db
        .select()
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.id, runId ?? ''))
        .get()
      expect(run?.status).toBe('aborted')
      expect(run?.currentAttemptNo).toBe(1)
    },
  )
})

it('manifest 含 non_idempotent_write Tool 时模型失败不自动重试', async () => {
  await withAttemptsApp(
    {
      prefix: 'attempt-side-effect-gate',
      email: 'attempt-side-effect-gate@example.com',
      streamSimple: streamQueue([providerErrorFactory(), textFactory('must not run')]),
      tools: nonIdempotentWriteTools(),
      toolRefs: [{ name: 'charge_card', version: '1.0.0' }],
      retryPolicy: { maxAttempts: 2 },
    },
    async ({ app, runtime, user, agentId, sessionId }) => {
      const { runId, events } = await runToCompletion(app, user.cookie, sessionId, {
        agentId,
        input: 'charge it',
      })

      // Attempt 1 即终态：副作用门禁禁用 auto retry
      const terminals = terminalEvents(events)
      expect(terminals).toHaveLength(1)
      expect(terminals[0]?.type).toBe('run.failed')
      expect((terminals[0]?.data.error as { code?: string })?.code).toBe(ApiErrorCodes.AI_UPSTREAM_ERROR)

      const attempts = attemptRows(runtime, runId)
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({
        attemptNo: 1,
        trigger: 'initial',
        status: 'failed',
        errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      })
      const agentSteps = agentStepRows(runtime, runId)
      expect(agentSteps).toHaveLength(1)
      expect(agentSteps[0]).toMatchObject({ attemptNo: 1, outcome: 'failed' })
      const run = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
      expect(run?.status).toBe('failed')
      expect(run?.currentAttemptNo).toBe(1)
    },
  )
})

it('内联 config 的重试上限耗尽：全部 Attempt 落 failed，Run 终态 failed', async () => {
  await withAttemptsApp(
    {
      prefix: 'attempt-exhausted',
      email: 'attempt-exhausted@example.com',
      streamSimple: streamQueue([providerErrorFactory(), providerErrorFactory(), providerErrorFactory()]),
    },
    async ({ app, runtime, user, sessionId }) => {
      const { runId, events } = await runToCompletion(app, user.cookie, sessionId, {
        config: {
          model: { providerId: streamModel.provider, modelId: streamModel.id },
          systemPrompt: 'inline prompt',
          retryPolicy: { maxAttempts: 3 },
        },
        input: 'keep failing',
      })

      const terminals = terminalEvents(events)
      expect(terminals).toHaveLength(1)
      expect(terminals[0]?.type).toBe('run.failed')
      expect(terminals[0]?.attemptNo).toBe(3)
      const turnStartedAttempts = events
        .filter((event) => event.type === 'turn.started')
        .map((event) => event.attemptNo)
      expect(turnStartedAttempts).toEqual([1, 2, 3])

      const run = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
      expect(run?.status).toBe('failed')
      expect(run?.errorCode).toBe(ApiErrorCodes.AI_UPSTREAM_ERROR)
      expect(run?.currentAttemptNo).toBe(3)

      const attempts = attemptRows(runtime, runId)
      expect(attempts).toHaveLength(3)
      expect(attempts.map((attempt) => attempt.trigger)).toEqual(['initial', 'auto_retry', 'auto_retry'])
      expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'failed', 'failed'])
      expect(attempts.map((attempt) => attempt.errorCode)).toEqual([
        ApiErrorCodes.AI_UPSTREAM_ERROR,
        ApiErrorCodes.AI_UPSTREAM_ERROR,
        ApiErrorCodes.AI_UPSTREAM_ERROR,
      ])
      expect(attempts.map((attempt) => attempt.retryReason)).toEqual([
        null,
        ApiErrorCodes.AI_UPSTREAM_ERROR,
        ApiErrorCodes.AI_UPSTREAM_ERROR,
      ])
      expect(attempts.every((attempt) => attempt.finishedAt !== null)).toBe(true)

      const agentSteps = agentStepRows(runtime, runId)
      expect(agentSteps).toHaveLength(3)
      expect(agentSteps.map((step) => step.attemptNo)).toEqual([1, 2, 3])
      expect(agentSteps.every((step) => step.outcome === 'failed')).toBe(true)
    },
  )
})

it('重试期间 lease 被接管：旧 owner 的 Attempt 2 终态提交落 interrupted', async () => {
  const gate = gatedStream()
  await withAttemptsApp(
    {
      prefix: 'attempt-fenced',
      email: 'attempt-fenced@example.com',
      streamSimple: streamQueue([providerErrorFactory(), gate.factory]),
      retryPolicy: { maxAttempts: 2 },
    },
    async ({ app, runtime, user, agentId, sessionId }) => {
      const started = startRunRequest(app, user.cookie, sessionId, { agentId, input: 'fence me' })
      // Attempt 2 创建并开始执行（模型流被 gate 挂住）
      await vi.waitFor(() => {
        const rows = runtime.db.select().from(aiRunAttempts).all()
        expect(rows.filter((row) => row.attemptNo === 2 && row.status === 'running')).toHaveLength(1)
      })
      const runId = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).get()?.id
      expect(runId).toBeTruthy()

      // 模拟接管：lease 行换 owner，fencing token 递增
      const leaseRow = runtime.db
        .select()
        .from(aiAgentLaneLeases)
        .where(eq(aiAgentLaneLeases.sessionId, sessionId))
        .get()
      if (!leaseRow) throw new Error('lease 行不存在')
      runtime.db
        .update(aiAgentLaneLeases)
        .set({ ownerId: 'instance-b', fencingToken: leaseRow.fencingToken + 1 })
        .where(eq(aiAgentLaneLeases.sessionId, sessionId))
        .run()

      gate.release()
      const events = parseSseEvents(await readSseBody(await started)) as AttemptRunSseEvent[]
      const terminals = terminalEvents(events)
      expect(terminals).toHaveLength(1)
      expect(terminals[0]?.type).toBe('run.failed')
      expect((terminals[0]?.data.error as { code?: string })?.code).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)
      expect(terminals[0]?.attemptNo).toBe(2)

      // Run 落 interrupted，实际执行结果被丢弃
      const run = runtime.db
        .select()
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.id, runId ?? ''))
        .get()
      expect(run?.status).toBe('interrupted')
      expect(run?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)
      expect(run?.currentAttemptNo).toBe(2)

      // Attempt 1 是重试前已落库的 failed；Attempt 2 被 fencing 改写为 interrupted
      const attempts = attemptRows(runtime, runId ?? '')
      expect(attempts).toHaveLength(2)
      expect(attempts[0]).toMatchObject({ attemptNo: 1, status: 'failed' })
      expect(attempts[1]).toMatchObject({
        attemptNo: 2,
        status: 'interrupted',
        errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
      })

      // 两条 agent Step 与 Attempt 终态一致
      const agentSteps = agentStepRows(runtime, runId ?? '')
      expect(agentSteps).toHaveLength(2)
      expect(agentSteps[0]).toMatchObject({ attemptNo: 1, outcome: 'failed' })
      expect(agentSteps[1]).toMatchObject({
        attemptNo: 2,
        outcome: 'interrupted',
        errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
      })
    },
  )
})

it('tool 审计行持久 idempotencyToken，runTrace 返回 attempts 列表', async () => {
  let capturedToken: string | undefined
  await withAttemptsApp(
    {
      prefix: 'attempt-tool-token',
      email: 'attempt-tool-token@example.com',
      streamSimple: ((_model: Model<Api>, context: { messages: Array<{ role: string }> }, _options: unknown) => {
        const last = context.messages.at(-1)
        if (last?.role === 'toolResult') {
          return streamAssistant(assistantMessage([{ type: 'text', text: 'done' }], 'stop'), 'stop')
        }
        return streamAssistant(
          assistantMessage(
            [
              {
                type: 'toolCall',
                id: 'tool-call-token-1',
                name: 'lookup',
                arguments: { value: 'x' },
              },
            ],
            'toolUse',
          ),
          'toolUse',
        )
      }) as unknown as Models['streamSimple'],
      tools: createAiToolRegistry([
        defineAiTool({
          sideEffect: 'read_only',
          name: 'lookup',
          version: '1.0.0',
          description: 'Look up a value',
          inputSchema: z.object({ value: z.string() }),
          timeoutMs: 1000,
          scope: 'platform',
          requiredPermission: null,
          async execute(context) {
            capturedToken = context.idempotencyToken
            return { modelText: 'SECRET-TOOL-RESULT', safeSummary: 'looked up' }
          },
        }),
      ]),
      toolRefs: [{ name: 'lookup', version: '1.0.0' }],
    },
    async ({ app, runtime, user, agentId, sessionId }) => {
      const { runId } = await runToCompletion(app, user.cookie, sessionId, {
        agentId,
        input: 'lookup then answer',
      })

      // 审计行带稳定幂等 token：sha256(canonicalJson({runId, attemptNo, toolExecutionId}))
      const toolRows = runtime.db.select().from(aiToolExecutions).where(eq(aiToolExecutions.runId, runId)).all()
      expect(toolRows).toHaveLength(1)
      const toolRow = toolRows[0]
      if (!toolRow) throw new Error('缺少 Tool 执行记录')
      expect(toolRow.idempotencyToken).toBeTruthy()
      expect(toolRow.idempotencyToken).toBe(toolIdempotencyToken({ runId, attemptNo: 1, toolExecutionId: toolRow.id }))
      // handler 经执行上下文拿到同一 token
      expect(capturedToken).toBe(toolRow.idempotencyToken)

      // runTrace 暴露 attempts 列表
      const traceResponse = await app.request(`/api/ai/sessions/${sessionId}/runs/${runId}/trace`, {
        headers: { cookie: user.cookie },
      })
      expect(traceResponse.status).toBe(200)
      const trace = await readSuccess<{ attempts: Array<Record<string, unknown>> }>(traceResponse)
      expect(trace.data.attempts).toHaveLength(1)
      expect(trace.data.attempts[0]).toMatchObject({
        attemptNo: 1,
        trigger: 'initial',
        status: 'succeeded',
        errorCode: null,
      })
      expect(typeof trace.data.attempts[0]?.startedAt).toBe('string')
      expect(typeof trace.data.attempts[0]?.finishedAt).toBe('string')
    },
  )
})

it('toolIdempotencyToken 是纯函数：相同输入重算相同，attempt 序号参与计算', () => {
  const input = {
    runId: '018f6e1a-3d1f-7b2c-9e4d-1a2b3c4d5e6f',
    attemptNo: 1,
    toolExecutionId: '018f6e1a-5555-7b2c-9e4d-1a2b3c4d5e6f',
  }
  const first = toolIdempotencyToken(input)
  const second = toolIdempotencyToken({ ...input })
  // SHA-256 hex：64 个十六进制字符
  expect(first).toMatch(/^[0-9a-f]{64}$/)
  expect(second).toBe(first)
  // 不同输入产生不同 token
  expect(toolIdempotencyToken({ ...input, attemptNo: 2 })).not.toBe(first)
  expect(toolIdempotencyToken({ ...input, toolExecutionId: '018f6e1a-6666-7b2c-9e4d-1a2b3c4d5e6f' })).not.toBe(first)
})

it('tool 超时 modelText 按副作用声明分类措辞', async () => {
  const slowReadOnlyTool = defineAiTool({
    sideEffect: 'read_only',
    name: 'slow_lookup',
    version: '1.0.0',
    description: 'Times out',
    inputSchema: z.object({}),
    timeoutMs: 100,
    scope: 'platform',
    requiredPermission: null,
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return { modelText: 'late', safeSummary: null }
    },
  })
  const slowWriteTool = defineAiTool({
    sideEffect: 'non_idempotent_write',
    name: 'slow_charge',
    version: '1.0.0',
    description: 'Times out after a write',
    inputSchema: z.object({}),
    timeoutMs: 100,
    scope: 'platform',
    requiredPermission: null,
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return { modelText: 'late', safeSummary: null }
    },
  })
  const access = starterRuntimeAccess('tool-timeout-user')
  const execution = createRunExecutionContext({
    runId: '018f6e1a-7777-7b2c-9e4d-1a2b3c4d5e6f',
    sessionId: '018f6e1a-8888-7b2c-9e4d-1a2b3c4d5e6f',
    lane: 'main',
    requestId: 'request-tool-timeout',
    principal: access.principal,
    scope: access.scope,
    agentId: null,
    agentRevision: null,
  })
  const adapter = createPiToolAdapter([slowReadOnlyTool, slowWriteTool], {
    execution,
    hasPermission: async () => true,
  })

  const readOnly = adapter.tools.find((tool) => tool.name === 'slow_lookup')
  if (!readOnly) throw new Error('缺少 read_only Tool')
  // 超时走 reject 路径，错误 message 就是给模型的 modelText
  const readOnlyError = await readOnly.execute('timeout-call-read', {}, undefined).then(
    () => null,
    (error: Error) => error,
  )
  // read_only 超时不声明外部状态未知
  expect(readOnlyError?.message).toBe('The tool timed out after 100ms.')

  const write = adapter.tools.find((tool) => tool.name === 'slow_charge')
  if (!write) throw new Error('缺少 non_idempotent_write Tool')
  const writeError = await write.execute('timeout-call-write', {}, undefined).then(
    () => null,
    (error: Error) => error,
  )
  // 非幂等写超时声明外部状态未知
  expect(writeError?.message).toBe(
    'The tool timed out after 100ms. The operation may have already been applied externally; the result is unknown.',
  )
})
