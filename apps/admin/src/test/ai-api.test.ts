import { streamAiTest } from '@admin/api/ai/ai.api'
import { fetchApi } from '@admin/api/http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@admin/api/client', () => ({
  apiBaseUrl: 'http://localhost:7788',
  resolveApiUrl: (path: string) => `http://localhost:7788${path}`,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function streamResponse(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('ai SSE adapter', () => {
  it('跨 UTF-8 和事件边界解析，并忽略损坏事件', async () => {
    const payload = [
      'event: text_delta\ndata: {broken}\n\n',
      `event: text_delta\ndata: ${JSON.stringify({ type: 'text_delta', text: '你好' })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ type: 'done', stopReason: 'stop' })}\n\n`,
    ].join('')
    const bytes = new TextEncoder().encode(payload)
    const chineseStart = payload.indexOf('你')
    const prefixBytes = new TextEncoder().encode(payload.slice(0, chineseStart)).byteLength
    const chunks = [bytes.slice(0, 7), bytes.slice(7, prefixBytes + 1), bytes.slice(prefixBytes + 1)]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)))
    const events: unknown[] = []

    await streamAiTest({ prompt: 'test' }, new AbortController().signal, (event) => events.push(event))

    expect(events).toEqual([
      { type: 'text_delta', text: '你好' },
      { type: 'done', stopReason: 'stop' },
    ])
  })

  it('响应流没有 done 或 error 时报告中断', async () => {
    const chunk = new TextEncoder().encode(
      `event: text_delta\ndata: ${JSON.stringify({ type: 'text_delta', text: 'partial' })}\n\n`,
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([chunk])))

    await expect(streamAiTest({ prompt: 'test' }, new AbortController().signal, () => undefined)).rejects.toMatchObject(
      { message: '模型响应流意外中断，可以重试。', status: 200 },
    )
  })

  it('主动取消时保留 AbortError，不转换成网络错误', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch aborted')))

    await expect(fetchApi('/api/ai/test', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
