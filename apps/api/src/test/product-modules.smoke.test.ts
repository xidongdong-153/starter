// Chat / Flow 产品模块薄代理的 smoke tests。
// 每个用例用 helpers.ts 注入的临时 SQLite 和临时附件目录，不读写开发库。
// 薄代理不新增 DTO，这里校验 /api/chat/* 与对应 /api/ai/* 端点返回同构 data。
import { expect, it } from 'vitest'

import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

async function requestJson(
  app: ReturnType<typeof createTestApp>['app'],
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      cookie,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

it('chat agents：未登录 401，登录后与 /api/ai/agents 同构', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const unauthenticated = await app.request('/api/chat/agents')
    expect(unauthenticated.status).toBe(401)
    expect((await readFailure(unauthenticated)).error.code).toBe('AUTH.UNAUTHENTICATED')

    const { cookie } = await register(app, 'chat-agents@example.com')

    const chatBody = await readSuccess<unknown>(await app.request('/api/chat/agents', { headers: { cookie } }))
    const aiBody = await readSuccess<unknown>(await app.request('/api/ai/agents', { headers: { cookie } }))
    expect(chatBody.data).toEqual(aiBody.data)
  } finally {
    cleanup()
  }
})

it('chat sessions：创建、改名、列表、归档全链路', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const { cookie } = await register(app, 'chat-sessions@example.com')

    expect((await requestJson(app, 'POST', '/api/chat/sessions', '', {})).status).toBe(401)

    const created = await requestJson(app, 'POST', '/api/chat/sessions', cookie, {
      title: '  首轮会话  ',
    })
    expect(created.status).toBe(200)
    const createdBody = await readSuccess<{
      id: string
      title: string
      archivedAt: string | null
    }>(created)
    expect(createdBody.data.title).toBe('首轮会话')
    expect(createdBody.data.archivedAt).toBeNull()

    // 改名
    const renamed = await requestJson(app, 'PATCH', `/api/chat/sessions/${createdBody.data.id}`, cookie, {
      title: '改名',
    })
    expect(renamed.status).toBe(200)
    expect((await readSuccess<{ title: string }>(renamed)).data.title).toBe('改名')

    // 列表包含它
    const list = await readSuccess<{
      items: Array<{ id: string }>
      total: number
    }>(await app.request('/api/chat/sessions', { headers: { cookie } }))
    expect(list.data.items.some((item) => item.id === createdBody.data.id)).toBe(true)
    expect(list.data.total).toBe(1)

    // 归档后列表不含它
    const archived = await requestJson(app, 'DELETE', `/api/chat/sessions/${createdBody.data.id}`, cookie)
    expect(archived.status).toBe(200)
    const listAfter = await readSuccess<{
      items: Array<{ id: string }>
      total: number
    }>(await app.request('/api/chat/sessions', { headers: { cookie } }))
    expect(listAfter.data.items.some((item) => item.id === createdBody.data.id)).toBe(false)
    expect(listAfter.data.total).toBe(0)
  } finally {
    cleanup()
  }
})

it('flow agents：与 /api/ai/agents 同构', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const { cookie } = await register(app, 'flow-agents@example.com')

    const flowBody = await readSuccess<unknown>(await app.request('/api/flow/agents', { headers: { cookie } }))
    const aiBody = await readSuccess<unknown>(await app.request('/api/ai/agents', { headers: { cookie } }))
    expect(flowBody.data).toEqual(aiBody.data)
  } finally {
    cleanup()
  }
})

it('flow sessions：创建后读取 lane=main transcript；未登录 401', async () => {
  const { app, cleanup } = createTestApp()
  try {
    expect((await requestJson(app, 'POST', '/api/flow/sessions', '', {})).status).toBe(401)

    const { cookie } = await register(app, 'flow-sessions@example.com')

    const created = await requestJson(app, 'POST', '/api/flow/sessions', cookie, {
      title: 'flow 会话',
    })
    expect(created.status).toBe(200)
    const createdBody = await readSuccess<{ id: string }>(created)

    const transcript = await app.request(`/api/flow/sessions/${createdBody.data.id}/transcript?lane=main`, {
      headers: { cookie },
    })
    expect(transcript.status).toBe(200)
    const transcriptBody = await readSuccess<{
      items: unknown[]
      nextCursor: number | null
    }>(transcript)
    expect(Array.isArray(transcriptBody.data.items)).toBe(true)
    expect(transcriptBody.data.items).toHaveLength(0)
  } finally {
    cleanup()
  }
})
