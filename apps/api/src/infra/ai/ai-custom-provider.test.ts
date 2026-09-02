import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import dns from 'node:dns/promises'
import { createServer } from 'node:http'

import { customAiProviderDefinitionSchema } from '@starter/contracts'
import { describe, expect, it } from 'vitest'

import { createAiUrlGuard } from './ai-url-guard.js'
import { createCustomAiProvider } from './custom-provider.factory.js'

const model = {
  modelId: 'test-model',
  name: 'Test Model',
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  supportsImageInput: false,
  supportsReasoning: false,
  supportsTools: false,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheWriteCost: 0,
}

describe('custom Provider runtime', () => {
  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'] as const)(
    '把 %s 固定映射到同名 pi-ai API',
    (protocol) => {
      const definition = customAiProviderDefinitionSchema.parse({
        providerId: `test-${protocol}`,
        name: protocol,
        protocol,
        baseUrl: 'http://localhost:9999/v1',
        compat: {},
        models: [model],
      })

      const provider = createCustomAiProvider(definition, { appEnv: 'test' })

      expect(provider.getModels()).toEqual([
        expect.objectContaining({
          api: protocol,
          provider: `test-${protocol}`,
          supportsTools: false,
        }),
      ])
    },
  )
})

describe('ai URL guard', () => {
  it('允许显式 CIDR 中的生产私网 HTTP，并始终拒绝回环、link-local 和 metadata', async () => {
    const guard = createAiUrlGuard({
      appEnv: 'production',
      allowedPrivateCidrs: ['10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16'],
    })

    await expect(guard.assertAllowed('http://10.2.3.4/v1')).resolves.toEqual(new URL('http://10.2.3.4/v1'))
    await expect(guard.assertAllowed('http://93.184.216.34/v1')).rejects.toMatchObject({ reason: 'scheme' })
    await expect(guard.assertAllowed('https://127.0.0.1/v1')).rejects.toMatchObject({ reason: 'private' })
    await expect(guard.assertAllowed('https://169.254.170.2/v1')).rejects.toMatchObject({ reason: 'private' })
    await expect(guard.assertAllowed('https://169.254.169.254/v1')).rejects.toMatchObject({ reason: 'private' })
  })

  it('用主机名请求时把解析到的地址固定给 socket，不会被 autoSelectFamily 的 all: true 打断', async () => {
    const [primary] = await dns.lookup('localhost', { all: true })
    expect(primary).toBeDefined()
    const upstream = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    }, primary!.address)
    try {
      const guard = createAiUrlGuard({ appEnv: 'test' })
      const response = await guard.fetch(`http://localhost:${upstream.port}/v1`)

      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('ok')
    } finally {
      await upstream.close()
    }
  })

  it('在 headers 返回后仍限制流式 response body 的读取时间', async () => {
    const upstream = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.flushHeaders()
    })
    try {
      const guard = createAiUrlGuard({ appEnv: 'test', timeoutMs: 30 })
      const response = await guard.fetch(upstream.url)

      await expect(response.text()).rejects.toMatchObject({
        name: 'AiUrlGuardError',
        reason: 'timeout',
      })
    } finally {
      await upstream.close()
    }
  })

  it('拒绝重定向和没有 content-length 的过大响应', async () => {
    const redirect = await startServer((_request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1/metadata' })
      response.end()
    })
    const oversized = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.write('123')
      response.end('45')
    })
    try {
      const guard = createAiUrlGuard({
        appEnv: 'test',
        maxResponseBytes: 4,
      })
      await expect(guard.fetch(redirect.url)).rejects.toMatchObject({
        reason: 'redirect',
      })
      const response = await guard.fetch(oversized.url)
      await expect(response.text()).rejects.toMatchObject({
        reason: 'response_size',
      })
    } finally {
      await Promise.all([redirect.close(), oversized.close()])
    }
  })
})

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  host = '127.0.0.1',
): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => {
    server.listen(0, host, resolve)
  })
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
