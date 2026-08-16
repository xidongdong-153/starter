import { streamAiConversation, streamAiTest } from '@admin/api/ai/ai.api'
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

  it('解析会话 SSE，并在 error 终态前保留已收到的文本', async () => {
    const ids = {
      conversationId: '01958c80-8df7-7ce2-8f90-123456789001',
      generationId: '01958c80-8df7-7ce2-8f90-123456789002',
      assistantMessageId: '01958c80-8df7-7ce2-8f90-123456789003',
    }
    const payload = [
      `event: start\ndata: ${JSON.stringify({ type: 'start', requestId: 'request-1', ...ids, model: { providerId: 'openai', modelId: 'gpt-4o' } })}\n\n`,
      `event: text_delta\ndata: ${JSON.stringify({ type: 'text_delta', text: '部分', turnIndex: 0, contentIndex: 0, blockId: 'block-1' })}\n\n`,
      `event: error\ndata: ${JSON.stringify({ type: 'error', code: 'AI.REQUEST_ABORTED', message: '生成已停止', retryable: true, requestId: 'request-1' })}\n\n`,
      `event: text_delta\ndata: ${JSON.stringify({ type: 'text_delta', text: '忽略', turnIndex: 0, contentIndex: 0, blockId: 'block-1' })}\n\n`,
    ].join('')
    const bytes = new TextEncoder().encode(payload)
    const partialStart = new TextEncoder().encode(payload.slice(0, payload.indexOf('部'))).byteLength
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamResponse([bytes.slice(0, 13), bytes.slice(13, partialStart + 1), bytes.slice(partialStart + 1)]),
        ),
    )
    const events: unknown[] = []

    await streamAiConversation(
      { conversationId: ids.conversationId, text: 'hello' },
      new AbortController().signal,
      (event) => events.push(event),
    )

    expect(events).toHaveLength(3)
    expect(events[1]).toMatchObject({ type: 'text_delta', text: '部分' })
    expect(events[2]).toMatchObject({ type: 'error', code: 'AI.REQUEST_ABORTED' })
  })

  it('会话响应流没有 completed 或 error 时报告中断', async () => {
    const chunk = new TextEncoder().encode(
      `event: text_delta\ndata: ${JSON.stringify({
        type: 'text_delta',
        text: 'partial',
        turnIndex: 0,
        contentIndex: 0,
        blockId: '0:0',
      })}\n\n`,
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([chunk])))

    await expect(
      streamAiConversation(
        { conversationId: '01958c80-8df7-7ce2-8f90-123456789001', text: 'hello' },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ message: '会话响应流意外中断，可以重试。', status: 200 })
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
