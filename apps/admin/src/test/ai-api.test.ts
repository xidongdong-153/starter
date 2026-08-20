import type { HarnessEvent } from '@starter/contracts'

import { streamAiTest } from '@admin/api/ai/ai.api'
import { startAgentRun } from '@admin/api/ai/harness.api'
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

const sessionId = '01958c80-8df7-7ce2-8f90-123456789001'
const runId = '01958c80-8df7-7ce2-8f90-123456789002'
const messageId = '01958c80-8df7-7ce2-8f90-123456789003'

function harnessChunk(sequence: number, type: HarnessEvent['type'], data: Record<string, unknown>): Uint8Array {
  const event = {
    version: 1,
    eventId: '01958c80-8df7-7ce2-8f90-123456789004',
    sequence,
    sessionId,
    runId,
    lane: 'main',
    createdAt: '2026-08-20T00:00:00.000Z',
    type,
    data,
  }
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`)
}

/** 逐块发送后让流报错，模拟 SSE 中途断开：`error()` 会清空队列，所以必须按 pull 节奏来。 */
function brokenStreamResponse(chunks: Uint8Array[], cause: Error): Response {
  let index = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index]
        if (chunk) {
          index += 1
          controller.enqueue(chunk)
          return
        }
        controller.error(cause)
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('startAgentRun SSE 中断', () => {
  it('已经收到事件后断流按未终态返回，交给页面转轮询', async () => {
    const chunks = [
      harnessChunk(1, 'message.started', { messageId, role: 'assistant' }),
      harnessChunk(2, 'message.delta', { messageId, delta: '断线前的文字' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenStreamResponse(chunks, new TypeError('network error'))))
    const events: HarnessEvent[] = []

    const result = await startAgentRun(sessionId, { input: '你好' }, new AbortController().signal, (event) =>
      events.push(event),
    )

    expect(result).toEqual({ terminal: false })
    expect(events.map((event) => event.type)).toEqual(['message.started', 'message.delta'])
  })

  it('一个事件都没收到就断流仍然抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenStreamResponse([], new TypeError('network error'))))

    await expect(
      startAgentRun(sessionId, { input: '你好' }, new AbortController().signal, () => undefined),
    ).rejects.toThrow('network error')
  })

  it('用户主动取消时照旧抛出，不当成断线', async () => {
    const controller = new AbortController()
    controller.abort()
    const chunks = [harnessChunk(1, 'message.started', { messageId, role: 'assistant' })]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(brokenStreamResponse(chunks, new DOMException('aborted', 'AbortError'))),
    )

    await expect(startAgentRun(sessionId, { input: '你好' }, controller.signal, () => undefined)).rejects.toMatchObject(
      {
        name: 'AbortError',
      },
    )
  })
})
