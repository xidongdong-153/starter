import type { AiAttachment } from '@starter/contracts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('@web/lib/rpc', () => ({
  chatRpc: {
    api: {
      chat: {
        sessions: {
          ':sessionId': {
            runs: { $post: post },
          },
        },
      },
    },
  },
  flowRpc: {
    api: {
      flow: {
        sessions: {
          ':sessionId': {
            runs: { $post: vi.fn() },
          },
        },
      },
    },
  },
}))
const { uploadAiAttachment, attachmentContentUrl } = await import('@web/lib/api/chat-attachments.api')
const { resolveApiUrl } = await import('@web/lib/env.client')
const { startRunStream } = await import('@web/lib/ai/run-event-stream')

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  post.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const attachmentFixture: AiAttachment = {
  id: '01958c80-8df7-7ce2-8f90-1234567890a1',
  mimeType: 'image/png',
  size: 1024,
  sessionId: null,
  createdAt: '2025-08-30T12:00:00.000Z',
}

function successEnvelope(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: true, data, meta: { requestId: 'req-1', timestamp: new Date().toISOString() } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function failureEnvelope(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message },
      meta: { requestId: 'req-1', timestamp: new Date().toISOString() },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function imageFile(): File {
  return new File([new Uint8Array(16)], 'pic.png', { type: 'image/png' })
}

it('上传附件发送 multipart 表单并解析响应', async () => {
  fetchMock.mockResolvedValue(successEnvelope(attachmentFixture, 201))
  const file = imageFile()
  const sessionId = '01958c80-8df7-7ce2-8f90-1234567890b2'

  const result = await uploadAiAttachment(file, sessionId)

  expect(result).toEqual(attachmentFixture)
  const [url, init] = fetchMock.mock.calls[0]!
  expect(String(url)).toContain('/api/chat/attachments')
  expect(init.method).toBe('POST')
  const body = init.body as FormData
  expect(body).toBeInstanceOf(FormData)
  expect(body.get('file')).toBe(file)
  expect(body.get('sessionId')).toBe(sessionId)
})

it('不传 sessionId 时表单只有 file 字段', async () => {
  fetchMock.mockResolvedValue(successEnvelope(attachmentFixture, 201))
  const file = imageFile()

  await uploadAiAttachment(file)

  const body = fetchMock.mock.calls[0]![1].body as FormData
  expect(body.get('file')).toBe(file)
  expect(body.get('sessionId')).toBeNull()
})

it('4xx 上传失败抛出带 error code 的 ApiRequestError', async () => {
  fetchMock.mockResolvedValue(failureEnvelope(413, 'AI.ATTACHMENT_TOO_LARGE', '图片超过大小上限'))

  const error = await uploadAiAttachment(imageFile()).catch((caught: unknown) => caught)

  expect(error).toMatchObject({ status: 413, code: 'AI.ATTACHMENT_TOO_LARGE' })
  expect((error as Error).message).toBe('图片超过大小上限')
})

it('响应 data 不符合附件契约时抛出格式错误', async () => {
  fetchMock.mockResolvedValue(successEnvelope({ nope: true }, 201))

  await expect(uploadAiAttachment(imageFile())).rejects.toThrow('附件上传返回的数据格式不正确。')
})

it('附件下载地址指向 API 的 content 端点', () => {
  const url = attachmentContentUrl('01958c80-8df7-7ce2-8f90-1234567890a1')
  expect(url).toMatch(/\/api\/chat\/attachments\/01958c80-8df7-7ce2-8f90-1234567890a1\/content$/u)
})

it('历史回放的相对路径 url 解析到 API 域名而不是 Web 域名', () => {
  const relative = '/api/chat/attachments/01958c80-8df7-7ce2-8f90-1234567890a1/content'

  const resolved = resolveApiUrl(relative)

  expect(resolved).toBe('http://localhost:7788/api/chat/attachments/01958c80-8df7-7ce2-8f90-1234567890a1/content')
  expect(resolved.startsWith('/')).toBe(false)
})

it('pending 已是绝对地址的 url 再过 resolveApiUrl 保持不变', () => {
  const absolute = attachmentContentUrl('01958c80-8df7-7ce2-8f90-1234567890a1')

  expect(resolveApiUrl(absolute)).toBe(absolute)
})

it('startRun 带 attachmentIds 时进入请求体', async () => {
  post.mockResolvedValue(new Response('', { status: 200 }))
  const attachmentIds = ['01958c80-8df7-7ce2-8f90-1234567890c1', '01958c80-8df7-7ce2-8f90-1234567890c2']

  const received = []
  for await (const event of startRunStream({
    agentId: '01958c80-8df7-7ce2-8f90-1234567890a7',
    attachmentIds,
    input: 'hi',
    product: 'chat',
    sessionId: '01958c80-8df7-7ce2-8f90-1234567890a3',
    signal: new AbortController().signal,
  })) {
    received.push(event)
  }

  expect(received).toEqual([])
  const json = post.mock.calls[0]![0].json
  expect(json.attachmentIds).toEqual(attachmentIds)
})

it('不带 attachmentIds 时请求体保持纯文本路径', async () => {
  post.mockResolvedValue(new Response('', { status: 200 }))

  const received = []
  for await (const event of startRunStream({
    agentId: '01958c80-8df7-7ce2-8f90-1234567890a7',
    input: 'hi',
    product: 'chat',
    sessionId: '01958c80-8df7-7ce2-8f90-1234567890a3',
    signal: new AbortController().signal,
  })) {
    received.push(event)
  }

  expect(received).toEqual([])
  const json = post.mock.calls[0]![0].json
  expect('attachmentIds' in json).toBe(false)
})
