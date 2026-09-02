import { ApiErrorCodes } from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { authorizationAuditEvents, session, user } from '@api/infra/db/schema/index.js'
import { runBootstrapAdmin } from '@api/scripts/bootstrap-admin.js'
import { createTestApp, readFailure, readSuccess, register, signIn } from './helpers.js'

const PASSWORD = 'password-123'

async function bootstrapAdmin(
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
  const output = {
    error(message: string) {
      messages.push(message)
    },
    log(message: string) {
      messages.push(message)
    },
  }
  const exitCode = runBootstrapAdmin(bootstrapEnv, output)
  if (exitCode !== 0) {
    throw new Error(`bootstrap admin failed: ${messages.join('; ')}`)
  }
}

async function patchStatus(
  app: ReturnType<typeof createTestApp>['app'],
  cookie: string,
  userId: string,
  status: string,
) {
  return app.request(`/api/users/${userId}/status`, {
    method: 'PATCH',
    headers: {
      cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  })
}

it('禁用用户后：登录被拒绝、已有会话立即失效、启用后恢复', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'admin@example.com')
    await bootstrapAdmin(app, runtime, 'admin@example.com')
    const target = await register(app, 'target@example.com')

    // 目标用户先登录，取得会话
    const targetCookie = await signIn(app, 'target@example.com')
    expect(targetCookie).not.toBe('')
    const profileBefore = await app.request('/api/profile', {
      headers: { cookie: targetCookie },
    })
    expect(profileBefore.status).toBe(200)

    // 管理员禁用目标用户
    const disableResponse = await patchStatus(app, admin.cookie, target.user.id, 'suspended')
    expect(disableResponse.status).toBe(200)
    expect((await readSuccess(disableResponse)).data).toEqual({
      from: 'active',
      id: target.user.id,
      status: 'suspended',
    })

    // 该用户已无任何 session
    const sessionRows = runtime.db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, target.user.id))
      .all()
    expect(sessionRows.length).toBe(0)

    // 旧会话请求自有 API：会话已删除，返回 401
    const profileAfter = await app.request('/api/profile', {
      headers: { cookie: targetCookie },
    })
    expect(profileAfter.status).toBe(401)

    // 重新登录被拒绝（不创建新 session）
    const loginResponse = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'target@example.com',
        password: PASSWORD,
      }),
    })
    expect(loginResponse.status).not.toBe(200)
    const loginCookie = loginResponse.headers.get('set-cookie') ?? ''
    expect(loginCookie).not.toContain('better-auth.session_token=')

    // 启用后：可重新登录并访问
    const enableResponse = await patchStatus(app, admin.cookie, target.user.id, 'active')
    expect(enableResponse.status).toBe(200)

    const newCookie = await signIn(app, 'target@example.com')
    expect(newCookie).not.toBe('')
    const profileRestored = await app.request('/api/profile', {
      headers: { cookie: newCookie },
    })
    expect(profileRestored.status).toBe(200)
  } finally {
    cleanup()
  }
})

it('guard 兜底：session 存在但 user.status 为 suspended 时返回 401 AUTH.USER_SUSPENDED', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const target = await register(app, 'target@example.com')

    const targetCookie = await signIn(app, 'target@example.com')
    expect(targetCookie).not.toBe('')

    // 模拟边缘情况：直接改库置 suspended，保留 session
    runtime.db.update(user).set({ status: 'suspended' }).where(eq(user.id, target.user.id)).run()

    const profileResponse = await app.request('/api/profile', {
      headers: { cookie: targetCookie },
    })
    expect(profileResponse.status).toBe(401)
    expect((await readFailure(profileResponse)).error.code).toBe(ApiErrorCodes.AUTH_USER_SUSPENDED)
  } finally {
    cleanup()
  }
})

it('状态变更接口权限矩阵：未登录 401、viewer 403、admin 200、目标不存在 404', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'admin@example.com')
    await bootstrapAdmin(app, runtime, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')
    const target = await register(app, 'target@example.com')

    const unauthenticated = await app.request(`/api/users/${target.user.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(unauthenticated.status).toBe(401)

    const viewerResponse = await patchStatus(app, viewer.cookie, target.user.id, 'suspended')
    expect(viewerResponse.status).toBe(403)
    expect((await readFailure(viewerResponse)).error.code).toBe(ApiErrorCodes.AUTH_FORBIDDEN)

    const missingResponse = await patchStatus(app, admin.cookie, '019c3e00-0010-7000-8000-000000000099', 'suspended')
    expect(missingResponse.status).toBe(404)
    expect((await readFailure(missingResponse)).error.code).toBe(ApiErrorCodes.COMMON_NOT_FOUND)

    const adminOk = await patchStatus(app, admin.cookie, target.user.id, 'suspended')
    expect(adminOk.status).toBe(200)
  } finally {
    cleanup()
  }
})

it('防呆：admin 不能禁用自己（400），幂等：重复提交目标状态返回 200', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'admin@example.com')
    await bootstrapAdmin(app, runtime, 'admin@example.com')
    const target = await register(app, 'target@example.com')

    const selfResponse = await patchStatus(app, admin.cookie, admin.user.id, 'suspended')
    expect(selfResponse.status).toBe(400)
    expect((await readFailure(selfResponse)).error.code).toBe(ApiErrorCodes.COMMON_INVALID_REQUEST)

    // 幂等：admin 对 target 重复提交 active（target 默认 active）
    const first = await patchStatus(app, admin.cookie, target.user.id, 'active')
    expect(first.status).toBe(200)
    const second = await patchStatus(app, admin.cookie, target.user.id, 'active')
    expect(second.status).toBe(200)

    // 幂等不写审计：只有一次真实变更时才有一条 user.status_changed 记录
    const auditRows = runtime.db
      .select({ action: authorizationAuditEvents.action })
      .from(authorizationAuditEvents)
      .where(eq(authorizationAuditEvents.action, 'user.status_changed'))
      .all()
    expect(auditRows.length).toBe(0)
  } finally {
    cleanup()
  }
})

it('状态变更写入审计事件 authorizationAuditEvents（user.status_changed）', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'admin@example.com')
    await bootstrapAdmin(app, runtime, 'admin@example.com')
    const target = await register(app, 'target@example.com')

    await patchStatus(app, admin.cookie, target.user.id, 'suspended')

    const auditRows = runtime.db
      .select({
        actorType: authorizationAuditEvents.actorType,
        actorId: authorizationAuditEvents.actorId,
        action: authorizationAuditEvents.action,
        targetType: authorizationAuditEvents.targetType,
        targetId: authorizationAuditEvents.targetId,
        beforeJson: authorizationAuditEvents.beforeJson,
        afterJson: authorizationAuditEvents.afterJson,
      })
      .from(authorizationAuditEvents)
      .where(eq(authorizationAuditEvents.action, 'user.status_changed'))
      .all()

    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({
      actorType: 'user',
      actorId: admin.user.id,
      action: 'user.status_changed',
      targetType: 'user',
      targetId: target.user.id,
      beforeJson: JSON.stringify({ status: 'active' }),
      afterJson: JSON.stringify({ status: 'suspended' }),
    })
  } finally {
    cleanup()
  }
})
