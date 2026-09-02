import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Logger } from 'pino'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { ApiErrorCodes } from '@starter/contracts'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'

import { createActiveRunRegistry, createPiAgentExecutor } from '@api/infra/agent/index.js'
import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import { createDatabase, type AppDatabase } from '@api/infra/db/client.js'
import { aiAgentLaneLeases, aiAgentRuns } from '@api/infra/db/schema/index.js'
import { createAiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'
import { starterRuntimeAccess } from '@api/modules/ai/principal.js'
import {
  createAiAgentRunRepository,
  createAiAgentRunService,
  createAiRunEventRepository,
  createLaneLeaseStore,
} from '@api/modules/ai/run/index.js'
import { createAiAgentSessionRepository } from '@api/modules/ai/session/index.js'

import {
  assistantMessage,
  createSessionId,
  parseSseEvents,
  readSseBody,
  runDualRuntimeApps,
  seedAgent,
  seedEnabledModel,
  streamModel,
} from './ai-run-harness.js'
import { createTestApp, readFailure, register } from './helpers.js'

const migrationFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../infra/db/migrations')

function createMigratedTestDb(): AppDatabase {
  const bundle = createDatabase(':memory:')
  migrate(bundle.db, { migrationsFolder: migrationFolder })
  return bundle.db
}

function silentLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger
}

/**
 * 挂住的模型流：release 前每个 stream 调用保持 pending，release 后
 * 新调用立即收尾。abort signal 触发时也收尾——真实模型流会在 signal 上
 * 结束；agent 已 abort 时晚到的 done 会被映射成 aborted 终态。
 */
function createStreamGate() {
  const pending: Array<() => void> = []
  let released = false
  const streamFn: StreamFn = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream()
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      stream.push({
        type: 'done',
        reason: 'stop',
        message: assistantMessage([{ type: 'text', text: 'done' }], 'stop'),
      })
    }
    if (released) {
      finish()
    } else {
      pending.push(finish)
      options?.signal?.addEventListener('abort', finish, { once: true })
    }
    return stream
  }
  return {
    streamFn,
    release() {
      released = true
      for (const finish of pending.splice(0)) finish()
    },
  }
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

function terminalFailureCode(events: ReturnType<typeof parseSseEvents>): string | undefined {
  const terminal = events.at(-1)
  if (!terminal || terminal.type !== 'run.failed') return undefined
  return (terminal.data.error as { code?: string } | undefined)?.code
}

it('lane lease 条件更新：插入、未过期 busy、过期接管 token 递增、旧 owner 操作无效', () => {
  const db = createMigratedTestDb()
  const store = createLaneLeaseStore(db)

  // lane 无行：直接插入，token 从 1 起
  const first = store.acquire({ sessionId: 'session-1', lane: 'main', ownerId: 'instance-a' })
  expect(first).toEqual({ ownerId: 'instance-a', fencingToken: 1 })

  // 未过期：其他 owner 与同 owner 重复 acquire 都是 busy
  expect(store.acquire({ sessionId: 'session-1', lane: 'main', ownerId: 'instance-b' })).toBe('busy')
  expect(store.acquire({ sessionId: 'session-1', lane: 'main', ownerId: 'instance-a' })).toBe('busy')

  // 不同 lane 互不影响
  expect(store.acquire({ sessionId: 'session-1', lane: 'review', ownerId: 'instance-b' })).toEqual({
    ownerId: 'instance-b',
    fencingToken: 1,
  })

  // 手工把 lease_until 改到过去：新 owner 接管成功，token +1
  db.update(aiAgentLaneLeases)
    .set({ leaseUntil: Date.now() - 1 })
    .where(eq(aiAgentLaneLeases.lane, 'main'))
    .run()
  const takeover = store.acquire({ sessionId: 'session-1', lane: 'main', ownerId: 'instance-b' })
  expect(takeover).toEqual({ ownerId: 'instance-b', fencingToken: 2 })

  // 旧 owner（旧 token）续租与释放都无效果；新 owner 续租成功
  expect(store.renew({ sessionId: 'session-1', lane: 'main', owner: { ownerId: 'instance-a', fencingToken: 1 } })).toBe(
    false,
  )
  expect(
    store.release({ sessionId: 'session-1', lane: 'main', owner: { ownerId: 'instance-a', fencingToken: 1 } }),
  ).toBe(false)
  expect(store.renew({ sessionId: 'session-1', lane: 'main', owner: { ownerId: 'instance-b', fencingToken: 2 } })).toBe(
    true,
  )

  // 新 owner 释放后 lane 立即可用
  expect(
    store.release({ sessionId: 'session-1', lane: 'main', owner: { ownerId: 'instance-b', fencingToken: 2 } }),
  ).toBe(true)

  // releaseExpired 只删过期行：review 未过期不动，过期后的 main 已被释放
  expect(store.releaseExpired([{ sessionId: 'session-1', lane: 'review' }])).toBe(0)
  db.update(aiAgentLaneLeases)
    .set({ leaseUntil: Date.now() - 1 })
    .where(eq(aiAgentLaneLeases.lane, 'review'))
    .run()
  expect(store.releaseExpired([{ sessionId: 'session-1', lane: 'review' }])).toBe(1)
  expect(db.select().from(aiAgentLaneLeases).all()).toHaveLength(0)
})

it('同 lane 双 runtime：A 成功启动，B 得 AI.SESSION_BUSY；A 终态后 B 可启动', async () => {
  const gate = createStreamGate()
  const { a, b, cleanup } = runDualRuntimeApps({ streamFn: gate.streamFn })
  try {
    const user = await register(a.app, 'dual-lane@example.com')
    seedEnabledModel(a.runtime)
    const agentId = seedAgent(a.runtime, [])
    const sessionId = await createSessionId(a.app, user.cookie)

    const first = startRun(a.app, user.cookie, sessionId, { agentId, input: 'first' })
    await vi.waitFor(() => {
      expect(a.runtime.activeRunRegistry.getBySessionLane(sessionId, 'main')).toBeDefined()
    })

    const second = await startRun(b.app, user.cookie, sessionId, { agentId, input: 'second' })
    expect(second.status).toBe(409)
    expect((await readFailure(second)).error.code).toBe(ApiErrorCodes.AI_SESSION_BUSY)

    // 主库只有一条非终态 Run，lease 只有一行且属于 A
    const runs = a.runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).all()
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status === 'starting' || runs[0]?.status === 'running').toBe(true)
    const leases = a.runtime.db.select().from(aiAgentLaneLeases).where(eq(aiAgentLaneLeases.sessionId, sessionId)).all()
    expect(leases).toHaveLength(1)
    expect(leases[0]?.ownerId).toBe('instance-a')

    gate.release()
    const firstResponse = await first
    expect(firstResponse.status).toBe(200)
    expect(parseSseEvents(await readSseBody(firstResponse)).some((event) => event.type === 'run.completed')).toBe(true)

    // A 终态释放 lease 后，B 在同一 lane 可以启动
    await vi.waitFor(() => {
      expect(
        a.runtime.db.select().from(aiAgentLaneLeases).where(eq(aiAgentLaneLeases.sessionId, sessionId)).all(),
      ).toHaveLength(0)
    })
    const third = await startRun(b.app, user.cookie, sessionId, { agentId, input: 'third' })
    expect(third.status).toBe(200)
    expect(parseSseEvents(await readSseBody(third)).some((event) => event.type === 'run.completed')).toBe(true)
  } finally {
    await cleanup()
  }
})

it('不同 lane 双 runtime 不互斥：lease 粒度是 session + lane', async () => {
  const gate = createStreamGate()
  const { a, b, cleanup } = runDualRuntimeApps({ streamFn: gate.streamFn })
  try {
    const user = await register(a.app, 'dual-lanes@example.com')
    seedEnabledModel(a.runtime)
    const agentId = seedAgent(a.runtime, [])
    const sessionId = await createSessionId(a.app, user.cookie)

    const main = startRun(a.app, user.cookie, sessionId, { agentId, input: 'main' })
    await vi.waitFor(() => {
      expect(a.runtime.activeRunRegistry.getBySessionLane(sessionId, 'main')).toBeDefined()
    })

    // B 在同一 session 的 review lane 启动：不受 A 的 main lease 影响
    const review = await startRun(b.app, user.cookie, sessionId, { agentId, lane: 'review', input: 'review' })
    expect(review.status).toBe(200)

    const leases = a.runtime.db.select().from(aiAgentLaneLeases).where(eq(aiAgentLaneLeases.sessionId, sessionId)).all()
    expect(leases).toHaveLength(2)
    expect(new Set(leases.map((row) => row.lane))).toEqual(new Set(['main', 'review']))
    expect(new Set(leases.map((row) => row.ownerId))).toEqual(new Set(['instance-a', 'instance-b']))

    gate.release()
    const [mainResponse, reviewResponse] = await Promise.all([main, review])
    expect(mainResponse.status).toBe(200)
    expect(reviewResponse.status).toBe(200)
    expect(parseSseEvents(await readSseBody(mainResponse)).some((event) => event.type === 'run.completed')).toBe(true)
    expect(parseSseEvents(await readSseBody(reviewResponse)).some((event) => event.type === 'run.completed')).toBe(true)

    const runs = a.runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).all()
    expect(runs).toHaveLength(2)
    await vi.waitFor(() => {
      expect(
        a.runtime.db.select().from(aiAgentLaneLeases).where(eq(aiAgentLaneLeases.sessionId, sessionId)).all(),
      ).toHaveLength(0)
    })
  } finally {
    await cleanup()
  }
})

it('lease 被接管后旧 owner 提交终态：Run 落成 interrupted，不影响新 owner 的 lease', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-lane-fenced-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const gate = createStreamGate()
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => streamModel,
    streamFn: gate.streamFn,
    hasPermission: async () => true,
  })
  const { app, cleanup, runtime } = createTestApp({}, { agentSessionStore: store, piAgentExecutor: executor })
  try {
    const user = await register(app, 'fenced@example.com')
    seedEnabledModel(runtime)
    const agentId = seedAgent(runtime, [])
    const sessionId = await createSessionId(app, user.cookie)

    const started = startRun(app, user.cookie, sessionId, { agentId, input: 'held' })
    await vi.waitFor(() => {
      expect(runtime.activeRunRegistry.getBySessionLane(sessionId, 'main')).toBeDefined()
    })

    // 模拟接管：lease 行换成新 owner，token 递增
    const leaseRow = runtime.db.select().from(aiAgentLaneLeases).where(eq(aiAgentLaneLeases.sessionId, sessionId)).get()
    if (!leaseRow) throw new Error('lease 行不存在')
    runtime.db
      .update(aiAgentLaneLeases)
      .set({ ownerId: 'instance-b', fencingToken: leaseRow.fencingToken + 1 })
      .where(eq(aiAgentLaneLeases.sessionId, sessionId))
      .run()

    gate.release()
    const response = await started
    expect(response.status).toBe(200)
    const events = parseSseEvents(await readSseBody(response))
    expect(events.some((event) => event.type === 'run.completed')).toBe(false)
    expect(terminalFailureCode(events)).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)

    // 终态是 interrupted，实际执行结果被丢弃；旧 owner 的释放不删新 owner 的 lease
    const row = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).get()
    expect(row?.status).toBe('interrupted')
    expect(row?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)
    expect(row?.finalEntryId).toBeNull()
    const afterLease = runtime.db
      .select()
      .from(aiAgentLaneLeases)
      .where(eq(aiAgentLaneLeases.sessionId, sessionId))
      .get()
    expect(afterLease?.ownerId).toBe('instance-b')
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('续租失败时 executor 中止：Run 落成 interrupted，lease 与 registry 清理干净', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-lane-renew-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const gate = createStreamGate()
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => streamModel,
    streamFn: gate.streamFn,
    hasPermission: async () => true,
  })
  // TTL 40ms 小于执行时长，续租间隔 80ms 大于 TTL：第一次续租就发现 lease 已过期。
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutor: executor,
      laneLeaseOptions: { ttlMs: 40, renewIntervalMs: 80 },
    },
  )
  try {
    const user = await register(app, 'renew@example.com')
    seedEnabledModel(runtime)
    const agentId = seedAgent(runtime, [])
    const sessionId = await createSessionId(app, user.cookie)

    // gate 保持关闭：Run 停在 running，等续租定时器触发中止
    const started = await startRun(app, user.cookie, sessionId, { agentId, input: 'held' })
    expect(started.status).toBe(200)
    const events = parseSseEvents(await readSseBody(started))
    expect(events.some((event) => event.type === 'run.completed')).toBe(false)
    expect(terminalFailureCode(events)).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)

    const row = runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).get()
    expect(row?.status).toBe('interrupted')
    expect(row?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED)

    // 终态后：续租定时器清除、lease 释放、registry handle 释放
    expect(
      runtime.db.select().from(aiAgentLaneLeases).where(eq(aiAgentLaneLeases.sessionId, sessionId)).all(),
    ).toHaveLength(0)
    expect(runtime.activeRunRegistry.getBySessionLane(sessionId, 'main')).toBeUndefined()
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('readiness 完成前 startRun 等待，完成后继续执行', async () => {
  const { runtime, cleanup } = createTestApp()
  try {
    let releaseReadiness!: () => void
    const readiness = new Promise<void>((resolve) => {
      releaseReadiness = resolve
    })
    const service = createAiAgentRunService({
      repository: createAiAgentRunRepository(runtime.db),
      sessionRepository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      agentService: {} as never,
      registry: createActiveRunRegistry(),
      executor: {} as never,
      logger: silentLogger(),
      eventRepository: createAiRunEventRepository(runtime.db),
      outputContractRegistry: createAiOutputContractRegistry(),
      resolveAttachments: async () => [],
      supportsImageInput: () => false,
      laneLeaseStore: createLaneLeaseStore(runtime.db),
      instanceId: 'test-readiness',
      readiness,
    })

    const started = service.startRun({
      access: starterRuntimeAccess('user-1'),
      sessionId: 'missing-session',
      input: { input: 'hi' },
      requestId: 'request-readiness',
    })
    // readiness 未完成：请求保持 pending，不查 session、不建 Run、不领 lease
    const state = await Promise.race([
      started.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      new Promise<'pending'>((resolve) => setTimeout(resolve, 25, 'pending')),
    ])
    expect(state).toBe('pending')

    releaseReadiness()
    // readiness 完成后继续走常规校验：session 不存在，404
    await expect(started).rejects.toThrow()
    expect(runtime.db.select().from(aiAgentRuns).all()).toHaveLength(0)
    expect(runtime.db.select().from(aiAgentLaneLeases).all()).toHaveLength(0)
  } finally {
    cleanup()
  }
})
