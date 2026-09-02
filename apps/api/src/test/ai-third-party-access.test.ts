// 第三方（product_app，Bearer + X-AI-External-User-Id 等头）接入 AI 运行面的集成测试。
//
// 关于 G1 心跳修复不在此处测试：心跳是 15s 间隔的定时器写入，集成测试不可观测；
// 修复由 run.route.ts 创建流与恢复流两处 `": heartbeat\n\n"` 写法一致（grep 核对）
// 加上既有 "sse parser 接受 heartbeat 和任意 chunk 边界"（ai-cross-product-runtime.test.ts）
// 的解析回归覆盖，本文件不重复覆盖。
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import {
  ApiErrorCodes,
  uuidSchema,
  type AgentRun,
  type AgentTranscript,
  type AgentTranscriptItem,
  type RunTimeline,
  type StructuredOutputList,
} from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { createPiAgentExecutor } from '@api/infra/agent/index.js'
import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import {
  aiAgentRuns,
  aiEnabledModels,
  aiProviderConfigs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@api/infra/db/schema/index.js'
import { createAiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'
import type { ResolvedAiOutputContract } from '@api/modules/ai/output/output-contract-registry.js'
import { createAiRunLifecycleRepository } from '@api/modules/ai/run/index.js'
import { generateId } from '@api/shared/id.js'

import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

const model: Model<Api> = {
  id: 'third-party-model',
  name: 'Third party model',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 1024,
}

interface ProductClient {
  listAgents: () => Promise<Response>
  getAgent: (agentId: string) => Promise<Response>
  createSession: (title: string) => Promise<{ id: string }>
  startRunJson: (sessionId: string, agentId: string) => Promise<Response>
  startRunSse: (sessionId: string, agentId: string) => Promise<Response>
  getRun: (sessionId: string, runId: string) => Promise<Response>
  getTimeline: (sessionId: string, runId: string) => Promise<Response>
  getStructuredOutputs: (sessionId: string, runId: string) => Promise<Response>
  getTranscript: (sessionId: string) => Promise<Response>
}

it('cors 预检放行 AI 运行面所需的全部请求头', async () => {
  const { app, cleanup } = createTestApp({})
  try {
    const response = await app.request('/api/ai/sessions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:4399',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'authorization, x-ai-external-user-id, x-ai-subject-type, x-ai-subject-id, last-event-id, content-type',
      },
    })
    expect(response.status).toBe(204)
    const allowed = (response.headers.get('access-control-allow-headers') ?? '')
      .split(',')
      .map((header) => header.trim().toLowerCase())
    for (const header of [
      'content-type',
      'x-request-id',
      'authorization',
      'last-event-id',
      'x-ai-external-user-id',
      'x-ai-subject-type',
      'x-ai-subject-id',
    ]) {
      expect(allowed).toContain(header)
    }
  } finally {
    cleanup()
  }
})

it('product_app 发现 Agent、JSON 启动 Run、读取结构化输出并回放 transcript', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-third-party-'))
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
            id: `third-party-emit-${calls}`,
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
  const productContract = contracts.define({
    name: 'thirdparty.result',
    version: '1.0.0',
    description: 'Product visible result',
    schema: z.object({ result: z.string() }),
    renderKind: 'json',
    visibility: 'product',
    mode: 'required',
  })
  const adminContract = contracts.define({
    name: 'thirdparty.internal',
    version: '1.0.0',
    description: 'Admin visible result',
    schema: z.object({ result: z.string() }),
    renderKind: 'scorecard',
    visibility: 'admin',
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
    const enabledAgent = await setupAgent(app, runtime, admin, 'third-party-enabled')
    const disabledAgent = await setupAgent(app, runtime, admin, 'third-party-disabled')
    const disabled = await patchJson(app, `/api/ai/admin/agents/${disabledAgent.agentId}/status`, admin.cookie, {
      status: 'disabled',
    })
    expect(disabled.status).toBe(200)
    const productAgent = await setupAgent(app, runtime, admin, 'third-party-product', 8, [], productContract)
    const adminContractAgent = await setupAgent(app, runtime, admin, 'third-party-admin-contract', 8, [], adminContract)

    const main = await createAppCredential(app, admin.cookie, 'Main product', 'tenant-a', 'project-a')
    const other = await createAppCredential(app, admin.cookie, 'Other product', 'tenant-a', 'project-b')
    const client = createProductClient(app, main.secret, 'customer-1', {
      subjectType: 'ticket',
      subjectId: 'ticket-42',
    })
    const otherClient = createProductClient(app, other.secret, 'customer-1')

    // Agent 发现：列表只含 enabled，详情按 id 可读，disabled 404，伪造 Bearer 401。
    const listResponse = await client.listAgents()
    expect(listResponse.status).toBe(200)
    const list = await readSuccess<{
      items: Array<{ id: string; status: string }>
    }>(listResponse)
    const agentIds = list.data.items.map((item) => item.id)
    expect(agentIds).toContain(enabledAgent.agentId)
    expect(agentIds).toContain(productAgent.agentId)
    expect(agentIds).not.toContain(disabledAgent.agentId)
    expect(list.data.items.every((item) => item.status === 'enabled')).toBe(true)

    const detailResponse = await client.getAgent(enabledAgent.agentId)
    expect(detailResponse.status).toBe(200)
    const detail = await readSuccess<{ id: string; status: string }>(detailResponse)
    expect(detail.data.id).toBe(enabledAgent.agentId)
    expect(detail.data.status).toBe('enabled')

    expect((await client.getAgent(disabledAgent.agentId)).status).toBe(404)

    const invalidBearer = await app.request('/api/ai/agents', {
      headers: {
        Authorization: 'Bearer invalid-secret',
        'X-AI-External-User-Id': 'customer-1',
      },
    })
    expect(invalidBearer.status).toBe(401)
    expect((await readFailure(invalidBearer)).error.code).toBe(ApiErrorCodes.AUTH_UNAUTHENTICATED)

    // JSON 启动模式：Accept: application/json 返回 { runId }，Run 照常执行到终态。
    const session1 = await client.createSession('JSON 启动')
    const jsonStart = await client.startRunJson(session1.id, productAgent.agentId)
    expect(jsonStart.status, await jsonStart.clone().text()).toBe(200)
    expect(jsonStart.headers.get('content-type')).toContain('application/json')
    const started = await readSuccess<{ runId: string }>(jsonStart)
    expect(uuidSchema.safeParse(started.data.runId).success).toBe(true)
    const run1Id = started.data.runId

    const run1 = await pollTerminalRun(client, session1.id, run1Id)
    expect(run1.status).toBe('completed')

    const timelineResponse = await client.getTimeline(session1.id, run1Id)
    expect(timelineResponse.status).toBe(200)
    const timeline = await readSuccess<RunTimeline>(timelineResponse)
    expect(timeline.data.items.length).toBeGreaterThan(0)
    expect(timeline.data.items[0]?.type).toBe('run.started')
    expect(timeline.data.items.at(-1)?.type).toBe('run.completed')
    expect(timeline.data.items.some((event) => event.type === 'structured_output.available')).toBe(true)

    // SSE 分支不受 JSON 分流影响：显式 text/event-stream 仍走事件流。
    const sseSession = await client.createSession('SSE 启动')
    const sseStart = await client.startRunSse(sseSession.id, productAgent.agentId)
    expect(sseStart.status).toBe(200)
    expect(sseStart.headers.get('content-type')).toContain('text/event-stream')
    const sseBody = await sseStart.text()
    expect(sseBody).toContain('event: run.started')
    expect(sseBody).toContain('event: run.completed')

    // 结构化输出读取：product 可见性带 value，admin 可见性对运行面主体打码。
    const outputsResponse = await client.getStructuredOutputs(session1.id, run1Id)
    expect(outputsResponse.status).toBe(200)
    const outputs = await readSuccess<StructuredOutputList>(outputsResponse)
    expect(outputs.data.items).toHaveLength(1)
    expect(outputs.data.items[0]?.contract.name).toBe('thirdparty.result')
    expect(outputs.data.items[0]?.contract.visibility).toBe('product')
    expect(outputs.data.items[0]?.value).toEqual({ result: 'approved' })
    expect(uuidSchema.safeParse(outputs.data.items[0]?.referenceId).success).toBe(true)

    const session2 = await client.createSession('Admin 可见性 contract')
    const adminContractStart = await client.startRunJson(session2.id, adminContractAgent.agentId)
    expect(adminContractStart.status).toBe(200)
    const adminContractStarted = await readSuccess<{ runId: string }>(adminContractStart)
    const run2Id = adminContractStarted.data.runId
    const run2 = await pollTerminalRun(client, session2.id, run2Id)
    expect(run2.status).toBe('completed')

    const maskedResponse = await client.getStructuredOutputs(session2.id, run2Id)
    expect(maskedResponse.status).toBe(200)
    const masked = await readSuccess<StructuredOutputList>(maskedResponse)
    expect(masked.data.items).toHaveLength(1)
    expect(masked.data.items[0]?.contract.name).toBe('thirdparty.internal')
    expect(masked.data.items[0]?.contract.visibility).toBe('admin')
    expect(masked.data.items[0]?.value).toBeNull()

    // Admin 路由不打码：admin 可见性的 value 只有 AI_CONFIG_READ 能读到。
    const adminRouteRun1 = await app.request(`/api/ai/admin/runs/${run1Id}/structured-outputs`, {
      headers: { Cookie: admin.cookie },
    })
    expect(adminRouteRun1.status).toBe(200)
    const adminRun1Outputs = await readSuccess<StructuredOutputList>(adminRouteRun1)
    expect(adminRun1Outputs.data.items[0]?.value).toEqual({
      result: 'approved',
    })

    const adminRouteRun2 = await app.request(`/api/ai/admin/runs/${run2Id}/structured-outputs`, {
      headers: { Cookie: admin.cookie },
    })
    expect(adminRouteRun2.status).toBe(200)
    const adminRouteOutputs = await readSuccess<StructuredOutputList>(adminRouteRun2)
    expect(adminRouteOutputs.data.items).toHaveLength(1)
    expect(adminRouteOutputs.data.items[0]?.value).toEqual({
      result: 'approved',
    })

    // 跨 scope：另一个 project 的凭据读不到本 scope 的 session/run。
    expect((await otherClient.getStructuredOutputs(session1.id, run1Id)).status).toBe(404)

    // Admin 路由 runId 不存在：404。
    const missingRun = await app.request(`/api/ai/admin/runs/${generateId()}/structured-outputs`, {
      headers: { Cookie: admin.cookie },
    })
    expect(missingRun.status).toBe(404)
    expect((await readFailure(missingRun)).error.code).toBe(ApiErrorCodes.COMMON_NOT_FOUND)

    // Transcript 回放：emit_structured_output 的 tool_activity 携带 structuredOutput，
    // 可见性打码规则与读取路由一致。
    const transcript1Response = await client.getTranscript(session1.id)
    expect(transcript1Response.status).toBe(200)
    const transcript1 = await readSuccess<AgentTranscript>(transcript1Response)
    const emit1 = findEmitToolActivity(transcript1.data.items)
    expect(emit1).toBeDefined()
    expect(emit1?.structuredOutput).toBeDefined()
    expect(emit1?.structuredOutput?.value).toEqual({ result: 'approved' })
    expect(emit1?.structuredOutput?.contract.name).toBe('thirdparty.result')
    expect(emit1?.structuredOutput?.referenceId).toBe(outputs.data.items[0]?.referenceId)

    const transcript2Response = await client.getTranscript(session2.id)
    expect(transcript2Response.status).toBe(200)
    const transcript2 = await readSuccess<AgentTranscript>(transcript2Response)
    const emit2 = findEmitToolActivity(transcript2.data.items)
    expect(emit2).toBeDefined()
    expect(emit2?.structuredOutput).toBeDefined()
    expect(emit2?.structuredOutput?.value).toBeNull()
    expect(emit2?.structuredOutput?.contract.visibility).toBe('admin')

    // 非 tool_activity item 不带 structuredOutput 字段（可选字段纯增量）。
    for (const item of transcript1.data.items) {
      if (item.type === 'tool_activity') continue
      expect('structuredOutput' in item).toBe(false)
    }

    // Admin 面行为不变：cookie + 权限仍可读 admin 列表。
    const adminList = await app.request('/api/ai/admin/agents', {
      headers: { Cookie: admin.cookie },
    })
    expect(adminList.status).toBe(200)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

function findEmitToolActivity(
  items: AgentTranscriptItem[],
): Extract<AgentTranscriptItem, { type: 'tool_activity' }> | undefined {
  return items.find(
    (item): item is Extract<AgentTranscriptItem, { type: 'tool_activity' }> =>
      item.type === 'tool_activity' && item.name === 'emit_structured_output',
  )
}

function createProductClient(
  app: ReturnType<typeof createTestApp>['app'],
  secret: string,
  externalUserId: string,
  subject?: { subjectType: string; subjectId: string },
): ProductClient {
  const headers = {
    Authorization: `Bearer ${secret}`,
    'X-AI-External-User-Id': externalUserId,
    ...(subject
      ? {
          'X-AI-Subject-Type': subject.subjectType,
          'X-AI-Subject-Id': subject.subjectId,
        }
      : {}),
  }
  return {
    listAgents: async () => app.request('/api/ai/agents', { headers }),
    getAgent: async (agentId) => app.request(`/api/ai/agents/${agentId}`, { headers }),
    async createSession(title) {
      const response = await app.request('/api/ai/sessions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      expect(response.status).toBe(200)
      return (await readSuccess<{ id: string }>(response)).data
    },
    startRunJson: async (sessionId, agentId) =>
      app.request(`/api/ai/sessions/${sessionId}/runs`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ agentId, input: 'hello' }),
      }),
    startRunSse: async (sessionId, agentId) =>
      app.request(`/api/ai/sessions/${sessionId}/runs`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ agentId, input: 'hello' }),
      }),
    getRun: async (sessionId, runId) => app.request(`/api/ai/sessions/${sessionId}/runs/${runId}`, { headers }),
    getTimeline: async (sessionId, runId) =>
      app.request(`/api/ai/sessions/${sessionId}/runs/${runId}/timeline`, {
        headers,
      }),
    getStructuredOutputs: async (sessionId, runId) =>
      app.request(`/api/ai/sessions/${sessionId}/runs/${runId}/structured-outputs`, { headers }),
    getTranscript: async (sessionId) => app.request(`/api/ai/sessions/${sessionId}/transcript`, { headers }),
  }
}

async function pollTerminalRun(client: ProductClient, sessionId: string, runId: string): Promise<AgentRun> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await client.getRun(sessionId, runId)
    expect(response.status).toBe(200)
    const run = (await readSuccess<AgentRun>(response)).data
    if (['completed', 'failed', 'aborted', 'interrupted'].includes(run.status)) {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Run 未在等待时间内进入终态')
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

async function registerAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
) {
  const admin = await register(app, `third-party-admin-${Date.now()}@example.com`)
  const adminRole = runtime.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'admin')).get()!
  const permissionRows = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, 'ai:config:manage'))
    .all()
  const readPermissionRows = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, 'ai:config:read'))
    .all()
  for (const permission of [...permissionRows, ...readPermissionRows]) {
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
  runtime.db.update(userRoles).set({ roleId: adminRole.id }).where(eq(userRoles.userId, admin.user.id)).run()
  return admin
}

async function createAppCredential(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  name: string,
  tenantId: string,
  projectId: string,
): Promise<{ appId: string; secret: string }> {
  const response = await app.request('/api/ai/admin/applications', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, tenantId, projectId }),
  })
  expect(response.status).toBe(200)
  const result = await readSuccess<{
    application: { appId: string }
    secret: string
  }>(response)
  return { appId: result.data.application.appId, secret: result.data.secret }
}

async function setupAgent(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
  admin: { cookie: string },
  name: string,
  maxTurns = 8,
  toolRefs: Array<{ name: string; version: string }> = [],
  outputContract?: ResolvedAiOutputContract,
): Promise<{ agentId: string }> {
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
  return { agentId: createdBody.data.id }
}

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
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
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
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

it('product_app 携带内联配置启动 Run 返回 403，不创建 Run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-third-party-inline-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const streamFn = () => streamResponse(assistantMessage([{ type: 'text', text: 'unused' }], 'stop'), 'stop')
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
    },
  )

  try {
    const admin = await registerAdmin(app, runtime)
    const credential = await createAppCredential(app, admin.cookie, 'Inline forbidden', 'tenant-a', 'project-a')
    const modelRef = seedModel(runtime)
    const client = createProductClient(app, credential.secret, 'customer-1')
    const session = await client.createSession('内联拒绝')
    const sessionId = session.id

    const response = await app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.secret}`,
        'X-AI-External-User-Id': 'customer-1',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        input: 'hello',
        config: {
          model: modelRef,
          systemPrompt: '内联配置',
        },
      }),
    })
    expect(response.status).toBe(403)
    expect((await readFailure(response)).error.code).toBe(ApiErrorCodes.AI_RUN_INLINE_CONFIG_FORBIDDEN)
    expect(runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.sessionId, sessionId)).all()).toHaveLength(0)
  } finally {
    cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})
