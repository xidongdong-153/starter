// AI Run Webhook 终态推送集成测试。
//
// 覆盖 prd.md 的验收清单：admin CRUD、非法 URL、端到端签名投递、重试退避、
// 死信、禁用窗口语义、进程崩溃后的补登，以及 AI_WEBHOOK_ENABLED=false 的总开关。
// 本地接收服务器挂在 127.0.0.1 随机端口（test 环境下 AiUrlGuard 放行 loopback）。
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHmac } from 'node:crypto'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'

import { createPiAgentExecutor } from '@api/infra/agent/index.js'
import {
  aiAgentRuns,
  aiAgentSessions,
  aiRunEvents,
  aiWebhookDeliveries,
  aiWebhookEndpoints,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@api/infra/db/schema/index.js'
import { createAiRunLifecycleRepository } from '@api/modules/ai/run/index.js'
import {
  createAiWebhookDispatcher,
  createWebhookCrypto,
  createWebhookSigningSecret,
  signWebhookPayload,
} from '@api/modules/ai/webhook/index.js'
import { generateId } from '@api/shared/id.js'

import { assistantMessage, seedAgent, seedEnabledModel, streamModel } from './ai-run-harness.js'
import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

const TEST_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

const WEBHOOK_ENV = {
  AI_WEBHOOK_ENABLED: 'true',
  AI_WEBHOOK_SWEEP_INTERVAL_MS: '1000',
  AI_WEBHOOK_TIMEOUT_MS: '2000',
  AI_WEBHOOK_MAX_ATTEMPTS: '3',
  AI_WEBHOOK_BACKOFF_MS: '0,100,100',
} satisfies NodeJS.ProcessEnv

const TERMINAL_STATUSES = ['completed', 'failed', 'aborted', 'interrupted'] as const

interface ReceivedRequest {
  headers: Record<string, string | string[] | undefined>
  body: string
}

interface WebhookTestContext {
  app: ReturnType<typeof createTestApp>['app']
  runtime: ReturnType<typeof createTestApp>['runtime']
  cleanup: () => void
  admin: { cookie: string; user: { id: string } }
  agentId: string
  credential: { appId: string; secret: string }
}

/** 一条立即完成的 assistant 流：start -> 一个 text delta -> done(stop)。 */
function okStream() {
  const message = assistantMessage([{ type: 'text', text: 'ok' }], 'stop')
  const stream = createAssistantMessageEventStream()
  const partial = assistantMessage([], 'pending')
  stream.push({ type: 'start', partial })
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: 'ok',
    partial,
  })
  stream.push({ type: 'done', reason: 'stop', message })
  return stream
}

function createWebhookTestApp(env: NodeJS.ProcessEnv = {}) {
  return createTestApp(
    { ...WEBHOOK_ENV, ...env },
    {
      piAgentExecutorFactory: (runtime) =>
        createPiAgentExecutor({
          sessionStore: runtime.agentSessionStore,
          resolveModel: () => streamModel,
          streamFn: okStream,
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(runtime.db),
        }),
    },
  )
}

async function registerAiAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
) {
  const admin = await register(app, `ai-webhook-${Date.now()}@example.com`)
  const adminRole = runtime.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'admin')).get()!
  for (const key of ['ai:config:manage', 'ai:config:read']) {
    for (const permission of runtime.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, key))
      .all()) {
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
  }
  runtime.db.update(userRoles).set({ roleId: adminRole.id }).where(eq(userRoles.userId, admin.user.id)).run()
  return admin
}

async function setupWebhookTest(env: NodeJS.ProcessEnv = {}): Promise<WebhookTestContext> {
  const { app, runtime, cleanup } = createWebhookTestApp(env)
  const admin = await registerAiAdmin(app, runtime)
  seedEnabledModel(runtime)
  const agentId = seedAgent(runtime, [])
  const credential = await createAppCredential(app, admin.cookie, agentId)
  return { app, runtime, cleanup, admin, agentId, credential }
}

/** product_app 启动 Run 需要允许该 Agent 的 policy（revision 为 seed 后的 1）。 */
function agentPolicy(agentId: string) {
  return {
    schemaVersion: 1 as const,
    executables: [{ id: agentId, version: 1 }],
    controls: ['abort', 'steer', 'follow_up'] as const,
    maxSideEffect: 'non_idempotent_write' as const,
  }
}

async function createAppCredential(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  agentId: string,
): Promise<{ appId: string; secret: string }> {
  const response = await app.request('/api/ai/admin/applications', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Webhook Product',
      tenantId: 'tenant-wh',
      projectId: 'project-wh',
      policy: agentPolicy(agentId),
    }),
  })
  expect(response.status).toBe(200)
  const result = await readSuccess<{
    application: { appId: string }
    secret: string
  }>(response)
  return { appId: result.data.application.appId, secret: result.data.secret }
}

async function createWebhookEndpoint(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  appId: string,
  url: string,
): Promise<{ endpointId: string; signingSecret: string }> {
  const response = await app.request('/api/ai/admin/webhook-endpoints', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, url }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const result = await readSuccess<{
    endpoint: { endpointId: string; url: string; status: string }
    signingSecret: string
  }>(response)
  return {
    endpointId: result.data.endpoint.endpointId,
    signingSecret: result.data.signingSecret,
  }
}

/** 直插 product_app Session 行（interrupted / 同时间戳 / claim 用例的造数底座）。 */
function insertProductSession(context: WebhookTestContext, now: Date): string {
  const sessionId = generateId()
  context.runtime.db
    .insert(aiAgentSessions)
    .values({
      id: sessionId,
      ownerId: null,
      principalKind: 'product_app',
      tenantId: 'tenant-wh',
      projectId: 'project-wh',
      externalUserId: 'wh-customer-1',
      appId: context.credential.appId,
      subjectType: null,
      subjectId: null,
      title: 'direct-insert',
      defaultAgentId: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return sessionId
}

/** 直插终态 Run 行（不建 ai_run_events，interrupted 语义）；返回 runId。 */
function insertTerminalRun(
  context: WebhookTestContext,
  sessionId: string,
  input: { status: string; finishedAt: Date },
): string {
  const runId = generateId()
  context.runtime.db
    .insert(aiAgentRuns)
    .values({
      id: runId,
      sessionId,
      agentId: context.agentId,
      lane: 'main',
      status: input.status,
      agentRevision: 1,
      snapshotJson: JSON.stringify({ schemaVersion: 2 }),
      requestId: 'direct-insert-test',
      finalEntryId: null,
      errorCode: null,
      createdAt: input.finishedAt,
      startedAt: input.finishedAt,
      finishedAt: input.finishedAt,
    })
    .run()
  return runId
}

/** 记录出站请求头的 fetch mock，claim 互斥用例用它代替真实接收服务器。 */
function mockFetchRecorder() {
  const calls: Array<{ headers: Record<string, string> }> = []
  return {
    calls,
    fetch: async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ headers: (init?.headers ?? {}) as Record<string, string> })
      return new Response('ok', { status: 200 })
    },
  }
}

/** 直接构造 dispatcher：与 createAiServices 同参，但 urlGuard 换成 mock。 */
function createTestDispatcher(
  runtime: ReturnType<typeof createTestApp>['runtime'],
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  return createAiWebhookDispatcher({
    db: runtime.db,
    crypto: createWebhookCrypto(TEST_ENCRYPTION_KEY),
    urlGuard: { fetch },
    logger: runtime.logger.child({ module: 'ai-webhook-test' }),
    settings: { sweepIntervalMs: 1000, maxAttempts: 3, backoffMs: [0, 0, 0] },
  })
}

interface DeliveryView {
  id: string
  endpointId: string
  appId: string
  runId: string
  eventType: string
  status: string
  attempts: number
  nextAttemptAt: string | null
  lastResponseCode: number | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  deadAt: string | null
}

async function listDeliveries(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  query: Record<string, string>,
): Promise<{ items: DeliveryView[]; total: number }> {
  const response = await app.request(`/api/ai/admin/webhook-deliveries?${new URLSearchParams(query).toString()}`, {
    headers: { Cookie: cookie },
  })
  expect(response.status).toBe(200)
  return (await readSuccess<{ items: DeliveryView[]; total: number }>(response)).data
}

async function startReceiver(respond?: (requestCount: number) => number): Promise<{
  url: string
  requests: ReceivedRequest[]
  close: () => Promise<void>
}> {
  const requests: ReceivedRequest[] = []
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      response.statusCode = respond?.(requests.length) ?? 200
      response.end('ok')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/webhook`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

function productHeaders(secret: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secret}`,
    'X-AI-External-User-Id': 'wh-customer-1',
  }
}

async function createProductSession(app: ReturnType<typeof createTestApp>['app'], secret: string): Promise<string> {
  const response = await app.request('/api/ai/sessions', {
    method: 'POST',
    headers: { ...productHeaders(secret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'webhook-e2e' }),
  })
  expect(response.status).toBe(200)
  return (await readSuccess<{ id: string }>(response)).data.id
}

async function startProductRun(
  app: ReturnType<typeof createTestApp>['app'],
  secret: string,
  sessionId: string,
  agentId: string,
): Promise<string> {
  const response = await app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: {
      ...productHeaders(secret),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ agentId, input: 'webhook-e2e' }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await readSuccess<{ runId: string }>(response)).data.runId
}

async function pollTerminalRun(
  app: ReturnType<typeof createTestApp>['app'],
  secret: string,
  sessionId: string,
  runId: string,
): Promise<{ status: string; finishedAt: string | null }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.request(`/api/ai/sessions/${sessionId}/runs/${runId}`, {
      headers: productHeaders(secret),
    })
    expect(response.status).toBe(200)
    const run = (await readSuccess<{ status: string; finishedAt: string | null }>(response)).data
    if ((TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Run 未在等待时间内进入终态')
}

/** 跑一个 product_app Run 到终态，返回 runId 与终态视图。 */
async function runOnce(
  context: WebhookTestContext,
  sessionId: string,
): Promise<{ runId: string; status: string; finishedAt: string | null }> {
  const runId = await startProductRun(context.app, context.credential.secret, sessionId, context.agentId)
  const run = await pollTerminalRun(context.app, context.credential.secret, sessionId, runId)
  return { runId, ...run }
}

function verifySignature(request: ReceivedRequest, signingSecret: string): { timestampSec: string; valid: boolean } {
  const header = request.headers['x-starter-signature']
  const signatureHeader = Array.isArray(header) ? header[0] : header
  expect(signatureHeader).toBeDefined()
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/u.exec(signatureHeader ?? '')
  expect(match).not.toBeNull()
  const timestampSec = match?.[1] ?? ''
  const expected = createHmac('sha256', signingSecret).update(`${timestampSec}.${request.body}`, 'utf8').digest('hex')
  return { timestampSec, valid: expected === match?.[2] }
}

it('webhook crypto：secret 生成格式、加解密 roundtrip 与不可用分支', () => {
  const crypto = createWebhookCrypto(TEST_ENCRYPTION_KEY)
  expect(crypto.available).toBe(true)

  const secret = createWebhookSigningSecret()
  expect(secret).toMatch(/^wh_[\w-]{43}$/u)

  const encrypted = crypto.encryptSecret(secret)
  expect(encrypted).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u)
  expect(encrypted).not.toContain(secret)
  expect(crypto.decryptSecret(encrypted)).toBe(secret)
  expect(crypto.encryptSecret(secret)).not.toBe(encrypted)

  const unavailable = createWebhookCrypto(undefined)
  expect(unavailable.available).toBe(false)
  expect(() => unavailable.encryptSecret(secret)).toThrowError()
  expect(() => unavailable.decryptSecret(encrypted)).toThrowError()

  // 换 key 解不开旧密文。
  const otherKey = createWebhookCrypto(Buffer.alloc(32, 7).toString('base64'))
  expect(() => otherKey.decryptSecret(encrypted)).toThrowError()

  const signature = signWebhookPayload('wh_secret', 1_700_000_000, '{"a":1}')
  expect(signature).toBe(
    `t=1700000000,v1=${createHmac('sha256', 'wh_secret').update('1700000000.{"a":1}', 'utf8').digest('hex')}`,
  )
})

it('admin CRUD：创建返回一次 secret，列表不含 secret，可改 URL/状态、rotate、删除', async () => {
  const receiver = await startReceiver()
  const secondReceiver = await startReceiver()
  try {
    const context = await setupWebhookTest()
    try {
      const created = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      expect(created.signingSecret).toMatch(/^wh_/u)
      expect(created.endpointId).toBeTruthy()

      const createdAgain = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        secondReceiver.url,
      )
      expect(createdAgain.endpointId).not.toBe(created.endpointId)

      const listResponse = await context.app.request(
        `/api/ai/admin/webhook-endpoints?appId=${context.credential.appId}`,
        { headers: { Cookie: context.admin.cookie } },
      )
      expect(listResponse.status).toBe(200)
      const list = await readSuccess<Array<Record<string, unknown>>>(listResponse)
      expect(list.data).toHaveLength(2)
      for (const endpoint of list.data) {
        expect(endpoint.signingSecret).toBeUndefined()
        expect(endpoint.secret).toBeUndefined()
      }

      const patched = await context.app.request(`/api/ai/admin/webhook-endpoints/${created.endpointId}`, {
        method: 'PATCH',
        headers: {
          Cookie: context.admin.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: secondReceiver.url,
          status: 'disabled',
        }),
      })
      expect(patched.status).toBe(200)
      const patchedBody = await readSuccess<{
        url: string
        status: string
      }>(patched)
      expect(patchedBody.data.url).toBe(secondReceiver.url)
      expect(patchedBody.data.status).toBe('disabled')

      const rotateResponse = await context.app.request(`/api/ai/admin/webhook-endpoints/${created.endpointId}/rotate`, {
        method: 'POST',
        headers: { Cookie: context.admin.cookie },
      })
      expect(rotateResponse.status).toBe(200)
      const rotated = await readSuccess<{ signingSecret: string }>(rotateResponse)
      expect(rotated.data.signingSecret).not.toBe(created.signingSecret)
      expect(rotated.data.signingSecret).toMatch(/^wh_/u)

      const deleteResponse = await context.app.request(`/api/ai/admin/webhook-endpoints/${created.endpointId}`, {
        method: 'DELETE',
        headers: { Cookie: context.admin.cookie },
      })
      expect(deleteResponse.status).toBe(200)

      const afterDelete = await context.app.request(`/api/ai/admin/webhook-endpoints/${created.endpointId}/rotate`, {
        method: 'POST',
        headers: { Cookie: context.admin.cookie },
      })
      expect(afterDelete.status).toBe(404)
      expect((await readFailure(afterDelete)).error.code).toBe('AI.WEBHOOK_ENDPOINT_NOT_FOUND')

      // 不存在的 appId 创建端点返回 404。
      const missingApp = await context.app.request('/api/ai/admin/webhook-endpoints', {
        method: 'POST',
        headers: {
          Cookie: context.admin.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId: generateId(),
          url: receiver.url,
        }),
      })
      expect(missingApp.status).toBe(404)
      expect((await readFailure(missingApp)).error.code).toBe('AI.APP_CREDENTIAL_NOT_FOUND')
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
    await secondReceiver.close()
  }
})

it('非法 URL（内网、错误 scheme、带凭据）创建返回 400', async () => {
  const context = await setupWebhookTest()
  try {
    for (const url of [
      'http://192.168.1.1/webhook',
      'ftp://example.com/webhook',
      'https://user:pass@example.com/webhook',
    ]) {
      const response = await context.app.request('/api/ai/admin/webhook-endpoints', {
        method: 'POST',
        headers: {
          Cookie: context.admin.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId: context.credential.appId,
          url,
        }),
      })
      expect(response.status, url).toBe(400)
      expect((await readFailure(response)).error.code).toBe('AI.CONFIG_INVALID')
    }
  } finally {
    context.cleanup()
  }
})

it('加密密钥不可用时创建与 rotate 返回 503 AI.CREDENTIAL_KEY_UNAVAILABLE', async () => {
  const context = await setupWebhookTest({
    AI_CREDENTIAL_ENCRYPTION_KEY: '',
  })
  try {
    const createResponse = await context.app.request('/api/ai/admin/webhook-endpoints', {
      method: 'POST',
      headers: {
        Cookie: context.admin.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId: context.credential.appId,
        url: 'http://127.0.0.1:9/webhook',
      }),
    })
    expect(createResponse.status).toBe(503)
    expect((await readFailure(createResponse)).error.code).toBe('AI.CREDENTIAL_KEY_UNAVAILABLE')

    // 已有端点（绕过 service 直插）在 key 不可用时 rotate 同样拒绝。
    const endpointId = generateId()
    const now = new Date()
    context.runtime.db
      .insert(aiWebhookEndpoints)
      .values({
        id: endpointId,
        appId: context.credential.appId,
        url: 'http://127.0.0.1:9/webhook',
        signingSecretEncrypted: 'v1.a.b.c',
        status: 'enabled',
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
        lastDeliveryAt: null,
      })
      .run()
    const rotateResponse = await context.app.request(`/api/ai/admin/webhook-endpoints/${endpointId}/rotate`, {
      method: 'POST',
      headers: { Cookie: context.admin.cookie },
    })
    expect(rotateResponse.status).toBe(503)
    expect((await readFailure(rotateResponse)).error.code).toBe('AI.CREDENTIAL_KEY_UNAVAILABLE')
  } finally {
    context.cleanup()
  }
})

it('端到端：Run 终态推送带可验证签名，payload 与 Run 终态一致，投递记录转 delivered', async () => {
  const receiver = await startReceiver()
  try {
    const context = await setupWebhookTest()
    try {
      const { endpointId, signingSecret } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      const sessionId = await createProductSession(context.app, context.credential.secret)
      const run = await runOnce(context, sessionId)
      expect(run.status).toBe('completed')

      await vi.waitFor(
        () => {
          expect(receiver.requests.length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 8000 },
      )
      const request = receiver.requests[0]!
      expect(request.headers['x-starter-event']).toBe('run.terminal')
      expect(request.headers['content-type']).toBe('application/json')
      expect(request.headers['user-agent']).toBe('starter-webhook/1')

      const { timestampSec, valid } = verifySignature(request, signingSecret)
      expect(valid).toBe(true)
      expect(request.headers['x-starter-timestamp']).toBe(timestampSec)

      const payload = JSON.parse(request.body) as Record<string, unknown>
      expect(payload.type).toBe('run.terminal')
      expect(payload.appId).toBe(context.credential.appId)
      expect(payload.runId).toBe(run.runId)
      expect(payload.sessionId).toBe(sessionId)
      expect(payload.lane).toBe('main')
      expect(payload.agentId).toBe(context.agentId)
      expect(payload.status).toBe('completed')
      expect(payload.errorCode).toBeNull()
      expect(payload.finishedAt).toBe(run.finishedAt)
      // payload identity 与持久 terminal RunEvent 一致，请求头带稳定投递 ID。
      const terminalRows = context.runtime.db
        .select({ eventId: aiRunEvents.eventId, sequence: aiRunEvents.sequence, type: aiRunEvents.type })
        .from(aiRunEvents)
        .where(eq(aiRunEvents.runId, run.runId))
        .all()
        .filter((row) => ['run.completed', 'run.failed', 'run.aborted'].includes(row.type))
      expect(terminalRows).toHaveLength(1)
      expect(payload.eventId).toBe(terminalRows[0]?.eventId)
      expect(payload.sequence).toBe(terminalRows[0]?.sequence)
      expect(payload.eventProtocolVersion).toBe(1)
      expect(typeof request.headers['x-starter-delivery-id']).toBe('string')
      expect(typeof payload.occurredAt).toBe('string')
      // payload 不携带 endpointId、正文和身份字段。
      expect(payload.endpointId).toBeUndefined()
      expect(payload.transcript).toBeUndefined()
      expect(payload.input).toBeUndefined()

      await vi.waitFor(
        async () => {
          const page = await listDeliveries(context.app, context.admin.cookie, {
            endpointId,
          })
          expect(page.total).toBe(1)
          expect(page.items[0]?.status).toBe('delivered')
          expect(page.items[0]?.runId).toBe(run.runId)
          expect(page.items[0]?.attempts).toBe(1)
          expect(page.items[0]?.lastResponseCode).toBe(200)
          expect(page.items[0]?.lastError).toBeNull()
          expect(page.items[0]?.eventType).toBe('run.terminal')
          expect(page.items[0]?.deliveredAt).not.toBeNull()
        },
        { timeout: 8000 },
      )

      // 端点列表能读到 lastDeliveryAt，但拿不到 secret。
      const listResponse = await context.app.request(
        `/api/ai/admin/webhook-endpoints?appId=${context.credential.appId}`,
        { headers: { Cookie: context.admin.cookie } },
      )
      const list = await readSuccess<Array<{ endpointId: string; lastDeliveryAt: string | null }>>(listResponse)
      const endpoint = list.data.find((item) => item.endpointId === endpointId)
      expect(endpoint?.lastDeliveryAt).not.toBeNull()

      // 重复 tick 不产生第二条投递（(endpointId, runId) 唯一）。
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const page = await listDeliveries(context.app, context.admin.cookie, {
        endpointId,
      })
      expect(page.total).toBe(1)
      expect(receiver.requests.length).toBe(1)
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('重试：前两次 500 第三次 200，attempts=3 后 delivered', async () => {
  const receiver = await startReceiver((count) => (count <= 2 ? 500 : 200))
  try {
    const context = await setupWebhookTest()
    try {
      const { endpointId } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      const sessionId = await createProductSession(context.app, context.credential.secret)
      const run = await runOnce(context, sessionId)

      await vi.waitFor(
        async () => {
          const page = await listDeliveries(context.app, context.admin.cookie, {
            endpointId,
          })
          const delivery = page.items[0]
          expect(delivery?.status).toBe('delivered')
          expect(delivery?.attempts).toBe(3)
          expect(delivery?.runId).toBe(run.runId)
          expect(delivery?.lastResponseCode).toBe(200)
        },
        { timeout: 8000 },
      )
      expect(receiver.requests.length).toBe(3)
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('死信：持续 5xx 到达最大次数后 dead，不再尝试', async () => {
  const receiver = await startReceiver(() => 500)
  try {
    const context = await setupWebhookTest()
    try {
      const { endpointId } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      const sessionId = await createProductSession(context.app, context.credential.secret)
      await runOnce(context, sessionId)

      await vi.waitFor(
        async () => {
          const page = await listDeliveries(context.app, context.admin.cookie, {
            endpointId,
            status: 'dead',
          })
          expect(page.total).toBe(1)
          expect(page.items[0]?.attempts).toBe(3)
          expect(page.items[0]?.lastResponseCode).toBe(500)
          expect(page.items[0]?.lastError).toContain('http_500')
          expect(page.items[0]?.deadAt).not.toBeNull()
        },
        { timeout: 8000 },
      )
      expect(receiver.requests.length).toBe(3)

      const requestsAfterDead = receiver.requests.length
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(receiver.requests.length).toBe(requestsAfterDead)
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('禁用端点不产生投递；重新启用后只投递新终态 Run', async () => {
  const receiver = await startReceiver()
  try {
    const context = await setupWebhookTest()
    try {
      const { endpointId } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      const disable = await context.app.request(`/api/ai/admin/webhook-endpoints/${endpointId}`, {
        method: 'PATCH',
        headers: {
          Cookie: context.admin.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'disabled' }),
      })
      expect(disable.status).toBe(200)

      const sessionId = await createProductSession(context.app, context.credential.secret)
      const disabledWindowRun = await runOnce(context, sessionId)
      expect(disabledWindowRun.status).toBe('completed')

      // 等 2 个以上 tick：禁用窗口内终态的 Run 不入队也不投递。
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(receiver.requests.length).toBe(0)
      const emptyPage = await listDeliveries(context.app, context.admin.cookie, {
        endpointId,
      })
      expect(emptyPage.total).toBe(0)

      const enable = await context.app.request(`/api/ai/admin/webhook-endpoints/${endpointId}`, {
        method: 'PATCH',
        headers: {
          Cookie: context.admin.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'enabled' }),
      })
      expect(enable.status).toBe(200)

      const enabledWindowRun = await runOnce(context, sessionId)
      await vi.waitFor(
        () => {
          expect(receiver.requests.length).toBe(1)
        },
        { timeout: 8000 },
      )

      const page = await listDeliveries(context.app, context.admin.cookie, {
        endpointId,
      })
      expect(page.total).toBe(1)
      expect(page.items[0]?.runId).toBe(enabledWindowRun.runId)
      expect(page.items[0]?.runId).not.toBe(disabledWindowRun.runId)
      expect(page.items[0]?.status).toBe('delivered')
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('补登：直插终态 Run 行（模拟进程崩溃漏发），一个 tick 后出现投递', async () => {
  const receiver = await startReceiver()
  try {
    const context = await setupWebhookTest()
    try {
      const { endpointId, signingSecret } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )

      // finished_at 晚于端点创建时间，模拟崩溃漏发后重启补扫。
      const now = new Date()
      const sessionId = generateId()
      const runId = generateId()
      context.runtime.db
        .insert(aiAgentSessions)
        .values({
          id: sessionId,
          ownerId: null,
          principalKind: 'product_app',
          tenantId: 'tenant-wh',
          projectId: 'project-wh',
          externalUserId: 'wh-customer-1',
          appId: context.credential.appId,
          subjectType: null,
          subjectId: null,
          title: 'backfill-session',
          defaultAgentId: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      context.runtime.db
        .insert(aiAgentRuns)
        .values({
          id: runId,
          sessionId,
          agentId: context.agentId,
          lane: 'main',
          status: 'completed',
          agentRevision: 1,
          snapshotJson: JSON.stringify({ schemaVersion: 2 }),
          requestId: 'backfill-test',
          finalEntryId: null,
          errorCode: null,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
        })
        .run()

      await vi.waitFor(
        async () => {
          const page = await listDeliveries(context.app, context.admin.cookie, {
            endpointId,
          })
          expect(page.total).toBe(1)
          expect(page.items[0]?.status).toBe('delivered')
          expect(page.items[0]?.runId).toBe(runId)
          expect(page.items[0]?.attempts).toBe(1)
        },
        { timeout: 8000 },
      )

      expect(receiver.requests.length).toBe(1)
      const { valid } = verifySignature(receiver.requests[0]!, signingSecret)
      expect(valid).toBe(true)
      const payload = JSON.parse(receiver.requests[0]!.body) as {
        runId: string
        appId: string
      }
      expect(payload.runId).toBe(runId)
      expect(payload.appId).toBe(context.credential.appId)
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('aI_WEBHOOK_ENABLED=false 时无任何投递行为，管理面 CRUD 仍可用', async () => {
  const receiver = await startReceiver()
  try {
    const context = await setupWebhookTest({ AI_WEBHOOK_ENABLED: 'false' })
    try {
      const { endpointId } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      const sessionId = await createProductSession(context.app, context.credential.secret)
      const run = await runOnce(context, sessionId)
      expect(run.status).toBe('completed')

      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(receiver.requests.length).toBe(0)
      const page = await listDeliveries(context.app, context.admin.cookie, {
        endpointId,
      })
      expect(page.total).toBe(0)
      expect(context.runtime.db.select().from(aiWebhookDeliveries).all()).toHaveLength(0)
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('interrupted Run 无 terminal RunEvent，delivery 的 eventId/sequence 为 null', async () => {
  const receiver = await startReceiver()
  try {
    const context = await setupWebhookTest()
    try {
      const { endpointId } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      const now = new Date()
      const sessionId = insertProductSession(context, now)
      const runId = insertTerminalRun(context, sessionId, { status: 'interrupted', finishedAt: now })

      await vi.waitFor(
        async () => {
          const page = await listDeliveries(context.app, context.admin.cookie, { endpointId })
          expect(page.total).toBe(1)
          expect(page.items[0]?.status).toBe('delivered')
        },
        { timeout: 8000 },
      )

      const payload = JSON.parse(receiver.requests[0]!.body) as {
        eventId: string | null
        sequence: number | null
        eventProtocolVersion: number
      }
      expect(payload.eventId).toBeNull()
      expect(payload.sequence).toBeNull()
      expect(payload.eventProtocolVersion).toBe(1)

      const row = context.runtime.db
        .select()
        .from(aiWebhookDeliveries)
        .where(eq(aiWebhookDeliveries.runId, runId))
        .get()!
      expect(row.eventId).toBeNull()
      expect(row.sequence).toBeNull()
      expect(row.eventProtocolVersion).toBe(1)
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('相同 finished_at 超过单批上限 200 时不漏发，重复扫描不重复建 delivery', async () => {
  const receiver = await startReceiver()
  try {
    const context = await setupWebhookTest()
    try {
      const { endpointId } = await createWebhookEndpoint(
        context.app,
        context.admin.cookie,
        context.credential.appId,
        receiver.url,
      )
      const finishedAt = new Date()
      const sessionId = insertProductSession(context, finishedAt)
      // 201 条共享同一毫秒 finished_at：单批上限 200，复合游标必须跨批继续扫。
      for (let index = 0; index < 201; index += 1) {
        insertTerminalRun(context, sessionId, { status: 'completed', finishedAt })
      }

      await vi.waitFor(
        async () => {
          const page = await listDeliveries(context.app, context.admin.cookie, { endpointId })
          expect(page.total).toBe(201)
        },
        { timeout: 8000 },
      )

      // 等一个以上 tick 确认没有第二批重复入队。
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const page = await listDeliveries(context.app, context.admin.cookie, { endpointId })
      expect(page.total).toBe(201)
    } finally {
      context.cleanup()
    }
  } finally {
    await receiver.close()
  }
})

it('两个 dispatcher 对同一 delivery 互斥，claim 过期后可重领', async () => {
  // 关闭 app 内置 dispatcher，两个手动构造的 dispatcher 共享同一 db。
  const context = await setupWebhookTest({ AI_WEBHOOK_ENABLED: 'false' })
  try {
    const { endpointId } = await createWebhookEndpoint(
      context.app,
      context.admin.cookie,
      context.credential.appId,
      'http://127.0.0.1:9/webhook',
    )
    const now = new Date()
    const sessionId = insertProductSession(context, now)
    const runId = insertTerminalRun(context, sessionId, { status: 'completed', finishedAt: now })

    // 直插 pending delivery，绕过 enqueue 阶段只验证 claim 互斥。
    const deliveryId = generateId()
    context.runtime.db
      .insert(aiWebhookDeliveries)
      .values({
        id: deliveryId,
        endpointId,
        appId: context.credential.appId,
        runId,
        eventType: 'run.terminal',
        payloadJson: JSON.stringify({ type: 'run.terminal' }),
        eventId: null,
        sequence: null,
        eventProtocolVersion: 1,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const fetchA = mockFetchRecorder()
    const dispatcherA = createTestDispatcher(context.runtime, fetchA.fetch)
    await dispatcherA.tick()
    expect(fetchA.calls).toHaveLength(1)
    expect(fetchA.calls[0]?.headers).toMatchObject({ 'X-Starter-Delivery-Id': deliveryId })
    expect(
      context.runtime.db.select().from(aiWebhookDeliveries).where(eq(aiWebhookDeliveries.id, deliveryId)).get()?.status,
    ).toBe('delivered')

    // 模拟另一实例持有未过期 claim：dispatcherB 不得投递。
    const claimedAt = new Date()
    context.runtime.db
      .update(aiWebhookDeliveries)
      .set({
        status: 'pending',
        claimedAt,
        claimExpiresAt: new Date(claimedAt.getTime() + 60_000),
        updatedAt: claimedAt,
      })
      .where(eq(aiWebhookDeliveries.id, deliveryId))
      .run()
    const fetchB = mockFetchRecorder()
    const dispatcherB = createTestDispatcher(context.runtime, fetchB.fetch)
    await dispatcherB.tick()
    expect(fetchB.calls).toHaveLength(0)
    expect(
      context.runtime.db.select().from(aiWebhookDeliveries).where(eq(aiWebhookDeliveries.id, deliveryId)).get()?.status,
    ).toBe('pending')

    // claim 过期后可被重领并完成投递。
    context.runtime.db
      .update(aiWebhookDeliveries)
      .set({ claimExpiresAt: new Date(claimedAt.getTime() - 1000) })
      .where(eq(aiWebhookDeliveries.id, deliveryId))
      .run()
    await dispatcherB.tick()
    expect(fetchB.calls).toHaveLength(1)
    expect(fetchB.calls[0]?.headers).toMatchObject({ 'X-Starter-Delivery-Id': deliveryId })
    expect(
      context.runtime.db.select().from(aiWebhookDeliveries).where(eq(aiWebhookDeliveries.id, deliveryId)).get()?.status,
    ).toBe('delivered')
  } finally {
    context.cleanup()
  }
})
