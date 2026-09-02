import { describe, expect, it, vi } from 'vitest'
import type { MailMessage, Mailer } from '@api/infra/mail/index.js'
import { createMailer } from '@api/infra/mail/index.js'
import { parseEnv } from '@api/shared/env.js'
import { user as userTable } from '@api/infra/db/schema/index.js'
import { eq } from 'drizzle-orm'
import { createTestApp, register, signInWithPassword } from './helpers.js'

/**
 * 从邮件正文里提取 token 链接并返回 token。
 * 验证邮件和重置邮件都包含 `${ADMIN_BASE_URL}/<page>?token=<token>`。
 */
function extractToken(mail: { text?: string }, path: string): string {
  const match = (mail.text ?? '').match(new RegExp(`https?://[^\\s]+/${path}\\?token=([^\\s]+)`))
  if (!match) {
    throw new Error(`邮件正文缺少 ${path} 链接: ${mail.text}`)
  }
  return match[1] ?? ''
}

function createCaptureMailer(): { mailer: Mailer; sent: MailMessage[] } {
  const sent: MailMessage[] = []
  const mailer: Mailer = {
    sendMail: async (message) => {
      sent.push(message)
    },
  }
  return { mailer, sent }
}

describe('认证闭环：邮箱验证', () => {
  it('注册后发送验证邮件，用邮件链接验证后 emailVerified 变为 true', async () => {
    const { mailer, sent } = createCaptureMailer()
    const { app, runtime, cleanup } = createTestApp({}, { mailer })
    try {
      const email = 'verify@example.com'
      const { user } = await register(app, email)

      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        to: email,
        subject: '验证你的 Starter 邮箱',
      })

      const token = extractToken(sent[0] ?? { text: '' }, 'verify-email')
      const response = await app.request(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      expect(response.status).toBe(200)

      const stored = runtime.db
        .select({ emailVerified: userTable.emailVerified })
        .from(userTable)
        .where(eq(userTable.id, user.id))
        .get()
      expect(stored?.emailVerified).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('验证 token 错误时返回 401', async () => {
    const { app, cleanup } = createTestApp()
    try {
      const response = await app.request('/api/auth/verify-email?token=invalid-token')
      expect(response.status).toBe(401)
    } finally {
      cleanup()
    }
  })
})

describe('认证闭环：忘记/重置密码', () => {
  it('请求重置后收到邮件，用链接设置新密码后新密码可登录、旧密码失效', async () => {
    const { mailer, sent } = createCaptureMailer()
    const { app, cleanup } = createTestApp({}, { mailer })
    try {
      const email = 'reset@example.com'
      await register(app, email)
      sent.length = 0

      const request = await app.request('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      expect(request.status).toBe(200)

      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        to: email,
        subject: '重置你的 Starter 密码',
      })

      const token = extractToken(sent[0] ?? { text: '' }, 'reset-password')
      const reset = await app.request('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: 'new-password-456', token }),
      })
      expect(reset.status).toBe(200)

      const newLogin = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'new-password-456' }),
      })
      expect(newLogin.headers.get('set-cookie')).not.toBeNull()

      const oldLogin = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password-123' }),
      })
      expect(oldLogin.status).toBe(401)
    } finally {
      cleanup()
    }
  })

  it('请求重置对不存在的邮箱也返回成功，避免泄露账号信息', async () => {
    const { app, cleanup } = createTestApp()
    try {
      const response = await app.request('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com' }),
      })
      expect(response.status).toBe(200)
    } finally {
      cleanup()
    }
  })
})

describe('认证闭环：修改密码', () => {
  it('用当前密码修改密码后新密码可登录、旧密码失效', async () => {
    const { app, cleanup } = createTestApp()
    try {
      const email = 'change@example.com'
      const { cookie } = await register(app, email)
      const otherCookie = await signInWithPassword(app, email, 'password-123')

      const response = await app.request('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie,
        },
        body: JSON.stringify({
          currentPassword: 'password-123',
          newPassword: 'new-password-456',
          revokeOtherSessions: true,
        }),
      })
      expect(response.status).toBe(200)
      const responseBody = (await response.json()) as { token?: string | null }
      expect(responseBody.token).toEqual(expect.any(String))

      const currentSession = await app.request('/api/auth/get-session', {
        headers: {
          cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
        },
      })
      expect(currentSession.status).toBe(200)

      const revokedSession = await app.request('/api/auth/get-session', {
        headers: { cookie: otherCookie },
      })
      expect(revokedSession.status).toBe(200)
      expect(await revokedSession.json()).toBeNull()

      const newLogin = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'new-password-456' }),
      })
      expect(newLogin.headers.get('set-cookie')).not.toBeNull()

      const oldLogin = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password-123' }),
      })
      expect(oldLogin.status).toBe(401)
    } finally {
      cleanup()
    }
  })

  it('当前密码错误时修改失败', async () => {
    const { app, cleanup } = createTestApp()
    try {
      const email = 'change-bad@example.com'
      const { cookie } = await register(app, email)

      const response = await app.request('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie,
        },
        body: JSON.stringify({
          currentPassword: 'wrong-password',
          newPassword: 'new-password-456',
        }),
      })
      expect(response.status).toBe(400)
    } finally {
      cleanup()
    }
  })
})

describe('mailer 日志模式', () => {
  it('配置 SMTP 主机但缺少发件人时启动配置失败', () => {
    expect(() =>
      parseEnv({
        BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters',
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: '',
      }),
    ).toThrow('配置 SMTP_HOST 时必须同时配置 SMTP_FROM')
  })

  it('未配置 SMTP 时日志模式发送邮件不抛错', async () => {
    const logger = { info: vi.fn() } as unknown as Parameters<typeof createMailer>[1]
    const mailer = createMailer(
      {
        SMTP_HOST: '',
        SMTP_PORT: 587,
        SMTP_USER: '',
        SMTP_PASS: '',
        SMTP_FROM: '',
        ADMIN_BASE_URL: 'http://localhost:2333',
      } as never,
      logger,
    )

    await expect(
      mailer.sendMail({
        to: 'test@example.com',
        subject: '主题',
        text: '正文',
      }),
    ).resolves.toBeUndefined()
    expect(logger.info).toHaveBeenCalledTimes(1)
  })
})
