import {
  ApiErrorCodes,
  executableAgentInputSchema,
  executableJsonObjectSchema,
  executableManifestListSchema,
  executableManifestV1Schema,
  startAgentRunSchema,
  type ExecutableManifestV1,
} from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createPiAgentExecutor } from '@api/infra/agent/index.js'
import { aiAgentDefinitions, aiAgentLaneLeases, aiAgentRuns, aiRunAttempts } from '@api/infra/db/schema/index.js'
import { createAuthorizationRepository } from '@api/modules/authorization/index.js'
import { toExecutableManifestV1 } from '@api/modules/ai/agent/executable-manifest.presenter.js'
import type { ResolvedAgentDefinition } from '@api/modules/ai/agent/agent.service.js'
import { createAiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'
import { createAiRunLifecycleRepository } from '@api/modules/ai/run/index.js'
import { createAiToolRegistry, defineAiTool, type RegisteredAiTool } from '@api/modules/ai/tool/tool-registry.js'
import { generateId } from '@api/shared/id.js'

import { assistantMessage, seedAgent, seedEnabledModel, streamAssistant, streamModel } from './ai-run-harness.js'
import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

const adminActor = {
  actorType: 'system' as const,
  actorId: 'test:executable-manifest',
  requestId: null,
}

it('manifest presenter 的 hash 包含 Tool 定义，但不返回内部执行事实', () => {
  const id = generateId()
  const promptId = generateId()
  const firstTool = manifestTool('First tool definition')
  const changedTool = manifestTool('Changed tool definition')
  const definition = { id, name: 'Manifest Agent', description: '公开说明' }
  const first = toExecutableManifestV1(definition, resolvedAgent(id, promptId, [firstTool]))
  const repeated = toExecutableManifestV1(
    { ...definition, name: 'Renamed Agent', description: '修改后的公开说明' },
    resolvedAgent(id, promptId, [firstTool]),
  )
  const toolChanged = toExecutableManifestV1(definition, resolvedAgent(id, promptId, [changedTool]))
  const noTools = toExecutableManifestV1(definition, resolvedAgent(id, promptId, []))

  expect(first.manifestHash).toBe(repeated.manifestHash)
  expect(first.manifestHash).not.toBe(toolChanged.manifestHash)
  expect(first.sideEffect).toBe('non_idempotent_write')
  expect(noTools.sideEffect).toBe('read_only')
  expect(executableManifestV1Schema.safeParse(first).success).toBe(true)
  expect(executableManifestV1Schema.safeParse({ ...first, model: streamModel.id }).success).toBe(false)
  expect(executableAgentInputSchema.safeParse({ input: 'hello', agentId: id }).success).toBe(false)
  expect(executableJsonObjectSchema.safeParse({ invalid: undefined }).success).toBe(false)

  const serialized = JSON.stringify(first)
  expect(serialized).not.toContain('SECRET-SYSTEM-PROMPT')
  expect(serialized).not.toContain(streamModel.provider)
  expect(serialized).not.toContain(streamModel.id)
  expect(serialized).not.toContain(firstTool.name)
  expect(serialized).not.toContain('contentHash')
  expect(serialized).not.toContain(`manifestHash":"${firstTool.manifestHash}`)
})

it('cookie 与 Bearer 只能发现当前 enabled Manifest，schema 和 hash 传播符合执行事实', async () => {
  const contractRegistry = createAiOutputContractRegistry()
  const outputContract = contractRegistry.define({
    name: 'manifest.result',
    version: '1.0.0',
    description: 'Manifest result',
    schema: z.strictObject({ result: z.string() }),
    renderKind: 'json',
    visibility: 'admin',
    mode: 'required',
  })
  const tool = manifestTool('Execute a non-idempotent write')
  const test = createExecutableTestApp(createAiToolRegistry([tool]), contractRegistry)

  try {
    const admin = await registerAdmin(test, 'executable-admin@example.com')
    const user = await register(test.app, 'executable-user@example.com')
    const published = await createPublishedAgent(test, admin.cookie, {
      name: 'Published Agent',
      description: '公开说明',
      tool,
      outputContract,
    })
    const draft = await createDraftAgent(test, admin.cookie, 'Draft Agent')
    const disabled = await createDraftAgent(test, admin.cookie, 'Disabled Agent')
    expect(
      (await patchJson(test.app, `/api/ai/admin/agents/${disabled}/status`, admin.cookie, { status: 'disabled' }))
        .status,
    ).toBe(200)
    const credential = await createApplication(test, admin.cookie)
    const bearerHeaders = {
      Authorization: `Bearer ${credential.secret}`,
      'X-AI-External-User-Id': 'customer-1',
    }

    expect((await test.app.request('/api/ai/executables')).status).toBe(401)
    const cookieListResponse = await test.app.request('/api/ai/executables?page=1&pageSize=1', {
      headers: { cookie: user.cookie },
    })
    expect(cookieListResponse.status).toBe(200)
    const cookieList = executableManifestListSchema.parse((await readSuccess<unknown>(cookieListResponse)).data)
    expect(cookieList).toMatchObject({ total: 1, page: 1, pageSize: 1 })
    expect(cookieList.items).toHaveLength(1)
    expect(cookieList.items[0]?.id).toBe(published.agentId)

    const bearerDetailResponse = await test.app.request(`/api/ai/executables/${published.agentId}`, {
      headers: bearerHeaders,
    })
    expect(bearerDetailResponse.status).toBe(200)
    const initial = executableManifestV1Schema.parse((await readSuccess<unknown>(bearerDetailResponse)).data)
    expect(initial).toMatchObject({
      manifestSchemaVersion: 1,
      kind: 'agent',
      id: published.agentId,
      version: 1,
      name: 'Published Agent',
      description: '公开说明',
      eventProtocolVersion: 1,
      controls: ['abort', 'steer', 'follow_up'],
      sideEffect: 'non_idempotent_write',
      inputSchema: {
        type: 'object',
        required: ['input'],
        additionalProperties: false,
        properties: {
          input: expect.any(Object),
          lane: expect.any(Object),
          idempotencyKey: expect.any(Object),
          attachmentIds: expect.any(Object),
        },
      },
      output: {
        contract: outputContract.ref,
        schema: {
          type: 'object',
          required: ['result'],
          additionalProperties: false,
          properties: { result: { type: 'string' } },
        },
      },
    })
    expect(Object.keys(initial.inputSchema)).not.toContain('agentId')
    expect(Object.keys(initial.inputSchema)).not.toContain('config')
    expect(Object.keys(initial.inputSchema)).not.toContain('expectedAgentRevision')
    expect(Object.keys(initial).sort()).toEqual(
      [
        'controls',
        'description',
        'eventProtocolVersion',
        'id',
        'inputSchema',
        'kind',
        'manifestHash',
        'manifestSchemaVersion',
        'name',
        'output',
        'sideEffect',
        'version',
      ].sort(),
    )
    const repeated = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(repeated.manifestHash).toBe(initial.manifestHash)

    expect((await test.app.request(`/api/ai/executables/${draft}`, { headers: bearerHeaders })).status).toBe(404)
    expect((await test.app.request(`/api/ai/executables/${disabled}`, { headers: bearerHeaders })).status).toBe(404)

    const publicJson = JSON.stringify(initial)
    for (const hidden of [
      published.promptContent,
      published.skillContent,
      streamModel.provider,
      streamModel.id,
      tool.name,
      'contentHash',
      'providerId',
      'modelId',
      'toolRefs',
      'timeoutMs',
      'execute',
    ]) {
      expect(publicJson).not.toContain(hidden)
    }

    const displayUpdate = await patchJson(test.app, `/api/ai/admin/agents/${published.agentId}`, admin.cookie, {
      name: 'Renamed Published Agent',
      description: '只改展示字段',
    })
    expect(displayUpdate.status).toBe(200)
    const afterDisplay = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(afterDisplay).toMatchObject({
      name: 'Renamed Published Agent',
      description: '只改展示字段',
      version: initial.version,
      manifestHash: initial.manifestHash,
    })

    const configUpdate = await patchJson(test.app, `/api/ai/admin/agents/${published.agentId}`, admin.cookie, {
      config: { ...published.config, maxTurns: 9 },
    })
    expect(configUpdate.status).toBe(200)
    const afterConfig = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(afterConfig.version).toBe(initial.version + 1)
    expect(afterConfig.manifestHash).not.toBe(initial.manifestHash)

    const promptUpdate = await putJson(test.app, `/api/ai/system-prompts/${published.promptId}`, admin.cookie, {
      content: 'UPDATED-SECRET-SYSTEM-PROMPT',
    })
    expect(promptUpdate.status).toBe(200)
    const afterPrompt = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(afterPrompt.version).toBe(afterConfig.version + 1)
    expect(afterPrompt.manifestHash).not.toBe(afterConfig.manifestHash)

    const skillUpdate = await putJson(test.app, `/api/ai/skills/${published.skillId}`, admin.cookie, {
      content: 'UPDATED-SECRET-SKILL-CONTENT',
    })
    expect(skillUpdate.status).toBe(200)
    const afterSkill = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(afterSkill.version).toBe(afterPrompt.version + 1)
    expect(afterSkill.manifestHash).not.toBe(afterPrompt.manifestHash)

    const skillNameUpdate = await putJson(test.app, `/api/ai/skills/${published.skillId}`, admin.cookie, {
      name: 'renamed-published-skill',
    })
    expect(skillNameUpdate.status).toBe(200)
    const afterSkillName = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(afterSkillName.version).toBe(afterSkill.version + 1)
    expect(afterSkillName.manifestHash).not.toBe(afterSkill.manifestHash)

    const skillDescriptionUpdate = await putJson(test.app, `/api/ai/skills/${published.skillId}`, admin.cookie, {
      description: '更新后的 Manifest skill',
    })
    expect(skillDescriptionUpdate.status).toBe(200)
    const afterSkillDescription = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(afterSkillDescription.version).toBe(afterSkillName.version + 1)
    expect(afterSkillDescription.manifestHash).not.toBe(afterSkillName.manifestHash)

    const outputContractV2 = contractRegistry.define({
      name: 'manifest.result',
      version: '2.0.0',
      description: 'Manifest result v2',
      schema: z.strictObject({ result: z.number() }),
      renderKind: 'json',
      visibility: 'admin',
      mode: 'required',
    })
    const outputContractUpdate = await patchJson(test.app, `/api/ai/admin/agents/${published.agentId}`, admin.cookie, {
      config: { ...published.config, outputContract: outputContractV2.ref },
    })
    expect(outputContractUpdate.status).toBe(200)
    const afterOutputContract = await getManifest(test, published.agentId, { cookie: user.cookie })
    expect(afterOutputContract.version).toBe(afterSkillDescription.version + 1)
    expect(afterOutputContract.manifestHash).not.toBe(afterSkillDescription.manifestHash)
    expect(afterOutputContract.output).toMatchObject({
      contract: outputContractV2.ref,
      schema: {
        type: 'object',
        required: ['result'],
        additionalProperties: false,
        properties: { result: { type: 'number' } },
      },
    })

    const document = (await (await test.app.request('/doc')).json()) as {
      paths: Record<
        string,
        {
          get?: { security?: Array<Record<string, string[]>> }
          post?: {
            requestBody?: {
              content?: Record<
                string,
                { schema?: { properties?: Record<string, { type?: string; minimum?: number }> } }
              >
            }
          }
        }
      >
    }
    expect(document.paths['/api/ai/executables']?.get?.security).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }])
    expect(document.paths['/api/ai/executables/{executableId}']?.get?.security).toEqual([
      { cookieAuth: [] },
      { bearerAuth: [] },
    ])
    const startRunOperation = document.paths['/api/ai/sessions/{sessionId}/runs']?.post
    const startRunContent = startRunOperation?.requestBody?.content?.['application/json']
    expect(startRunContent?.schema?.properties?.expectedAgentRevision).toMatchObject({ type: 'integer', minimum: 1 })

    test.runtime.db
      .update(aiAgentDefinitions)
      .set({ configJson: JSON.stringify({ ...published.config, model: null }) })
      .where(eq(aiAgentDefinitions.id, published.agentId))
      .run()
    const invalid = await test.app.request(`/api/ai/executables/${published.agentId}`, {
      headers: { cookie: user.cookie },
    })
    expect(invalid.status).toBe(400)
    expect((await readFailure(invalid)).error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)
  } finally {
    test.cleanup()
  }
})

it('expectedAgentRevision 在附件、幂等和 lane lease 前校验，旧请求仍执行当前 revision', async () => {
  const test = createExecutableTestApp(createAiToolRegistry([]), createAiOutputContractRegistry())
  try {
    const agentId = seedAgent(test.runtime, [])
    const user = await register(test.app, 'expected-revision@example.com')
    const sessionId = await createSession(test, user.cookie, agentId)

    for (const body of [
      { expectedAgentRevision: 1, input: 'default agent is not explicit' },
      {
        expectedAgentRevision: 1,
        input: 'inline config is not allowed',
        config: { model: { providerId: streamModel.provider, modelId: streamModel.id }, systemPrompt: 'inline' },
      },
      { agentId, expectedAgentRevision: 0, input: 'invalid revision' },
    ]) {
      const response = await startRun(test, user.cookie, sessionId, body)
      expect(response.status).toBe(400)
      expect((await readFailure(response)).error.code).toBe(ApiErrorCodes.COMMON_INVALID_REQUEST)
    }

    expect(
      startAgentRunSchema.safeParse({ agentId, expectedAgentRevision: 1, config: {}, input: 'invalid combination' })
        .success,
    ).toBe(false)

    const idempotencyKey = 'revision-check-001'
    const conflict = await startRun(test, user.cookie, sessionId, {
      agentId,
      expectedAgentRevision: 2,
      input: 'must fail before attachment lookup',
      attachmentIds: [generateId()],
      idempotencyKey,
    })
    expect(conflict.status).toBe(409)
    expect((await readFailure(conflict)).error.code).toBe(ApiErrorCodes.AI_AGENT_REVISION_CONFLICT)
    expect(test.runtime.db.select().from(aiAgentRuns).all()).toHaveLength(0)
    expect(test.runtime.db.select().from(aiRunAttempts).all()).toHaveLength(0)
    expect(test.runtime.db.select().from(aiAgentLaneLeases).all()).toHaveLength(0)
    const leaseProbe = test.runtime.activeRunRegistry.reserve(sessionId, 'main')
    test.runtime.activeRunRegistry.release(leaseProbe)

    const matched = await startRun(test, user.cookie, sessionId, {
      agentId,
      expectedAgentRevision: 1,
      input: 'matching revision',
      idempotencyKey,
    })
    expect(matched.status, await matched.clone().text()).toBe(200)
    const matchedRunId = (await readSuccess<{ runId: string }>(matched)).data.runId
    await waitForTerminal(test, matchedRunId)
    expect(test.runtime.db.select().from(aiAgentRuns).all()).toHaveLength(1)

    test.runtime.db
      .update(aiAgentDefinitions)
      .set({ revision: 2, updatedAt: new Date() })
      .where(eq(aiAgentDefinitions.id, agentId))
      .run()
    const staleReplay = await startRun(test, user.cookie, sessionId, {
      agentId,
      expectedAgentRevision: 1,
      input: 'must not replay old idempotent run',
      idempotencyKey,
    })
    expect(staleReplay.status).toBe(409)
    expect((await readFailure(staleReplay)).error.code).toBe(ApiErrorCodes.AI_AGENT_REVISION_CONFLICT)
    expect(test.runtime.db.select().from(aiAgentRuns).all()).toHaveLength(1)

    const oldClient = await startRun(test, user.cookie, sessionId, {
      agentId,
      input: 'no expected revision',
    })
    expect(oldClient.status, await oldClient.clone().text()).toBe(200)
    const oldClientRunId = (await readSuccess<{ runId: string }>(oldClient)).data.runId
    await waitForTerminal(test, oldClientRunId)
    expect(test.runtime.db.select().from(aiAgentRuns).all()).toHaveLength(2)
  } finally {
    test.cleanup()
  }
})

function manifestTool(description: string): RegisteredAiTool {
  return defineAiTool({
    name: 'manifest_write',
    version: '1.0.0',
    description,
    inputSchema: z.strictObject({ value: z.string() }),
    timeoutMs: 1000,
    scope: 'platform',
    sideEffect: 'non_idempotent_write',
    requiredPermission: null,
    async execute() {
      return { modelText: 'done', safeSummary: 'done' }
    },
  })
}

function resolvedAgent(id: string, promptId: string, tools: RegisteredAiTool[]): ResolvedAgentDefinition {
  return {
    id,
    revision: 1,
    config: {
      schemaVersion: 2,
      model: { providerId: streamModel.provider, modelId: streamModel.id },
      systemPromptId: promptId,
      skillIds: [],
      toolRefs: tools.map(({ name, version }) => ({ name, version })),
      outputContract: null,
      outputMode: 'optional',
      thinkingLevel: 'off',
      maxTurns: 8,
    },
    model: { providerId: streamModel.provider, modelId: streamModel.id },
    systemPrompt: 'SECRET-SYSTEM-PROMPT',
    skills: [],
    tools,
    outputContract: null,
    thinkingLevel: 'off',
    maxTurns: 8,
    manifestFacts: {
      systemPrompt: { promptId, revision: 1, contentHash: 'a'.repeat(64), inline: false },
      skills: [],
    },
  }
}

function createExecutableTestApp(
  tools: ReturnType<typeof createAiToolRegistry>,
  outputContracts: ReturnType<typeof createAiOutputContractRegistry>,
) {
  const test = createTestApp(
    {},
    {
      aiTools: tools,
      aiOutputContracts: outputContracts,
      piAgentExecutorFactory: (runtime) =>
        createPiAgentExecutor({
          sessionStore: runtime.agentSessionStore,
          resolveModel: () => streamModel,
          streamFn: () => streamAssistant(assistantMessage([{ type: 'text', text: 'done' }], 'stop'), 'stop'),
          hasPermission: async () => true,
          lifecycle: createAiRunLifecycleRepository(runtime.db),
        }),
    },
  )
  seedEnabledModel(test.runtime)
  return test
}

async function registerAdmin(test: ReturnType<typeof createTestApp>, email: string) {
  const admin = await register(test.app, email)
  expect(createAuthorizationRepository(test.runtime.db).bootstrapAdminByEmail(email, adminActor).kind).toBe('ok')
  return admin
}

async function createPublishedAgent(
  test: ReturnType<typeof createTestApp>,
  cookie: string,
  input: {
    name: string
    description: string
    tool: RegisteredAiTool
    outputContract: ReturnType<ReturnType<typeof createAiOutputContractRegistry>['define']>
  },
) {
  const promptContent = 'SECRET-PUBLISHED-SYSTEM-PROMPT'
  const skillContent = 'SECRET-PUBLISHED-SKILL-CONTENT'
  const prompt = await postJson(test.app, '/api/ai/system-prompts', cookie, {
    name: 'published-prompt',
    content: promptContent,
  })
  expect(prompt.status).toBe(200)
  const promptId = (await readSuccess<{ id: string }>(prompt)).data.id
  const skill = await postJson(test.app, '/api/ai/skills', cookie, {
    name: 'published-skill',
    description: 'Manifest skill',
    content: skillContent,
  })
  expect(skill.status).toBe(200)
  const skillId = (await readSuccess<{ id: string }>(skill)).data.id
  const config = {
    schemaVersion: 2 as const,
    model: { providerId: streamModel.provider, modelId: streamModel.id },
    systemPromptId: promptId,
    skillIds: [skillId],
    toolRefs: [{ name: input.tool.name, version: input.tool.version }],
    outputContract: input.outputContract.ref,
    outputMode: 'required' as const,
    thinkingLevel: 'medium' as const,
    maxTurns: 8,
    retryPolicy: { maxAttempts: 2 },
  }
  const created = await postJson(test.app, '/api/ai/admin/agents', cookie, {
    name: input.name,
    description: input.description,
    config,
  })
  expect(created.status).toBe(200)
  const agentId = (await readSuccess<{ id: string }>(created)).data.id
  const enabled = await patchJson(test.app, `/api/ai/admin/agents/${agentId}/status`, cookie, {
    status: 'enabled',
  })
  expect(enabled.status).toBe(200)
  return { agentId, promptId, skillId, promptContent, skillContent, config }
}

async function createDraftAgent(test: ReturnType<typeof createTestApp>, cookie: string, name: string): Promise<string> {
  const response = await postJson(test.app, '/api/ai/admin/agents', cookie, { name })
  expect(response.status).toBe(200)
  return (await readSuccess<{ id: string }>(response)).data.id
}

async function createApplication(test: ReturnType<typeof createTestApp>, cookie: string) {
  const response = await postJson(test.app, '/api/ai/admin/applications', cookie, {
    name: 'Manifest Product',
    tenantId: 'tenant-a',
    projectId: 'project-a',
  })
  expect(response.status).toBe(200)
  return (await readSuccess<{ secret: string }>(response)).data
}

async function getManifest(
  test: ReturnType<typeof createTestApp>,
  agentId: string,
  headers: Record<string, string>,
): Promise<ExecutableManifestV1> {
  const response = await test.app.request(`/api/ai/executables/${agentId}`, { headers })
  expect(response.status, await response.clone().text()).toBe(200)
  return executableManifestV1Schema.parse((await readSuccess<unknown>(response)).data)
}

async function createSession(test: ReturnType<typeof createTestApp>, cookie: string, defaultAgentId: string) {
  const response = await postJson(test.app, '/api/ai/sessions', cookie, {
    title: 'Expected revision',
    defaultAgentId,
  })
  expect(response.status).toBe(200)
  return (await readSuccess<{ id: string }>(response)).data.id
}

function startRun(
  test: ReturnType<typeof createTestApp>,
  cookie: string,
  sessionId: string,
  body: Record<string, unknown>,
) {
  return test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
}

async function waitForTerminal(test: ReturnType<typeof createTestApp>, runId: string): Promise<void> {
  await vi.waitFor(() => {
    const run = test.runtime.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
    expect(run?.status).toMatch(/^(completed|failed|aborted|interrupted)$/u)
  })
}

function postJson(
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

function putJson(
  app: ReturnType<typeof createTestApp>['app'],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchJson(
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
