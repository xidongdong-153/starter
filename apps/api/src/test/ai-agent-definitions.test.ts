import { ApiErrorCodes } from '@starter/contracts'
import { z } from 'zod'

import { createAiToolRegistry, defineAiTool } from '@api/modules/ai/tool/tool-registry.js'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'

import {
  aiEnabledModels,
  aiProviderConfigs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@api/infra/db/schema/index.js'

import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

it('agentDefinition CRUD、revision、状态和公开边界可用', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await registerAdmin(app, runtime)
    const user = await register(app, 'agent-public@example.com')

    expect((await app.request('/api/ai/agents')).status).toBe(401)
    expect(
      (
        await app.request('/api/ai/admin/agents', {
          headers: { cookie: user.cookie },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await postJson(app, '/api/ai/admin/agents', '', {
          name: 'unauthenticated',
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await postJson(app, '/api/ai/admin/agents', user.cookie, {
          name: 'forbidden',
        })
      ).status,
    ).toBe(403)

    const empty = await app.request('/api/ai/admin/agents', {
      headers: { cookie: admin.cookie },
    })
    expect(empty.status).toBe(200)
    expect((await readSuccess<{ items: unknown[]; total: number }>(empty)).data).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    const created = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
      name: 'Draft Agent',
      description: '先保存一个草稿',
    })
    expect(created.status).toBe(200)
    const createdBody = await readSuccess<{
      id: string
      status: string
      revision: number
      config: Record<string, unknown>
    }>(created)
    expect(createdBody.data).toMatchObject({
      name: 'Draft Agent',
      status: 'draft',
      revision: 1,
      config: {
        schemaVersion: 2,
        model: null,
        systemPromptId: null,
        skillIds: [],
        toolRefs: [],
        thinkingLevel: 'off',
        maxTurns: 8,
      },
    })
    expect(JSON.stringify(createdBody.data)).not.toContain('secret')

    const duplicate = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
      name: 'Draft Agent',
    })
    expect(duplicate.status).toBe(409)
    expect((await readFailure(duplicate)).error.code).toBe(ApiErrorCodes.AI_AGENT_NAME_CONFLICT)

    const renamed = await patchJson(app, `/api/ai/admin/agents/${createdBody.data.id}`, admin.cookie, {
      description: '只改展示字段',
    })
    expect(renamed.status).toBe(200)
    expect((await readSuccess<{ revision: number }>(renamed)).data.revision).toBe(1)

    const model = seedModel(runtime)
    const prompt = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
      name: 'agent-system-prompt',
      content: '只返回事实。',
    })
    const promptBody = await readSuccess<{ id: string }>(prompt)
    const skill = await postJson(app, '/api/ai/skills', admin.cookie, {
      name: 'agent-skill',
      description: 'Agent 测试技能',
      content: '技能正文不进入 Agent DTO。',
    })
    const skillBody = await readSuccess<{ id: string }>(skill)

    const configured = await patchJson(app, `/api/ai/admin/agents/${createdBody.data.id}`, admin.cookie, {
      config: {
        schemaVersion: 2,
        model,
        systemPromptId: promptBody.data.id,
        skillIds: [skillBody.data.id],
        toolRefs: [{ name: 'read_skill', version: '1.0.0' }],
        thinkingLevel: 'medium',
        maxTurns: 12,
      },
    })
    expect(configured.status).toBe(200)
    expect((await readSuccess<{ revision: number }>(configured)).data.revision).toBe(2)

    const sameConfigDifferentObjectOrder = await patchJson(
      app,
      `/api/ai/admin/agents/${createdBody.data.id}`,
      admin.cookie,
      {
        config: {
          maxTurns: 12,
          thinkingLevel: 'medium',
          toolRefs: [{ name: 'read_skill', version: '1.0.0' }],
          skillIds: [skillBody.data.id],
          systemPromptId: promptBody.data.id,
          model,
          schemaVersion: 2,
        },
      },
    )
    expect(sameConfigDifferentObjectOrder.status).toBe(200)
    expect((await readSuccess<{ revision: number }>(sameConfigDifferentObjectOrder)).data.revision).toBe(2)

    const concurrentUpdates = await Promise.all([
      patchJson(app, `/api/ai/admin/agents/${createdBody.data.id}`, admin.cookie, {
        config: {
          schemaVersion: 2,
          model,
          systemPromptId: promptBody.data.id,
          skillIds: [skillBody.data.id],
          toolRefs: [{ name: 'read_skill', version: '1.0.0' }],
          thinkingLevel: 'medium',
          maxTurns: 13,
        },
      }),
      patchJson(app, `/api/ai/admin/agents/${createdBody.data.id}`, admin.cookie, {
        config: {
          schemaVersion: 2,
          model,
          systemPromptId: promptBody.data.id,
          skillIds: [skillBody.data.id],
          toolRefs: [{ name: 'read_skill', version: '1.0.0' }],
          thinkingLevel: 'medium',
          maxTurns: 14,
        },
      }),
    ])
    expect(concurrentUpdates.map((response) => response.status)).toEqual([200, 200])
    const afterConcurrentUpdates = await app.request(`/api/ai/admin/agents/${createdBody.data.id}`, {
      headers: { cookie: admin.cookie },
    })
    expect((await readSuccess<{ revision: number }>(afterConcurrentUpdates)).data.revision).toBe(4)

    const enabled = await patchJson(app, `/api/ai/admin/agents/${createdBody.data.id}/status`, admin.cookie, {
      status: 'enabled',
    })
    expect(enabled.status).toBe(200)
    expect((await readSuccess<{ revision: number }>(enabled)).data.revision).toBe(4)

    const publicList = await app.request('/api/ai/agents', {
      headers: { cookie: user.cookie },
    })
    expect(publicList.status).toBe(200)
    const publicBody = await readSuccess<{
      items: Array<Record<string, unknown>>
    }>(publicList)
    expect(publicBody.data.items).toHaveLength(1)
    expect(publicBody.data.items[0]).not.toHaveProperty('config')
    expect(publicBody.data.items[0]).not.toHaveProperty('createdBy')

    const publicDetail = await app.request(`/api/ai/agents/${createdBody.data.id}`, {
      headers: { cookie: user.cookie },
    })
    expect(publicDetail.status).toBe(200)
    expect((await readSuccess<Record<string, unknown>>(publicDetail)).data).not.toHaveProperty('config')

    const disabled = await patchJson(app, `/api/ai/admin/agents/${createdBody.data.id}/status`, admin.cookie, {
      status: 'disabled',
    })
    expect(disabled.status).toBe(200)
    expect((await readSuccess<{ revision: number }>(disabled)).data.revision).toBe(4)
    const publicAfterDisable = await app.request('/api/ai/agents', {
      headers: { cookie: user.cookie },
    })
    expect((await readSuccess<{ items: unknown[] }>(publicAfterDisable)).data.items).toHaveLength(0)

    const publicDraft = await app.request(`/api/ai/agents/${createdBody.data.id}`, { headers: { cookie: user.cookie } })
    expect(publicDraft.status).toBe(404)
  } finally {
    cleanup()
  }
})

it('agentDefinition 拒绝无效资源，并阻止被引用的 System Prompt 删除', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await registerAdmin(app, runtime)
    const model = seedModel(runtime)
    const prompt = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
      name: 'agent-referenced-prompt',
      content: '不能删除。',
    })
    const promptBody = await readSuccess<{ id: string }>(prompt)

    for (const [name, config] of [
      ['invalid-model', { model: { providerId: 'openai', modelId: 'missing-model' } }],
      ['invalid-prompt', { model, systemPromptId: '01900000-0000-7000-8000-000000000001' }],
      [
        'invalid-tool',
        {
          model,
          systemPromptId: promptBody.data.id,
          toolRefs: [{ name: 'missing_tool', version: '1.0.0' }],
        },
      ],
    ] as const) {
      const response = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
        name,
        config: {
          schemaVersion: 2,
          model: config.model,
          systemPromptId: config.systemPromptId ?? null,
          skillIds: [],
          toolRefs: config.toolRefs ?? [],
          thinkingLevel: 'off',
          maxTurns: 8,
        },
      })
      expect(response.status).toBe(400)
      expect((await readFailure(response)).error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)
    }

    const disabledSkill = await postJson(app, '/api/ai/skills', admin.cookie, {
      name: 'agent-disabled-skill',
      description: '已停用技能',
      content: '不能被 Agent 引用。',
      enabled: false,
    })
    const disabledSkillBody = await readSuccess<{ id: string }>(disabledSkill)
    const invalidSkill = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
      name: 'invalid-skill',
      config: {
        schemaVersion: 2,
        model,
        systemPromptId: promptBody.data.id,
        skillIds: [disabledSkillBody.data.id],
        toolRefs: [],
        thinkingLevel: 'off',
        maxTurns: 8,
      },
    })
    expect(invalidSkill.status).toBe(400)
    expect((await readFailure(invalidSkill)).error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)

    const referenced = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
      name: 'references-prompt',
      config: {
        schemaVersion: 2,
        model,
        systemPromptId: promptBody.data.id,
        skillIds: [],
        toolRefs: [],
        thinkingLevel: 'off',
        maxTurns: 8,
      },
    })
    expect(referenced.status).toBe(200)

    const deleted = await app.request(`/api/ai/system-prompts/${promptBody.data.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    })
    expect(deleted.status).toBe(409)
    expect((await readFailure(deleted)).error.code).toBe(ApiErrorCodes.AI_PROMPT_REFERENCED)

    const draft = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
      name: 'incomplete-draft',
    })
    const draftBody = await readSuccess<{ id: string }>(draft)
    const enableIncomplete = await patchJson(app, `/api/ai/admin/agents/${draftBody.data.id}/status`, admin.cookie, {
      status: 'enabled',
    })
    expect(enableIncomplete.status).toBe(400)
    expect((await readFailure(enableIncomplete)).error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)
  } finally {
    cleanup()
  }
})

it('同一个 Agent 不能引用同名不同版本的 Tool，返回稳定配置错误', async () => {
  const lookupV1 = defineAiTool({
    name: 'lookup',
    version: '1.0.0',
    description: 'Lookup v1',
    inputSchema: z.object({}),
    timeoutMs: 1000,
    scope: 'platform',
    requiredPermission: null,
    async execute() {
      return { modelText: 'v1', safeSummary: null }
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
      return { modelText: 'v2', safeSummary: null }
    },
  })
  const { app, cleanup, runtime } = createTestApp({}, { aiTools: createAiToolRegistry([lookupV1, lookupV2]) })
  try {
    const admin = await registerAdmin(app, runtime)
    const model = seedModel(runtime)
    const prompt = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
      name: 'same-name-tool-prompt',
      content: '只返回事实。',
    })
    const promptBody = await readSuccess<{ id: string }>(prompt)

    const response = await postJson(app, '/api/ai/admin/agents', admin.cookie, {
      name: 'same-name-tool-agent',
      config: {
        schemaVersion: 2,
        model,
        systemPromptId: promptBody.data.id,
        skillIds: [],
        toolRefs: [
          { name: 'lookup', version: '1.0.0' },
          { name: 'lookup', version: '2.0.0' },
        ],
        thinkingLevel: 'off',
        maxTurns: 8,
      },
    })
    expect(response.status).toBe(400)
    const failure = await readFailure(response)
    expect(failure.error.code).toBe(ApiErrorCodes.AI_AGENT_CONFIG_INVALID)
    expect(failure.error.details).toEqual({
      resource: 'tool',
    })
  } finally {
    cleanup()
  }
})

it('agent 工具列表只返回名称和描述，不返回 schema 或 handler', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await registerAdmin(app, runtime)
    const response = await app.request('/api/ai/admin/tools', {
      headers: { cookie: admin.cookie },
    })
    expect(response.status).toBe(200)
    const body = await readSuccess<Array<Record<string, unknown>>>(response)
    expect(body.data.some((tool) => tool.name === 'read_skill')).toBe(true)
    for (const tool of body.data) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'name', 'scope', 'version'])
      expect(tool).not.toHaveProperty('inputSchema')
      expect(tool).not.toHaveProperty('execute')
    }
  } finally {
    cleanup()
  }
})

async function registerAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
) {
  const owner = await register(app, `agent-admin-${Date.now()}@example.com`)
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

function seedModel(runtime: ReturnType<typeof createTestApp>['runtime']): {
  providerId: string
  modelId: string
} {
  const model = runtime.ai.listModels('openai')[0]
  if (!model) throw new Error('测试模型目录为空')
  const now = new Date()
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: model.providerId,
      enabled: true,
      configRevision: 0,
      checkedConfigRevision: 0,
      authStatus: 'ready',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  runtime.db
    .insert(aiEnabledModels)
    .values({
      providerId: model.providerId,
      modelId: model.modelId,
      enabledAt: now,
    })
    .run()
  return { providerId: model.providerId, modelId: model.modelId }
}
