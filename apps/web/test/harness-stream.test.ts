import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { HarnessEvent } from '@starter/contracts'

const post = vi.fn()
vi.mock('@web/lib/rpc', () => ({
  apiRpc: { api: { ai: { sessions: { ':sessionId': { runs: { $post: post } } } } } },
}))

const { startRunStream } = await import('@web/lib/ai/harness-stream')

const fixturePath = path.resolve(import.meta.dirname, '../../../test-fixtures/harness-timeline-isomorphism.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { events: HarnessEvent[] }

function sseResponse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

it('按 SSE 帧产出事件，跳过心跳和坏帧', async () => {
  const frames = fixture.events
    .slice(0, 3)
    .map((event) => `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  const text = `: heartbeat\n\n${frames}data: {"broken":true}\r\n\r\ndata: not-json\n\n`
  post.mockResolvedValue(sseResponse(text))

  const received: HarnessEvent[] = []
  for await (const event of startRunStream({
    agentId: 'a',
    input: 'hi',
    sessionId: 's',
    signal: new AbortController().signal,
  })) {
    received.push(event)
  }

  expect(received.map((event) => event.sequence)).toEqual([1, 2, 3])
})

it('非 2xx 抛出带 status 的错误', async () => {
  post.mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'COMMON.NOT_FOUND', message: '找不到 Session' },
        meta: { requestId: 'r', timestamp: '2026-08-20T00:00:00.000Z' },
      }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ),
  )

  await expect(
    startRunStream({ agentId: 'a', input: 'hi', sessionId: 's', signal: new AbortController().signal }).next(),
  ).rejects.toThrow('找不到 Session')
})
