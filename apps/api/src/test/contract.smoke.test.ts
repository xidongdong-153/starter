import { expect, it } from 'vitest'
import {
  apiFailureSchema,
  apiSuccessSchema,
  authorizationAuditEventPageSchema,
  healthSchema,
  publicProfileSchema,
  updateUserStatusResponseSchema,
} from '@starter/contracts'
import { runBootstrapAdmin } from '@api/scripts/bootstrap-admin.js'
import { createTestApp, register } from './helpers.js'

/**
 * 用共享 contracts schema 解析真实 app.request() JSON 响应。
 * 生产环境不重复 parse；这里固定代表性成功、失败和漂移字段，
 * 防止 envelope 或 DTO 字段与 API 实际输出脱节。
 */
function bootstrapAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
  email: string,
) {
  const bootstrapEnv = {
    APP_ENV: 'test',
    BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
    DATABASE_PATH: runtime.env.DATABASE_PATH,
    FILES_DIR: runtime.env.FILES_DIR,
    AUTH_BOOTSTRAP_ADMIN_EMAIL: email,
  }
  const messages: string[] = []
  const exitCode = runBootstrapAdmin(bootstrapEnv, {
    error(message) {
      messages.push(message)
    },
    log() {},
  })
  if (exitCode !== 0) {
    throw new Error(`bootstrap admin failed: ${messages.join('; ')}`)
  }
}

it('health 成功响应符合共享 success envelope schema', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const response = await app.request('/health')
    expect(response.status).toBe(200)

    const envelope = apiSuccessSchema(healthSchema).parse(await response.json())
    expect(envelope.ok).toBe(true)
    expect(envelope.data).toEqual({ ok: true })
    expect(typeof envelope.meta.requestId).toBe('string')
    expect(typeof envelope.meta.timestamp).toBe('string')
  } finally {
    cleanup()
  }
})

it('未登录失败响应符合共享 failure envelope schema', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const response = await app.request('/api/profile')
    expect(response.status).toBe(401)

    const envelope = apiFailureSchema.parse(await response.json())
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('AUTH.UNAUTHENTICATED')
    expect(envelope.error.message).toBeTruthy()
    expect(typeof envelope.meta.requestId).toBe('string')
  } finally {
    cleanup()
  }
})

it('用户状态更新响应包含 from 字段并通过共享 schema', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'contract-admin@example.com')
    bootstrapAdmin(app, runtime, 'contract-admin@example.com')
    const target = await register(app, 'contract-target@example.com')

    const response = await app.request(`/api/users/${target.user.id}/status`, {
      method: 'PATCH',
      headers: {
        cookie: admin.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(response.status).toBe(200)

    const envelope = apiSuccessSchema(updateUserStatusResponseSchema).parse(await response.json())
    expect(envelope.data).toEqual({
      from: 'active',
      id: target.user.id,
      status: 'suspended',
    })
  } finally {
    cleanup()
  }
})

it('审计列表包含 user.status_changed 事件并通过共享 schema', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'contract-admin@example.com')
    bootstrapAdmin(app, runtime, 'contract-admin@example.com')
    const target = await register(app, 'contract-target@example.com')

    const patchResponse = await app.request(`/api/users/${target.user.id}/status`, {
      method: 'PATCH',
      headers: {
        cookie: admin.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(patchResponse.status).toBe(200)

    const auditResponse = await app.request('/api/authorization/audit-events?page=1&pageSize=20', {
      headers: { cookie: admin.cookie },
    })
    expect(auditResponse.status).toBe(200)

    const envelope = apiSuccessSchema(authorizationAuditEventPageSchema).parse(await auditResponse.json())
    const event = envelope.data.items.find((item) => item.action === 'user.status_changed')
    expect(event).toBeDefined()
    expect(event).toMatchObject({
      targetType: 'user',
      before: { status: 'active' },
      after: { status: 'suspended' },
    })
  } finally {
    cleanup()
  }
})

it('公开资料响应通过共享 schema（avatarUrl 接受相对路径）', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const user = await register(app, 'contract-profile@example.com')

    const response = await app.request(`/api/profiles/${user.user.id}`)
    expect(response.status).toBe(200)

    const envelope = apiSuccessSchema(publicProfileSchema).parse(await response.json())
    expect(envelope.data.userId).toBe(user.user.id)
    expect(envelope.data.avatarUrl).toBeNull()
  } finally {
    cleanup()
  }
})
