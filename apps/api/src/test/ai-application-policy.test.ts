// 应用能力策略（capability policy）的集成测试。
// 覆盖：policy schema 校验、CRUD 与审计、discovery 过滤、start 403 矩阵、
// 403 的无副作用断言（不建 Run、不占 lease、不消费幂等键）、controls 403、
// product_app completion 禁用与 starter_user 对照。
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai'
import { ApiErrorCodes, type AiApplicationPolicy } from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import {
  aiAgentDefinitions,
  aiAgentLaneLeases,
  aiAgentRuns,
  aiAppCredentialAuditEvents,
  aiAppCredentials,
} from '@api/infra/db/schema/index.js'
import { createAuthorizationRepository } from '@api/modules/authorization/index.js'
import { createAiToolRegistry, defineAiTool } from '@api/modules/ai/tool/tool-registry.js'
import { generateId } from '@api/shared/id.js'

import { assistantMessage, runTestApp, seedAgent, seedEnabledModel, streamModel } from './ai-run-harness.js'
import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

const adminActor = {
  actorType: 'system' as const,
  actorId: 'test:ai',
  requestId: null,
}

const ALL_CONTROLS = ['abort', 'steer', 'follow_up'] as const

function policy(
  input: {
    executables?: Array<{ id: string; version: number }>
    controls?: AiApplicationPolicy['controls']
    maxSideEffect?: AiApplicationPolicy['maxSideEffect']
  } = {},
): AiApplicationPolicy {
  return {
    schemaVersion: 1,
    executables: input.executables ?? [],
    controls: [...(input.controls ?? ALL_CONTROLS)],
    maxSideEffect: input.maxSideEffect ?? 'non_idempotent_write',
  }
}

/** sideEffect 为 non_idempotent_write 的工具，用于 maxSideEffect 超限用例。 */
function nonIdempotentTool() {
  return defineAiTool({
    sideEffect: 'non_idempotent_write',
    name: 'policy_write',
    version: '1.0.0',
    description: 'Non-idempotent write for policy tests',
    inputSchema: z.object({}),
    timeoutMs: 1000,
    scope: 'platform',
    requiredPermission: null,
    async execute() {
      return { modelText: 'done', safeSummary: 'done' }
    },
  })
}

function gatedStreamOf(gate: Promise<void>): ReturnType<typeof createAssistantMessageEventStream> {
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

/** 每个 streamSimple 调用一个独立 gate；releaseAll 释放全部并把后续调用立即完成。 */
function gatedStreamFactory() {
  const releases: Array<() => void> = []
  let drain = false
  return {
    streamSimple: ((_model: unknown, _context: unknown, _options?: unknown) => {
      if (drain) return immediateDoneStream()
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      releases.push(release)
      return gatedStreamOf(gate)
    }) as unknown as Models['streamSimple'],
    releaseAll() {
      drain = true
      for (const release of releases.splice(0)) release()
    },
  }
}

function immediateDoneStream(): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  stream.push({
    type: 'done',
    reason: 'stop',
    message: assistantMessage([{ type: 'text', text: 'done' }], 'stop'),
  })
  return stream
}

/** seedAgent 的名字带毫秒时间戳，同一毫秒内多次 seed 会撞唯一索引，先隔 2ms。 */
async function seedUniqueAgent(
  runtime: ReturnType<typeof createTestApp>['runtime'],
  toolRefs: Array<{ name: string; version: string }>,
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 2))
  return seedAgent(runtime, toolRefs)
}

interface PolicyTestApp {
  app: ReturnType<typeof createTestApp>['app']
  runtime: ReturnType<typeof createTestApp>['runtime']
  cleanup: () => void
  store: ReturnType<typeof createPiSessionStore>
  directory: string
  admin: { cookie: string }
  releaseAll: () => void
}

async function setupPolicyApp(input: {
  streamSimple?: Models['streamSimple']
  tools: ReturnType<typeof createAiToolRegistry>
}): Promise<PolicyTestApp> {
  const directory = await mkdtemp(join(tmpdir(), 'starter-app-policy-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const gates = gatedStreamFactory()
  const test = runTestApp({
    store,
    tools: input.tools,
    streamSimple: input.streamSimple ?? gates.streamSimple,
  })
  seedEnabledModel(test.runtime)
  const email = `app-policy-${Date.now()}@example.com`
  const admin = await register(test.app, email)
  expect(createAuthorizationRepository(test.runtime.db).bootstrapAdminByEmail(email, adminActor).kind).toBe('ok')
  return {
    app: test.app,
    runtime: test.runtime,
    cleanup: test.cleanup,
    store,
    directory,
    admin,
    releaseAll: gates.releaseAll,
  }
}

async function createCredential(
  test: Pick<PolicyTestApp, 'app'>,
  cookie: string,
  policyInput: AiApplicationPolicy,
): Promise<{ appId: string; secret: string }> {
  const response = await test.app.request('/api/ai/admin/applications', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Policy Product ${generateId().slice(0, 8)}`,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      policy: policyInput,
    }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const body = await readSuccess<{ application: { appId: string }; secret: string }>(response)
  return { appId: body.data.application.appId, secret: body.data.secret }
}

async function patchPolicy(
  test: Pick<PolicyTestApp, 'app'>,
  cookie: string,
  appId: string,
  policyInput: AiApplicationPolicy,
): Promise<void> {
  const response = await test.app.request(`/api/ai/admin/applications/${appId}/policy`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ policy: policyInput }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
}

function bearerHeaders(secret: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secret}`,
    'X-AI-External-User-Id': 'customer-1',
  }
}

async function createProductSession(test: Pick<PolicyTestApp, 'app'>, secret: string): Promise<string> {
  const response = await test.app.request('/api/ai/sessions', {
    method: 'POST',
    headers: { ...bearerHeaders(secret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'policy-test' }),
  })
  expect(response.status).toBe(200)
  return (await readSuccess<{ id: string }>(response)).data.id
}

async function startProductRun(
  test: Pick<PolicyTestApp, 'app'>,
  secret: string,
  sessionId: string,
  agentId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: {
      ...bearerHeaders(secret),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ agentId, input: 'hello', ...extra }),
  })
}

/** 等 Run 主库状态到达 running（executor 尚在执行）。 */
async function waitForRunRunning(test: Pick<PolicyTestApp, 'runtime'>, sessionId: string): Promise<void> {
  await vi.waitFor(() => {
    const row = test.runtime.db
      .select({ status: aiAgentRuns.status })
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.sessionId, sessionId))
      .get()
    expect(row?.status).toBe('running')
  })
}

/** 等到 Run 终态且 lane lease 已释放，保证终态事务的后续收尾不再写库。 */
async function waitForRunSettled(
  test: Pick<PolicyTestApp, 'runtime'>,
  sessionId: string,
  status: RegExp,
): Promise<void> {
  await vi.waitFor(() => {
    const row = test.runtime.db
      .select({ status: aiAgentRuns.status })
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.sessionId, sessionId))
      .get()
    expect(row?.status).toMatch(status)
    const leases = test.runtime.db
      .select({ sessionId: aiAgentLaneLeases.sessionId })
      .from(aiAgentLaneLeases)
      .where(eq(aiAgentLaneLeases.sessionId, sessionId))
      .all()
    expect(leases).toHaveLength(0)
  })
}

async function readPolicyForbidden(response: Response): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(403)
  expect((await readFailure(response)).error.code).toBe(ApiErrorCodes.AI_APP_POLICY_FORBIDDEN)
}

it('create 请求的 policy 校验：缺 policy、未知字段、重复 executable、重复 control 均 400', async () => {
  const { app, runtime, cleanup } = createTestApp()
  try {
    const admin = await register(app, 'app-policy-schema@example.com')
    expect(
      createAuthorizationRepository(runtime.db).bootstrapAdminByEmail('app-policy-schema@example.com', adminActor).kind,
    ).toBe('ok')
    const base = { name: 'Schema Product', tenantId: 'tenant-a', projectId: 'project-a' }
    const post = (policyInput: unknown) =>
      app.request('/api/ai/admin/applications', {
        method: 'POST',
        headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(policyInput === undefined ? base : { ...base, policy: policyInput }),
      })

    // 缺 policy 字段
    expect((await post(undefined)).status).toBe(400)
    // 未知 policy 字段
    expect((await post({ ...policy(), unknown: 1 })).status).toBe(400)
    // 重复 executable id
    const id = generateId()
    expect(
      (
        await post(
          policy({
            executables: [
              { id, version: 1 },
              { id, version: 2 },
            ],
          }),
        )
      ).status,
    ).toBe(400)
    // 重复 control
    expect((await post(policy({ controls: ['abort', 'abort'] }))).status).toBe(400)
    // 合法 policy 通过
    expect((await post(policy())).status).toBe(200)
  } finally {
    cleanup()
  }
})

it('policy 的 PATCH 更新生效并写 policy_updated 审计；rotate 保留 policy；revoke 后 PATCH 409', async () => {
  const { app, runtime, cleanup } = createTestApp()
  try {
    const admin = await register(app, 'app-policy-crud@example.com')
    expect(
      createAuthorizationRepository(runtime.db).bootstrapAdminByEmail('app-policy-crud@example.com', adminActor).kind,
    ).toBe('ok')
    const created = await createCredential({ app }, admin.cookie, policy())
    const appId = created.appId

    const allowedId = generateId()
    const next = policy({
      executables: [{ id: allowedId, version: 3 }],
      controls: ['abort'],
      maxSideEffect: 'idempotent_write',
    })
    const patch = await app.request(`/api/ai/admin/applications/${appId}/policy`, {
      method: 'PATCH',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy: next }),
    })
    expect(patch.status).toBe(200)
    const patched = await readSuccess<{ policy: AiApplicationPolicy }>(patch)
    expect(patched.data.policy).toEqual(next)

    const list = await app.request('/api/ai/admin/applications', { headers: { cookie: admin.cookie } })
    const listBody = await readSuccess<Array<{ policy: AiApplicationPolicy }>>(list)
    expect(listBody.data[0]?.policy).toEqual(next)

    // 审计行出现 policy_updated。
    const audit = runtime.db
      .select({ action: aiAppCredentialAuditEvents.action })
      .from(aiAppCredentialAuditEvents)
      .where(eq(aiAppCredentialAuditEvents.appId, appId))
      .all()
    expect(audit.map((row) => row.action)).toContain('policy_updated')

    // rotate 只换 secret，policy 保留。
    const rotate = await app.request(`/api/ai/admin/applications/${appId}/rotate`, {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(rotate.status).toBe(200)
    const afterRotate = await app.request('/api/ai/admin/applications', { headers: { cookie: admin.cookie } })
    const afterRotateBody = await readSuccess<Array<{ policy: AiApplicationPolicy }>>(afterRotate)
    expect(afterRotateBody.data[0]?.policy).toEqual(next)

    // revoke 后 PATCH 拒绝。
    const revoke = await app.request(`/api/ai/admin/applications/${appId}/revoke`, {
      method: 'POST',
      headers: { cookie: admin.cookie },
    })
    expect(revoke.status).toBe(200)
    const revokedPatch = await app.request(`/api/ai/admin/applications/${appId}/policy`, {
      method: 'PATCH',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy: policy() }),
    })
    expect(revokedPatch.status).toBe(409)
    expect((await readFailure(revokedPatch)).error.code).toBe(ApiErrorCodes.AI_APP_CREDENTIAL_REVOKED)
  } finally {
    cleanup()
  }
})

it('discovery 只返回 policy 内且 revision 匹配的 manifest；null policy 返回空且 start 403', async () => {
  const test = await setupPolicyApp({ tools: createAiToolRegistry([]) })
  try {
    const allowedAgent = await seedUniqueAgent(test.runtime, [])
    const otherAgent = await seedUniqueAgent(test.runtime, [])
    const credential = await createCredential(
      test,
      test.admin.cookie,
      policy({ executables: [{ id: allowedAgent, version: 1 }] }),
    )
    const headers = bearerHeaders(credential.secret)

    // policy 内且 revision 匹配：列表可见、详情可读。
    const listResponse = await test.app.request('/api/ai/executables', { headers })
    expect(listResponse.status).toBe(200)
    const list = await readSuccess<{ items: Array<{ id: string; version: number }>; total: number }>(listResponse)
    expect(list.data.total).toBe(1)
    expect(list.data.items[0]).toMatchObject({ id: allowedAgent, version: 1 })

    const detail = await test.app.request(`/api/ai/executables/${allowedAgent}`, { headers })
    expect(detail.status).toBe(200)

    // 不在 policy 内：详情 404，不暴露存在性。
    expect((await test.app.request(`/api/ai/executables/${otherAgent}`, { headers })).status).toBe(404)

    // Agent config 变化（maxTurns）后 revision+1，旧 policy 不再匹配。
    const agentRow = test.runtime.db
      .select({ configJson: aiAgentDefinitions.configJson })
      .from(aiAgentDefinitions)
      .where(eq(aiAgentDefinitions.id, allowedAgent))
      .get()!
    const config = JSON.parse(agentRow.configJson) as Record<string, unknown>
    const updated = await test.app.request(`/api/ai/admin/agents/${allowedAgent}`, {
      method: 'PATCH',
      headers: { cookie: test.admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...config, maxTurns: 9 } }),
    })
    expect(updated.status).toBe(200)

    const listAfter = await readSuccess<{ items: unknown[]; total: number }>(
      await test.app.request('/api/ai/executables', { headers }),
    )
    expect(listAfter.data.total).toBe(0)
    expect((await test.app.request(`/api/ai/executables/${allowedAgent}`, { headers })).status).toBe(404)

    // null policy（模拟存量未配置）：discovery 返回空列表，start 拒绝。
    test.runtime.db
      .update(aiAppCredentials)
      .set({ policyJson: null })
      .where(eq(aiAppCredentials.id, credential.appId))
      .run()
    const emptyList = await readSuccess<{ items: unknown[]; total: number }>(
      await test.app.request('/api/ai/executables', { headers }),
    )
    expect(emptyList.data.total).toBe(0)

    const sessionId = await createProductSession(test, credential.secret)
    await readPolicyForbidden(await startProductRun(test, credential.secret, sessionId, otherAgent))
    expect(test.runtime.db.select({ id: aiAgentRuns.id }).from(aiAgentRuns).all()).toHaveLength(0)
  } finally {
    test.releaseAll()
    test.cleanup()
    await test.store.close()
    await rm(test.directory, { recursive: true, force: true })
  }
})

it('start 拒绝矩阵与无副作用：403 不建 Run、不占 lease、不消费幂等键', async () => {
  const test = await setupPolicyApp({ tools: createAiToolRegistry([nonIdempotentTool()]) })
  try {
    const allowedAgent = await seedUniqueAgent(test.runtime, [])
    const forbiddenAgent = await seedUniqueAgent(test.runtime, [])
    const writeAgent = await seedUniqueAgent(test.runtime, [{ name: 'policy_write', version: '1.0.0' }])
    // maxSideEffect 收紧到 read_only：writeAgent 的聚合 sideEffect 超限。
    const credential = await createCredential(
      test,
      test.admin.cookie,
      policy({
        executables: [
          { id: allowedAgent, version: 1 },
          { id: writeAgent, version: 1 },
        ],
        maxSideEffect: 'read_only',
      }),
    )
    const sessionId = await createProductSession(test, credential.secret)

    // 未授权 Agent
    await readPolicyForbidden(
      await startProductRun(test, credential.secret, sessionId, forbiddenAgent, { idempotencyKey: 'policy-403-key' }),
    )
    // maxSideEffect 超限
    await readPolicyForbidden(await startProductRun(test, credential.secret, sessionId, writeAgent))
    // revision 不匹配：config 变化后 revision 2，policy 仍是 1。
    const agentRow = test.runtime.db
      .select({ configJson: aiAgentDefinitions.configJson })
      .from(aiAgentDefinitions)
      .where(eq(aiAgentDefinitions.id, allowedAgent))
      .get()!
    const config = JSON.parse(agentRow.configJson) as Record<string, unknown>
    const updated = await test.app.request(`/api/ai/admin/agents/${allowedAgent}`, {
      method: 'PATCH',
      headers: { cookie: test.admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...config, maxTurns: 9 } }),
    })
    expect(updated.status).toBe(200)
    await readPolicyForbidden(await startProductRun(test, credential.secret, sessionId, allowedAgent))

    // 三种 403 都没有副作用：无 Run 行。
    expect(test.runtime.db.select({ id: aiAgentRuns.id }).from(aiAgentRuns).all()).toHaveLength(0)

    // 更新 policy 允许当前 revision 后，同一 session 同一 lane 立即可启动
    // （证明 403 未领 lease），且之前的幂等键未被消费。
    await patchPolicy(
      test,
      test.admin.cookie,
      credential.appId,
      policy({ executables: [{ id: allowedAgent, version: 2 }] }),
    )
    const started = await startProductRun(test, credential.secret, sessionId, allowedAgent, {
      idempotencyKey: 'policy-403-key',
    })
    expect(started.status, await started.clone().text()).toBe(200)
    const runId = (await readSuccess<{ runId: string }>(started)).data.runId
    await waitForRunRunning(test, sessionId)

    test.releaseAll()
    await waitForRunSettled(test, sessionId, /completed/)
    const rows = test.runtime.db
      .select({ id: aiAgentRuns.id, idempotencyKey: aiAgentRuns.idempotencyKey })
      .from(aiAgentRuns)
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(runId)
    expect(rows[0]?.idempotencyKey).toBe('policy-403-key')
  } finally {
    test.releaseAll()
    test.cleanup()
    await test.store.close()
    await rm(test.directory, { recursive: true, force: true })
  }
})

it('controls 检查：policy 缺对应 control 时 403，全量 controls 时正常', async () => {
  const test = await setupPolicyApp({ tools: createAiToolRegistry([]) })
  try {
    const agentId = await seedUniqueAgent(test.runtime, [])
    const noControls = await createCredential(
      test,
      test.admin.cookie,
      policy({ executables: [{ id: agentId, version: 1 }], controls: [] }),
    )
    const fullControls = await createCredential(
      test,
      test.admin.cookie,
      policy({ executables: [{ id: agentId, version: 1 }] }),
    )

    // controls 为空：三个控制操作全部 403，Run 本身不受影响。
    const noControlsSession = await createProductSession(test, noControls.secret)
    const noControlsStart = await startProductRun(test, noControls.secret, noControlsSession, agentId)
    expect(noControlsStart.status).toBe(200)
    const noControlsRunId = (await readSuccess<{ runId: string }>(noControlsStart)).data.runId
    await waitForRunRunning(test, noControlsSession)

    const control = (path: string) =>
      test.app.request(`/api/ai/sessions/${noControlsSession}/runs/${noControlsRunId}${path}`, {
        method: 'POST',
        headers: { ...bearerHeaders(noControls.secret), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'control attempt' }),
      })
    await readPolicyForbidden(await control('/abort'))
    await readPolicyForbidden(await control('/steer'))
    await readPolicyForbidden(await control('/follow-ups'))
    // Run 仍在运行，控制拒绝不改变 Run 状态。
    const noControlsRow = test.runtime.db
      .select({ status: aiAgentRuns.status })
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, noControlsRunId))
      .get()
    expect(noControlsRow?.status).toBe('running')

    // 全量 controls：挂住的 Run 上 steer、follow-up、abort 全部可用。
    const fullSession = await createProductSession(test, fullControls.secret)
    const fullStart = await startProductRun(test, fullControls.secret, fullSession, agentId)
    expect(fullStart.status).toBe(200)
    const fullRunId = (await readSuccess<{ runId: string }>(fullStart)).data.runId
    await waitForRunRunning(test, fullSession)

    const fullControl = (path: string) =>
      test.app.request(`/api/ai/sessions/${fullSession}/runs/${fullRunId}${path}`, {
        method: 'POST',
        headers: { ...bearerHeaders(fullControls.secret), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'allowed control' }),
      })
    expect((await fullControl('/steer')).status).toBe(200)
    expect((await fullControl('/follow-ups')).status).toBe(200)
    expect((await fullControl('/abort')).status).toBe(200)
    await waitForRunSettled(test, fullSession, /aborted/)

    // 收尾 noControls 的挂住 Run，避免终态收尾落在 cleanup 之后。
    test.releaseAll()
    await waitForRunSettled(test, noControlsSession, /completed/)
  } finally {
    test.releaseAll()
    test.cleanup()
    await test.store.close()
    await rm(test.directory, { recursive: true, force: true })
  }
})

it('product_app 调 completion 403；starter_user 同一 Agent 正常启动（对照）', async () => {
  const test = await setupPolicyApp({ tools: createAiToolRegistry([]) })
  try {
    const agentId = await seedUniqueAgent(test.runtime, [])
    const credential = await createCredential(
      test,
      test.admin.cookie,
      policy({ executables: [{ id: agentId, version: 1 }] }),
    )

    // product_app 与 policy 内容无关，无状态 completion 整体禁用。
    const completion = await test.app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        ...bearerHeaders(credential.secret),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: { providerId: streamModel.provider, modelId: streamModel.id },
        input: 'classify',
      }),
    })
    expect(completion.status).toBe(403)
    expect((await readFailure(completion)).error.code).toBe(ApiErrorCodes.AI_COMPLETION_FORBIDDEN)

    // starter_user（cookie，无 policy 概念）同一 Agent 正常启动并完成。
    const user = await register(test.app, 'app-policy-starter-user@example.com')
    const sessionResponse = await test.app.request('/api/ai/sessions', {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'starter-user-control' }),
    })
    const sessionId = (await readSuccess<{ id: string }>(sessionResponse)).data.id
    const started = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ agentId, input: 'starter user input' }),
    })
    expect(started.status, await started.clone().text()).toBe(200)

    test.releaseAll()
    await waitForRunSettled(test, sessionId, /completed/)
  } finally {
    test.releaseAll()
    test.cleanup()
    await test.store.close()
    await rm(test.directory, { recursive: true, force: true })
  }
})
