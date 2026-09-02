// 一次性无状态 AI 调用端点（POST /api/ai/completions）的集成测试：
// JSON / SSE 两种形态、双 principal 鉴权、白名单拒绝、审计副作用边界和 schema 边界。
import type { AiUsage, CompletionResult, CompletionStreamEvent } from '@starter/contracts'
import { ApiErrorCodes, completionStreamEventSchema } from '@starter/contracts'
import { expect, it } from 'vitest'

import type { AiGateway, AiGatewayInput } from '@api/infra/ai/index.js'
import {
  aiAgentRuns,
  aiAgentSessions,
  aiEnabledModels,
  aiModelCalls,
  aiProviderConfigs,
  aiRunEvents,
} from '@api/infra/db/schema/index.js'
import { createAuthorizationRepository } from '@api/modules/authorization/index.js'

import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

const systemContext = {
  actorType: 'system',
  actorId: 'test:ai',
  requestId: null,
} as const

const fakeUsage: AiUsage = {
  inputTokens: 3,
  outputTokens: 7,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 10,
}

const fakeContent = 'Hello, stateless world'

function createFakeGateway(usage: AiUsage = fakeUsage) {
  const inputs: AiGatewayInput[] = []
  const gateway: AiGateway = {
    async *stream(input) {
      inputs.push(input)
      yield {
        type: 'text_delta',
        text: 'Hello, ',
        turnIndex: 0,
        contentIndex: 0,
        blockId: '0:0',
      }
      yield {
        type: 'text_delta',
        text: 'stateless world',
        turnIndex: 0,
        contentIndex: 0,
        blockId: '0:0',
      }
      yield {
        type: 'completed',
        turnIndex: 0,
        assistantMessage: {
          role: 'assistant',
          blocks: [
            {
              type: 'text',
              text: fakeContent,
              turnIndex: 0,
              contentIndex: 0,
              blockId: '0:0',
            },
          ],
        },
        stopReason: 'stop',
        usage,
        cost: null,
      }
    },
  }
  return { gateway, inputs }
}

function parseCompletionStream(body: string): Array<{ id?: string; event: CompletionStreamEvent }> {
  return body
    .trim()
    .split(/\r?\n\r?\n/)
    .filter((frame) => frame.length > 0)
    .map((frame) => {
      const lines = frame.split(/\r?\n/)
      const eventName = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length)
      const dataLine = lines.find((line) => line.startsWith('data: '))
      const idLine = lines.find((line) => line.startsWith('id: '))
      const event = completionStreamEventSchema.parse(JSON.parse(dataLine?.slice('data: '.length) ?? '') as unknown)
      expect(event.type).toBe(eventName)
      return { id: idLine?.slice('id: '.length), event }
    })
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

function tableCount(
  runtime: ReturnType<typeof createTestApp>['runtime'],
  table: typeof aiAgentSessions | typeof aiAgentRuns | typeof aiRunEvents,
): number {
  return runtime.db.select().from(table).all().length
}

const nullUsage: AiUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: null,
}

it('usage 三 token 字段全 null 时 JSON 响应省略 usage 字段', async () => {
  const { gateway } = createFakeGateway(nullUsage)
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const user = await register(app, 'completion-null-usage@example.com')
    const modelRef = seedModel(runtime)

    const response = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: modelRef, input: '翻译这句话' }),
    })
    expect(response.status).toBe(200)
    const result = await readSuccess<CompletionResult>(response)
    expect(result.data.content).toBe(fakeContent)
    expect('usage' in result.data).toBe(false)
  } finally {
    await cleanup()
  }
})

it('starter_user 用 JSON 模式拿到完整单轮结果并写 completion 审计', async () => {
  const { gateway } = createFakeGateway()
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const user = await register(app, 'completion-user@example.com')
    const modelRef = seedModel(runtime)

    const response = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: modelRef, input: '翻译这句话' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const result = await readSuccess<CompletionResult>(response)
    expect(result.data).toEqual({
      content: fakeContent,
      stopReason: 'stop',
      usage: fakeUsage,
    })

    const calls = runtime.db.select().from(aiModelCalls).all()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      scenario: 'completion',
      principalKind: 'starter_user',
      userId: user.user.id,
      appId: null,
      runId: null,
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
      result: 'succeeded',
      stopReason: 'stop',
      inputTokens: 3,
      outputTokens: 7,
      totalTokens: 10,
    })
  } finally {
    cleanup()
  }
})

it('product_app 用 Bearer 调用 JSON 模式并写入应用维度审计', async () => {
  const { gateway } = createFakeGateway()
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const admin = await register(app, 'completion-admin@example.com')
    expect(
      createAuthorizationRepository(runtime.db).bootstrapAdminByEmail('completion-admin@example.com', systemContext)
        .kind,
    ).toBe('ok')
    const credentialResponse = await app.request('/api/ai/admin/applications', {
      method: 'POST',
      headers: {
        cookie: admin.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Completion Product',
        tenantId: 'tenant-a',
        projectId: 'project-a',
      }),
    })
    expect(credentialResponse.status).toBe(200)
    const credential = await readSuccess<{
      application: { appId: string }
      secret: string
    }>(credentialResponse)
    const modelRef = seedModel(runtime)

    const response = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.data.secret}`,
        'X-AI-External-User-Id': 'customer-1',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: modelRef, input: 'classify this' }),
    })
    expect(response.status).toBe(200)
    const result = await readSuccess<CompletionResult>(response)
    expect(result.data.content).toBe(fakeContent)
    expect(result.data.stopReason).toBe('stop')

    const calls = runtime.db.select().from(aiModelCalls).all()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      scenario: 'completion',
      principalKind: 'product_app',
      appId: credential.data.application.appId,
      externalUserId: 'customer-1',
      userId: 'customer-1',
      tenantId: 'tenant-a',
      projectId: 'project-a',
      runId: null,
      result: 'succeeded',
    })
  } finally {
    cleanup()
  }
})

it('sse 模式返回 text_delta 序列和 done 事件，缺省 Accept 同样走流', async () => {
  const { gateway } = createFakeGateway()
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const user = await register(app, 'completion-sse@example.com')
    const modelRef = seedModel(runtime)

    const response = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ model: modelRef, input: '翻译这句话' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const frames = parseCompletionStream(await response.text())
    expect(frames.map((frame) => frame.event.type)).toEqual(['text_delta', 'text_delta', 'done'])
    expect(frames.map((frame) => frame.id)).toEqual(['1', '2', '3'])
    const content = frames.map((frame) => (frame.event.type === 'text_delta' ? frame.event.text : '')).join('')
    expect(content).toBe(fakeContent)
    expect(frames[2]?.event).toMatchObject({
      type: 'done',
      stopReason: 'stop',
      usage: fakeUsage,
    })

    // 缺省 Accept（不发送 Accept 头）同样走 SSE。
    const defaultResponse = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelRef, input: '再来一次' }),
    })
    expect(defaultResponse.status).toBe(200)
    expect(defaultResponse.headers.get('content-type')).toContain('text/event-stream')
    const defaultFrames = parseCompletionStream(await defaultResponse.text())
    expect(defaultFrames.map((frame) => frame.event.type)).toEqual(['text_delta', 'text_delta', 'done'])
  } finally {
    cleanup()
  }
})

it('systemPrompt 透传给 Gateway，未传时为 undefined', async () => {
  const { gateway, inputs } = createFakeGateway()
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const user = await register(app, 'completion-prompt@example.com')
    const modelRef = seedModel(runtime)

    const withPrompt = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: modelRef,
        systemPrompt: '把输入翻译成英文',
        input: '你好',
      }),
    })
    expect(withPrompt.status).toBe(200)

    const withoutPrompt = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: modelRef, input: '你好' }),
    })
    expect(withoutPrompt.status).toBe(200)

    expect(inputs).toHaveLength(2)
    expect(inputs[0]?.systemPrompt).toBe('把输入翻译成英文')
    expect(inputs[1]?.systemPrompt).toBeUndefined()
    const firstMessage = inputs[0]?.messages[0]
    expect(firstMessage?.role).toBe('user')
    if (firstMessage?.role === 'user') {
      expect(firstMessage.content[0]).toMatchObject({
        type: 'text',
        text: '你好',
        turnIndex: 0,
        contentIndex: 0,
        blockId: '0:0',
      })
    }
  } finally {
    cleanup()
  }
})

it('白名单外模型返回 403 且不写审计；未认证返回 401', async () => {
  const { gateway } = createFakeGateway()
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const user = await register(app, 'completion-deny@example.com')
    seedModel(runtime)

    const unauthenticated = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: { providerId: 'openai', modelId: 'gpt-not-allowed' },
        input: 'hi',
      }),
    })
    expect(unauthenticated.status).toBe(401)

    const denied = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: { providerId: 'openai', modelId: 'gpt-not-allowed' },
        input: 'hi',
      }),
    })
    expect(denied.status).toBe(403)
    expect((await readFailure(denied)).error.code).toBe(ApiErrorCodes.AI_MODEL_NOT_ALLOWED)
    expect(runtime.db.select().from(aiModelCalls).all()).toHaveLength(0)
  } finally {
    cleanup()
  }
})

it('成功调用不产生 Session、Run、事件和 Pi Session 副作用', async () => {
  const { gateway } = createFakeGateway()
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const user = await register(app, 'completion-isolated@example.com')
    const modelRef = seedModel(runtime)

    const before = {
      sessions: tableCount(runtime, aiAgentSessions),
      runs: tableCount(runtime, aiAgentRuns),
      events: tableCount(runtime, aiRunEvents),
      piSessions: await runtime.agentSessionStore.listSessions(),
    }

    const response = await app.request('/api/ai/completions', {
      method: 'POST',
      headers: {
        cookie: user.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: modelRef, input: '翻译这句话' }),
    })
    expect(response.status).toBe(200)

    expect(tableCount(runtime, aiAgentSessions)).toBe(before.sessions)
    expect(tableCount(runtime, aiAgentRuns)).toBe(before.runs)
    expect(tableCount(runtime, aiRunEvents)).toBe(before.events)
    expect(await runtime.agentSessionStore.listSessions()).toEqual(before.piSessions)
    expect(runtime.db.select().from(aiModelCalls).all()).toHaveLength(1)
  } finally {
    cleanup()
  }
})

it('schema 边界：input 超长、systemPrompt 超长、缺 model 返回 400', async () => {
  const { gateway } = createFakeGateway()
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway })
  try {
    const user = await register(app, 'completion-schema@example.com')
    const modelRef = seedModel(runtime)

    const post = (body: Record<string, unknown>) =>
      app.request('/api/ai/completions', {
        method: 'POST',
        headers: {
          cookie: user.cookie,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      })

    const longInput = await post({
      model: modelRef,
      input: 'a'.repeat(100_001),
    })
    expect(longInput.status).toBe(400)
    expect((await readFailure(longInput)).error.code).toBe(ApiErrorCodes.COMMON_INVALID_REQUEST)

    const longSystemPrompt = await post({
      model: modelRef,
      systemPrompt: 's'.repeat(32_001),
      input: 'hi',
    })
    expect(longSystemPrompt.status).toBe(400)

    const missingModel = await post({ input: 'hi' })
    expect(missingModel.status).toBe(400)

    expect(runtime.db.select().from(aiModelCalls).all()).toHaveLength(0)
  } finally {
    cleanup()
  }
})
