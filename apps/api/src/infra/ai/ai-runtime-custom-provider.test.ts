import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'

import { customAiProviderDefinitionSchema } from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'

import { AiRuntimeError, createAiCrypto, createAiRuntime } from '@api/infra/ai/index.js'
import { aiCustomProviders, aiProviderConfigs } from '@api/infra/db/schema/index.js'
import { parseBoundedJson } from '@api/shared/bounded-json.js'

import { createTestApp } from '../../test/helpers.js'

const model = {
  modelId: 'first-model',
  name: 'First Model',
  contextWindow: 8_000,
  maxOutputTokens: 1_024,
  supportsImageInput: false,
  supportsReasoning: false,
  supportsTools: false,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheWriteCost: 0,
}

function definition(baseUrl: string, modelId = model.modelId) {
  return customAiProviderDefinitionSchema.parse({
    providerId: 'runtime-custom',
    name: 'Runtime Custom',
    protocol: 'openai-completions',
    baseUrl,
    compat: {},
    models: [{ ...model, modelId }],
  })
}

it('runtime 启动恢复、热加载、卸载和新实例恢复使用同一数据库 definition', async () => {
  const { cleanup, runtime } = createTestApp()
  try {
    const now = new Date()
    const baseUrl = 'http://localhost:11434/v1'
    runtime.db
      .insert(aiCustomProviders)
      .values({
        providerId: 'runtime-custom',
        definitionJson: JSON.stringify(definition(baseUrl)),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    await runtime.ai.ensureReady()
    expect(runtime.ai.providers).toContainEqual(
      expect.objectContaining({
        id: 'runtime-custom',
        kind: 'custom',
        revision: 1,
      }),
    )
    expect(runtime.ai.listModels('runtime-custom')).toEqual([expect.objectContaining({ modelId: 'first-model' })])

    runtime.database.sqlite
      .prepare(
        `UPDATE ai_custom_providers
         SET definition_json = ?, revision = 2, updated_at = ?
         WHERE provider_id = ?`,
      )
      .run(JSON.stringify(definition(baseUrl, 'second-model')), now.getTime() + 1, 'runtime-custom')
    runtime.ai.reloadProvider('runtime-custom')
    expect(runtime.ai.listModels('runtime-custom')).toEqual([expect.objectContaining({ modelId: 'second-model' })])
    expect(runtime.ai.providers).toContainEqual(expect.objectContaining({ id: 'runtime-custom', revision: 2 }))

    runtime.ai.unloadProvider('runtime-custom')
    expect(runtime.ai.listModels('runtime-custom')).toEqual([])
    expect(runtime.ai.providers).not.toContainEqual(expect.objectContaining({ id: 'runtime-custom' }))

    const restarted = createAiRuntime(runtime.db, createAiCrypto('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='), {
      appEnv: 'test',
    })
    await restarted.ensureReady()
    expect(restarted.listModels('runtime-custom')).toEqual([expect.objectContaining({ modelId: 'second-model' })])
  } finally {
    cleanup()
  }
})

it('启动时隔离单条坏 definition，不阻断其他 custom Provider', async () => {
  const { cleanup, runtime } = createTestApp()
  try {
    const now = new Date()
    const good = {
      ...definition('http://localhost:11434/v1'),
      providerId: 'runtime-good',
    }
    const nested: Record<string, unknown> = {}
    let cursor = nested
    for (let index = 0; index < 17; index += 1) {
      const next: Record<string, unknown> = {}
      cursor.child = next
      cursor = next
    }
    const broken = JSON.stringify({
      ...good,
      providerId: 'runtime-broken',
      nested,
    })
    runtime.db
      .insert(aiCustomProviders)
      .values([
        {
          providerId: 'runtime-good',
          definitionJson: JSON.stringify(good),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          providerId: 'runtime-broken',
          definitionJson: broken,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run()
    runtime.db
      .insert(aiProviderConfigs)
      .values({
        providerId: 'runtime-broken',
        createdAt: now,
        updatedAt: now,
      })
      .run()

    await runtime.ai.ensureReady()
    expect(runtime.ai.listModels('runtime-good')).toEqual([expect.objectContaining({ providerId: 'runtime-good' })])
    expect(runtime.ai.listModels('runtime-broken')).toEqual([])
    expect(
      runtime.db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.providerId, 'runtime-broken')).get(),
    ).toMatchObject({
      enabled: false,
      authStatus: 'error',
      lastCheckErrorCode: 'catalog',
    })
  } finally {
    cleanup()
  }
})

it('runtime probe 按真实 HTTP status 分类 auth、timeout 和 upstream', async () => {
  let status = 401
  const upstream = await startStatusServer(() => status)
  const { cleanup, runtime } = createTestApp()
  try {
    const now = new Date()
    const providerDefinition = definition(upstream.url)
    runtime.db
      .insert(aiCustomProviders)
      .values({
        providerId: providerDefinition.providerId,
        definitionJson: JSON.stringify(providerDefinition),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const encrypted = createAiCrypto('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=').encrypt({
      credential: { type: 'api_key', key: 'secret-key' },
      runtimeSettings: {},
    })
    runtime.db
      .insert(aiProviderConfigs)
      .values({
        providerId: providerDefinition.providerId,
        credentialType: 'api_key',
        ...encrypted,
        configRevision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    await runtime.ai.ensureReady()
    for (const item of [
      { status: 401, kind: 'auth' },
      { status: 408, kind: 'timeout' },
      { status: 500, kind: 'upstream' },
    ] as const) {
      status = item.status
      await expect(runtime.ai.checkAuth('runtime-custom')).rejects.toMatchObject(new AiRuntimeError(item.kind))
    }
  } finally {
    cleanup()
    await upstream.close()
  }
})

it('bounded JSON 拒绝超过最大深度的 definition', () => {
  const value: Record<string, unknown> = {}
  let current = value
  for (let index = 0; index < 17; index += 1) {
    const next: Record<string, unknown> = {}
    current.child = next
    current = next
  }

  expect(() => parseBoundedJson(JSON.stringify(value))).toThrow('JSON exceeds maximum depth')
  expect(() => parseBoundedJson(JSON.stringify({ a: { b: 1 } }), 2)).toThrow('JSON exceeds maximum depth')
  expect(parseBoundedJson(JSON.stringify({ a: { b: 1 } }), 3)).toEqual({
    a: { b: 1 },
  })
})

async function startStatusServer(getStatus: () => number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(getStatus(), { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'upstream-secret' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
