import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { aiRunResolvedManifestSchema, ApiErrorCodes, type AiRunResolvedManifest } from '@starter/contracts'
import { eq, sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { createPiAgentExecutor } from '@api/infra/agent/index.js'
import { createPiSessionStore } from '@api/infra/agent/pi-session-store.js'
import {
  aiAgentDefinitions,
  aiAgentLaneLeases,
  aiAgentRuns,
  aiEnabledModels,
  aiProviderConfigs,
  aiRunResolvedManifests,
  aiSkills,
  aiSkillRevisions,
  aiStructuredOutputs,
  aiSystemPromptRevisions,
  aiSystemPrompts,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@api/infra/db/schema/index.js'
import { createAiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'
import { createAiRunLifecycleRepository } from '@api/modules/ai/run/index.js'
import { createAiRunResolvedManifestRepository } from '@api/modules/ai/run/run-resolved-manifest.repository.js'
import { sha256Hex } from '@api/modules/ai/run/resolved-manifest.js'
import { defineAiTool } from '@api/modules/ai/tool/tool-registry.js'

import { createTestApp, readSuccess, register } from './helpers.js'

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

function textStream(text: string): StreamFn {
  return async () => {
    const stream = createAssistantMessageEventStream()
    const message = assistantMessage([{ type: 'text', text }], 'stop')
    stream.push({ type: 'start', partial: assistantMessage([], 'pending') })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message })
    stream.push({ type: 'done', reason: 'stop', message })
    return stream
  }
}

function emitStructuredOutputStream(value: Record<string, unknown>): StreamFn {
  return async () => {
    const stream = createAssistantMessageEventStream()
    const toolCall = {
      type: 'toolCall' as const,
      id: `emit-${Date.now()}`,
      name: 'emit_structured_output',
      arguments: value,
    }
    const message = assistantMessage([toolCall], 'toolUse')
    stream.push({ type: 'start', partial: assistantMessage([], 'pending') })
    stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message })
    stream.push({ type: 'done', reason: 'toolUse', message })
    return stream
  }
}

/** 建一个带真实 executor 的 app；streamFn 决定模型回复内容。 */
async function createManifestApp(input: {
  streamFn: StreamFn
  outputContracts?: ReturnType<typeof createAiOutputContractRegistry>
  envOverrides?: Record<string, string>
}) {
  const directory = await mkdtemp(join(tmpdir(), 'starter-resolved-manifest-'))
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const testApp = createTestApp(input.envOverrides ?? {}, {
    agentSessionStore: store,
    ...(input.outputContracts ? { aiOutputContracts: input.outputContracts } : {}),
    piAgentExecutorFactory: (runtime) =>
      createPiAgentExecutor({
        sessionStore: store,
        resolveModel: () => model,
        streamFn: input.streamFn,
        hasPermission: async () => true,
        lifecycle: createAiRunLifecycleRepository(runtime.db),
      }),
  })
  return {
    app: testApp.app,
    runtime: testApp.runtime,
    directory,
    cleanup: testApp.cleanup,
  }
}

async function registerAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
) {
  const owner = await register(
    app,
    `manifest-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
  )
  const adminRole = runtime.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'admin')).get()!
  const permissionRows = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(sql`${permissions.key} IN ('ai:config:manage', 'ai:config:read')`)
    .all()
  for (const permission of permissionRows) {
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

function seedModel(runtime: ReturnType<typeof createTestApp>['runtime']) {
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
    .values({ providerId: modelRef.providerId, modelId: modelRef.modelId, enabledAt: now })
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
  const response = await app.request(path, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status !== 200) {
    throw new Error(`POST ${path} 失败: ${response.status} ${await response.text()}`)
  }
  return readSuccess<Record<string, unknown>>(response)
}

async function putJson(
  app: ReturnType<typeof createTestApp>['app'],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  const response = await app.request(path, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status !== 200) {
    throw new Error(`PUT ${path} 失败: ${response.status} ${await response.text()}`)
  }
  return readSuccess<Record<string, unknown>>(response)
}

/** 创建启用中的 Agent；返回 agentId 与 promptId。 */
async function createEnabledAgent(
  app: ReturnType<typeof createTestApp>['app'],
  adminCookie: string,
  modelRef: { providerId: string; modelId: string },
  options: {
    promptContent?: string
    skillIds?: string[]
    outputContract?: unknown
    name?: string
  } = {},
): Promise<{ agentId: string; promptId: string }> {
  const name = options.name ?? `manifest-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const prompt = await postJson(app, '/api/ai/system-prompts', adminCookie, {
    name: `${name}-prompt`,
    content: options.promptContent ?? 'SECRET-SYSTEM-PROMPT',
  })
  const promptId = prompt.data.id as string
  const created = await postJson(app, '/api/ai/admin/agents', adminCookie, {
    name,
    config: {
      schemaVersion: 2,
      model: modelRef,
      systemPromptId: promptId,
      skillIds: options.skillIds ?? [],
      toolRefs: [],
      ...(options.outputContract ? { outputContract: options.outputContract } : {}),
      thinkingLevel: 'off',
      maxTurns: 8,
    },
  })
  const agentId = created.data.id as string
  const statusResponse = await app.request(`/api/ai/admin/agents/${agentId}/status`, {
    method: 'PATCH',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'enabled' }),
  })
  if (statusResponse.status !== 200) {
    throw new Error(`Agent 启用失败: ${statusResponse.status} ${await statusResponse.text()}`)
  }
  return { agentId, promptId }
}

async function createSession(app: ReturnType<typeof createTestApp>['app'], cookie: string): Promise<string> {
  const created = await app.request('/api/ai/sessions', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'manifest' }),
  })
  const body = await readSuccess<{ id: string }>(created)
  return body.data.id
}

/** 启动 Run 并读完整 SSE 到终态；返回 runId 与事件列表。 */
async function runToCompletion(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  sessionId: string,
  input: Record<string, unknown>,
): Promise<{ runId: string; events: Array<Record<string, unknown>> }> {
  const response = await app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (response.status !== 200) {
    throw new Error(`Run 启动失败: ${response.status} ${await response.text()}`)
  }
  const body = await response.text()
  const events: Array<Record<string, unknown>> = []
  const dataLines: string[] = []
  for (const line of body.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
      continue
    }
    if (line.trim() === '' && dataLines.length > 0) {
      events.push(JSON.parse(dataLines.join('\n')) as Record<string, unknown>)
      dataLines.length = 0
    }
  }
  const first = events[0] as { runId?: string } | undefined
  if (!first?.runId) throw new Error('Run 启动未返回 runId')
  return { runId: first.runId, events }
}

function readManifestRow(runtime: ReturnType<typeof createTestApp>['runtime'], runId: string) {
  return runtime.db.select().from(aiRunResolvedManifests).where(eq(aiRunResolvedManifests.runId, runId)).get()
}

function parseManifest(manifestJson: string): AiRunResolvedManifest {
  return aiRunResolvedManifestSchema.parse(JSON.parse(manifestJson))
}

it('相同 Agent revision 不同时间启动两次 Run，解析出相同 manifestHash', async () => {
  const harness = await createManifestApp({ streamFn: textStream('ok') })
  try {
    const admin = await registerAdmin(harness.app, harness.runtime)
    const user = await register(harness.app, `same-hash-${Date.now()}@example.com`)
    const modelRef = seedModel(harness.runtime)
    const { agentId } = await createEnabledAgent(harness.app, admin.cookie, modelRef, {
      promptContent: 'SECRET-SYSTEM-PROMPT',
    })
    const sessionId = await createSession(harness.app, user.cookie)

    const first = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId,
      input: 'first',
    })
    const second = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId,
      input: 'second',
    })

    const firstRow = readManifestRow(harness.runtime, first.runId)
    const secondRow = readManifestRow(harness.runtime, second.runId)
    expect(firstRow).toBeDefined()
    expect(secondRow).toBeDefined()
    expect(firstRow!.manifestHash).toBe(secondRow!.manifestHash)

    const manifest = parseManifest(firstRow!.manifestJson)
    expect(manifest.agentId).toBe(agentId)
    expect(manifest.agentRevision).toBe(1)
    expect(manifest.modelRef).toBe(`${modelRef.providerId}/${modelRef.modelId}`)
    expect(manifest.systemPrompt).toMatchObject({
      promptId: firstRow ? expect.any(String) : null,
      inline: false,
      revision: 1,
    })
    expect(manifest.systemPrompt!.contentHash).toBe(sha256Hex('SECRET-SYSTEM-PROMPT'))
    expect(manifest.skills).toEqual([])
    expect(manifest.tools).toEqual([])
    expect(manifest.outputContract).toBeNull()
    expect(manifest.manifestHash).toBe(firstRow!.manifestHash)
    // manifest 不携带 Prompt 正文
    expect(firstRow!.manifestJson).not.toContain('SECRET-SYSTEM-PROMPT')
  } finally {
    harness.cleanup()
    await rm(harness.directory, { recursive: true, force: true })
  }
})

it('prompt 内容更新传播：资源 revision +1、引用 Agent revision +1、未引用 Agent 不变，旧 Run manifest 不变', async () => {
  const harness = await createManifestApp({ streamFn: textStream('ok') })
  try {
    const admin = await registerAdmin(harness.app, harness.runtime)
    const user = await register(harness.app, `prompt-propagation-${Date.now()}@example.com`)
    const modelRef = seedModel(harness.runtime)
    const referencing = await createEnabledAgent(harness.app, admin.cookie, modelRef, {
      promptContent: 'PROMPT-CONTENT-V1',
      name: 'prompt-reference-agent',
    })
    const unrelated = await createEnabledAgent(harness.app, admin.cookie, modelRef, {
      promptContent: 'OTHER-PROMPT-V1',
      name: 'prompt-unrelated-agent',
    })
    const sessionId = await createSession(harness.app, user.cookie)

    const first = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId: referencing.agentId,
      input: 'first',
    })
    const firstRow = readManifestRow(harness.runtime, first.runId)!

    // 更新引用中 Prompt 的内容
    await putJson(harness.app, `/api/ai/system-prompts/${referencing.promptId}`, admin.cookie, {
      content: 'PROMPT-CONTENT-V2',
    })

    // 资源 revision 链：两行不可变 revision，主表镜像同步
    const promptRevisions = harness.runtime.db
      .select()
      .from(aiSystemPromptRevisions)
      .where(eq(aiSystemPromptRevisions.promptId, referencing.promptId))
      .all()
    expect(promptRevisions.map((row) => row.revision).sort((a, b) => a - b)).toEqual([1, 2])
    const promptRow = harness.runtime.db
      .select()
      .from(aiSystemPrompts)
      .where(eq(aiSystemPrompts.id, referencing.promptId))
      .get()
    expect(promptRow?.currentRevision).toBe(2)
    expect(promptRow?.content).toBe('PROMPT-CONTENT-V2')

    // 引用 Agent 传播：revision +1、记录列刷新；未引用 Agent 不变
    const referencingAgent = harness.runtime.db
      .select()
      .from(aiAgentDefinitions)
      .where(eq(aiAgentDefinitions.id, referencing.agentId))
      .get()
    expect(referencingAgent?.revision).toBe(2)
    expect(referencingAgent?.systemPromptRevision).toBe(2)
    const unrelatedAgent = harness.runtime.db
      .select()
      .from(aiAgentDefinitions)
      .where(eq(aiAgentDefinitions.id, unrelated.agentId))
      .get()
    expect(unrelatedAgent?.revision).toBe(1)
    expect(unrelatedAgent?.systemPromptRevision).toBe(1)

    // 旧 Run manifest 行不变
    const firstRowAfter = readManifestRow(harness.runtime, first.runId)!
    expect(firstRowAfter.manifestHash).toBe(firstRow.manifestHash)
    expect(firstRowAfter.manifestJson).toBe(firstRow.manifestJson)

    // 新 Run 用新 revision 解析，manifest hash 变化
    const second = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId: referencing.agentId,
      input: 'second',
    })
    const secondRow = readManifestRow(harness.runtime, second.runId)!
    expect(secondRow.manifestHash).not.toBe(firstRow.manifestHash)
    const secondManifest = parseManifest(secondRow.manifestJson)
    expect(secondManifest.agentRevision).toBe(2)
    expect(secondManifest.systemPrompt).toMatchObject({ revision: 2, inline: false })
    expect(secondManifest.systemPrompt!.contentHash).toBe(sha256Hex('PROMPT-CONTENT-V2'))
  } finally {
    harness.cleanup()
    await rm(harness.directory, { recursive: true, force: true })
  }
})

it('skill content 或 description 更新都传播：资源 revision +1、引用 Agent revision +1', async () => {
  const harness = await createManifestApp({ streamFn: textStream('ok') })
  try {
    const admin = await registerAdmin(harness.app, harness.runtime)
    const user = await register(harness.app, `skill-propagation-${Date.now()}@example.com`)
    const modelRef = seedModel(harness.runtime)

    const skill = await postJson(harness.app, '/api/ai/skills', admin.cookie, {
      name: `manifest-skill-${Date.now()}`,
      description: 'SKILL-DESCRIPTION-V1',
      content: 'SKILL-CONTENT-V1',
    })
    const skillId = skill.data.id as string
    const { agentId } = await createEnabledAgent(harness.app, admin.cookie, modelRef, {
      skillIds: [skillId],
      name: 'skill-reference-agent',
    })
    const sessionId = await createSession(harness.app, user.cookie)

    const first = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId,
      input: 'first',
    })
    const firstManifest = parseManifest(readManifestRow(harness.runtime, first.runId)!.manifestJson)
    expect(firstManifest.skills).toEqual([{ skillId, revision: 1, contentHash: sha256Hex('SKILL-CONTENT-V1') }])

    // content 更新：资源 revision 2，引用 Agent revision 2
    await putJson(harness.app, `/api/ai/skills/${skillId}`, admin.cookie, { content: 'SKILL-CONTENT-V2' })
    let agentRow = harness.runtime.db.select().from(aiAgentDefinitions).where(eq(aiAgentDefinitions.id, agentId)).get()
    expect(agentRow?.revision).toBe(2)
    expect(agentRow?.skillRevisionsJson).toBe(JSON.stringify({ [skillId]: 2 }))
    let skillRow = harness.runtime.db.select().from(aiSkills).where(eq(aiSkills.id, skillId)).get()
    expect(skillRow?.currentRevision).toBe(2)

    // description 更新同样传播：资源 revision 3（description 进 system prompt 执行输入）
    await putJson(harness.app, `/api/ai/skills/${skillId}`, admin.cookie, {
      description: 'SKILL-DESCRIPTION-V2',
    })
    agentRow = harness.runtime.db.select().from(aiAgentDefinitions).where(eq(aiAgentDefinitions.id, agentId)).get()
    expect(agentRow?.revision).toBe(3)
    expect(agentRow?.skillRevisionsJson).toBe(JSON.stringify({ [skillId]: 3 }))
    skillRow = harness.runtime.db.select().from(aiSkills).where(eq(aiSkills.id, skillId)).get()
    expect(skillRow?.currentRevision).toBe(3)
    const skillRevisions = harness.runtime.db
      .select()
      .from(aiSkillRevisions)
      .where(eq(aiSkillRevisions.skillId, skillId))
      .all()
    expect(skillRevisions.map((row) => row.revision).sort((a, b) => a - b)).toEqual([1, 2, 3])

    // name 更新同样传播：name 拼进 system prompt 的 available_skills 块且
    // read_skill 按 name 查找，属执行输入（资源 revision 4）
    await putJson(harness.app, `/api/ai/skills/${skillId}`, admin.cookie, {
      name: `manifest-skill-renamed-${Date.now()}`,
    })
    agentRow = harness.runtime.db.select().from(aiAgentDefinitions).where(eq(aiAgentDefinitions.id, agentId)).get()
    expect(agentRow?.revision).toBe(4)
    expect(agentRow?.skillRevisionsJson).toBe(JSON.stringify({ [skillId]: 4 }))
    skillRow = harness.runtime.db.select().from(aiSkills).where(eq(aiSkills.id, skillId)).get()
    expect(skillRow?.currentRevision).toBe(4)

    // 新 Run 的 manifest 按 pinned revision 记录
    const second = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId,
      input: 'second',
    })
    const secondManifest = parseManifest(readManifestRow(harness.runtime, second.runId)!.manifestJson)
    expect(secondManifest.agentRevision).toBe(4)
    expect(secondManifest.skills).toEqual([{ skillId, revision: 4, contentHash: sha256Hex('SKILL-CONTENT-V2') }])
  } finally {
    harness.cleanup()
    await rm(harness.directory, { recursive: true, force: true })
  }
})

it('内联配置 Run 的 manifest：inline=true、contentHash 为内联文本 SHA-256、全文不落库', async () => {
  const harness = await createManifestApp({ streamFn: textStream('ok') })
  try {
    const user = await register(harness.app, `inline-manifest-${Date.now()}@example.com`)
    const modelRef = seedModel(harness.runtime)
    const sessionId = await createSession(harness.app, user.cookie)
    const inlineText = 'INLINE-SECRET-SYSTEM-PROMPT'

    const run = await runToCompletion(harness.app, user.cookie, sessionId, {
      input: 'inline',
      config: {
        model: modelRef,
        systemPrompt: inlineText,
        skillIds: [],
        toolRefs: [],
        thinkingLevel: 'off',
        maxTurns: 4,
      },
    })

    const row = readManifestRow(harness.runtime, run.runId)!
    const manifest = parseManifest(row.manifestJson)
    expect(manifest.agentId).toBeNull()
    expect(manifest.agentRevision).toBeNull()
    expect(manifest.systemPrompt).toEqual({
      promptId: null,
      revision: null,
      contentHash: sha256Hex(inlineText),
      inline: true,
    })
    // 内联全文不进 manifest，也不进 Run snapshot
    expect(row.manifestJson).not.toContain(inlineText)
    const runRow = harness.runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, run.runId)).get()
    expect(runRow?.snapshotJson).not.toContain(inlineText)
  } finally {
    harness.cleanup()
    await rm(harness.directory, { recursive: true, force: true })
  }
})

it('manifest 写入失败时 Run 启动失败并释放 lease，不存在无 manifest 的 starting/running Run', async () => {
  const harness = await createManifestApp({ streamFn: textStream('ok') })
  try {
    const admin = await registerAdmin(harness.app, harness.runtime)
    const user = await register(harness.app, `manifest-failure-${Date.now()}@example.com`)
    const modelRef = seedModel(harness.runtime)
    const { agentId } = await createEnabledAgent(harness.app, admin.cookie, modelRef)
    const sessionId = await createSession(harness.app, user.cookie)

    // 触发器强制 manifest 写入失败
    harness.runtime.db.run(
      sql`CREATE TRIGGER fail_manifest_insert BEFORE INSERT ON ai_run_resolved_manifests BEGIN SELECT RAISE(ABORT, 'manifest write failed'); END`,
    )

    const run = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId,
      input: 'will fail',
    })
    const terminal = run.events.at(-1) as { type?: string; data?: { error?: { code?: string } } } | undefined
    expect(terminal?.type).toBe('run.failed')
    expect(terminal?.data?.error?.code).toBe(ApiErrorCodes.AI_SESSION_STORAGE_FAILED)

    // Run 落成 failed 终态，无 manifest 行，无残留 lane lease
    const runRow = harness.runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, run.runId)).get()
    expect(runRow?.status).toBe('failed')
    expect(readManifestRow(harness.runtime, run.runId)).toBeUndefined()
    const leaseRow = harness.runtime.db
      .select()
      .from(aiAgentLaneLeases)
      .where(eq(aiAgentLaneLeases.sessionId, sessionId))
      .get()
    expect(leaseRow).toBeUndefined()

    // 撤掉触发器后同 lane 可以再次启动（两层 lease 已释放）
    harness.runtime.db.run(sql`DROP TRIGGER fail_manifest_insert`)
    const retry = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId,
      input: 'retry',
    })
    const retryTerminal = retry.events.at(-1) as { type?: string } | undefined
    expect(retryTerminal?.type).toBe('run.completed')
    expect(readManifestRow(harness.runtime, retry.runId)).toBeDefined()
  } finally {
    harness.cleanup()
    await rm(harness.directory, { recursive: true, force: true })
  }
})

it('contract 从 registry 移除后，历史 structured output 仍按表内快照渲染', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starter-manifest-contract-'))
  const databasePath = join(directory, 'app.db')
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions.db'),
  })
  const contracts = createAiOutputContractRegistry()
  const contract = contracts.define({
    name: 'manifest.result',
    version: '1.0.0',
    description: 'Manifest result',
    schema: z.object({ result: z.string() }),
    renderKind: 'json',
    visibility: 'product',
    mode: 'optional',
  })
  const first = createTestApp(
    { DATABASE_PATH: databasePath },
    {
      agentSessionStore: store,
      aiOutputContracts: contracts,
      piAgentExecutorFactory: (runtime) =>
        createPiAgentExecutor({
          sessionStore: store,
          resolveModel: () => model,
          streamFn: emitStructuredOutputStream({ result: 'approved' }),
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(runtime.db),
        }),
    },
  )
  let runId = ''
  try {
    const admin = await registerAdmin(first.app, first.runtime)
    const user = await register(first.app, `contract-snapshot-${Date.now()}@example.com`)
    const modelRef = seedModel(first.runtime)
    const agent = await createEnabledAgent(first.app, admin.cookie, modelRef, {
      outputContract: contract.ref,
    })
    const sessionId = await createSession(first.app, user.cookie)
    const run = await runToCompletion(first.app, user.cookie, sessionId, {
      agentId: agent.agentId,
      input: 'emit',
    })
    runId = run.runId
    const outputRow = first.runtime.db
      .select()
      .from(aiStructuredOutputs)
      .where(eq(aiStructuredOutputs.runId, runId))
      .get()
    expect(outputRow).toBeDefined()
    expect(outputRow?.visibility).toBe('product')
    expect(outputRow?.mode).toBe('optional')
    const manifest = parseManifest(readManifestRow(first.runtime, runId)!.manifestJson)
    expect(manifest.outputContract).toEqual({
      name: 'manifest.result',
      version: '1.0.0',
      schemaHash: contract.schemaHash,
    })
  } finally {
    first.cleanup()
  }

  // 第二个进程：同一主库，registry 里没有该 contract，历史输出按表内值渲染
  const secondStore = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, 'agent-sessions-second.db'),
  })
  const second = createTestApp(
    { DATABASE_PATH: databasePath },
    {
      agentSessionStore: secondStore,
      aiOutputContracts: createAiOutputContractRegistry(),
      piAgentExecutorFactory: (runtime) =>
        createPiAgentExecutor({
          sessionStore: secondStore,
          resolveModel: () => model,
          streamFn: textStream('ok'),
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(runtime.db),
        }),
    },
  )
  try {
    const admin = await registerAdmin(second.app, second.runtime)
    const response = await second.app.request(`/api/ai/admin/runs/${runId}/structured-outputs`, {
      headers: { cookie: admin.cookie },
    })
    expect(response.status).toBe(200)
    const body = await readSuccess<{ items: Array<{ contract: Record<string, unknown>; value: unknown }> }>(response)
    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0]!.contract).toMatchObject({
      name: 'manifest.result',
      version: '1.0.0',
      renderKind: 'json',
      visibility: 'product',
      mode: 'optional',
    })
    expect(body.data.items[0]!.value).toEqual({ result: 'approved' })
  } finally {
    second.cleanup()
    await rm(directory, { recursive: true, force: true })
  }
})

it('describeResolvedManifest 读回的 DTO 无 secret、无 Prompt 正文、无 handler 信息', async () => {
  const harness = await createManifestApp({ streamFn: textStream('ok') })
  try {
    const admin = await registerAdmin(harness.app, harness.runtime)
    const user = await register(harness.app, `describe-manifest-${Date.now()}@example.com`)
    const modelRef = seedModel(harness.runtime)
    const promptContent = 'DESCRIBE-SECRET-SYSTEM-PROMPT'
    const { agentId } = await createEnabledAgent(harness.app, admin.cookie, modelRef, {
      promptContent,
    })
    const sessionId = await createSession(harness.app, user.cookie)
    const run = await runToCompletion(harness.app, user.cookie, sessionId, {
      agentId,
      input: 'describe',
    })

    // repository.findByRunId 是 runService.describeResolvedManifest 的实现出口
    const repository = createAiRunResolvedManifestRepository(harness.runtime.db)
    const manifest = repository.findByRunId(run.runId)
    expect(manifest).toBeDefined()
    const serialized = JSON.stringify(manifest)
    expect(serialized).not.toContain(promptContent)
    expect(manifest!.systemPrompt?.contentHash).toBe(sha256Hex(promptContent))
    expect(serialized).not.toContain('execute')
    expect(serialized).not.toContain('inputSchema')
    expect(manifest!.manifestHash).toMatch(/^[a-f0-9]{64}$/u)
  } finally {
    harness.cleanup()
    await rm(harness.directory, { recursive: true, force: true })
  }
})

it('tool manifestHash 稳定：相同定义重复注册 hash 不变，定义变化 hash 变化', () => {
  const definition = {
    name: 'manifest_probe',
    version: '1.0.0',
    description: 'Probe tool',
    inputSchema: z.object({ value: z.string() }),
    timeoutMs: 1000,
    scope: 'platform' as const,
    requiredPermission: null,
    execute: async () => ({ modelText: 'ok', safeSummary: null }),
  }
  const first = defineAiTool(definition)
  const second = defineAiTool(definition)
  expect(first.manifestHash).toBe(second.manifestHash)
  expect(first.manifestHash).toMatch(/^[a-f0-9]{64}$/u)
  const changed = defineAiTool({ ...definition, description: 'Probe tool v2' })
  expect(changed.manifestHash).not.toBe(first.manifestHash)
})
