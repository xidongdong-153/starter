import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import {
  aiAppCredentialAuditEvents,
  aiAppCredentials,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@api/infra/db/schema/index.js'
import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

/** 不经 policy 检查的用例给空 policy：create 请求必填 policy 字段。 */
function emptyPolicy() {
  return {
    schemaVersion: 1 as const,
    executables: [],
    controls: [],
    maxSideEffect: 'read_only' as const,
  }
}

async function registerAiAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
) {
  const admin = await register(app, `ai-credential-${Date.now()}@example.com`)
  const adminRole = runtime.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'admin')).get()!
  for (const permission of runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, 'ai:config:manage'))
    .all()) {
    runtime.db
      .insert(rolePermissions)
      .values({
        roleId: adminRole.id,
        permissionId: permission.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .onConflictDoNothing()
      .run()
  }
  runtime.db.update(userRoles).set({ roleId: adminRole.id }).where(eq(userRoles.userId, admin.user.id)).run()
  return admin
}

it('应用凭据创建只返回一次 secret，并保存 hash、scope 和审计', async () => {
  const { app, runtime, cleanup } = createTestApp()
  try {
    const admin = await registerAiAdmin(app, runtime)
    const response = await app.request('/api/ai/admin/applications', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Chat Product',
        tenantId: 'tenant-a',
        projectId: 'project-a',
        policy: emptyPolicy(),
      }),
    })
    expect(response.status).toBe(200)
    const body = await readSuccess<{
      application: { appId: string; tenantId: string; projectId: string }
      secret: string
    }>(response)
    expect(body.data.secret).toMatch(/^ai_/)
    const record = runtime.db
      .select()
      .from(aiAppCredentials)
      .where(eq(aiAppCredentials.id, body.data.application.appId))
      .get()!
    expect(record.secretHash).not.toBe(body.data.secret)
    expect(record.secretHash).toHaveLength(64)
    expect(record.secretPrefix).toBe(body.data.secret.slice(0, 12))
    expect(record.tenantId).toBe('tenant-a')
    expect(record.projectId).toBe('project-a')
    expect(
      runtime.db.select().from(aiAppCredentialAuditEvents).where(eq(aiAppCredentialAuditEvents.appId, record.id)).all(),
    ).toHaveLength(1)

    const listed = await app.request('/api/ai/admin/applications', {
      headers: { Cookie: admin.cookie },
    })
    const listedBody = await readSuccess<Array<{ secret?: string }>>(listed)
    expect(listedBody.data[0]?.secret).toBeUndefined()
  } finally {
    cleanup()
  }
})

it('应用凭据轮换和撤销状态生效', async () => {
  const { app, runtime, cleanup } = createTestApp()
  try {
    const admin = await registerAiAdmin(app, runtime)
    const create = await app.request('/api/ai/admin/applications', {
      method: 'POST',
      headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Product', tenantId: 't', projectId: 'p', policy: emptyPolicy() }),
    })
    const created = await readSuccess<{
      application: { appId: string }
      secret: string
    }>(create)
    const rotate = await app.request(`/api/ai/admin/applications/${created.data.application.appId}/rotate`, {
      method: 'POST',
      headers: { Cookie: admin.cookie },
    })
    expect(rotate.status).toBe(200)
    const rotated = await readSuccess<{ secret: string }>(rotate)
    expect(rotated.data.secret).not.toBe(created.data.secret)

    const revoke = await app.request(`/api/ai/admin/applications/${created.data.application.appId}/revoke`, {
      method: 'POST',
      headers: { Cookie: admin.cookie },
    })
    expect(revoke.status).toBe(200)
    const repeated = await app.request(`/api/ai/admin/applications/${created.data.application.appId}/revoke`, {
      method: 'POST',
      headers: { Cookie: admin.cookie },
    })
    expect(repeated.status).toBe(409)
    expect((await readFailure(repeated)).error.code).toBe('AI.APP_CREDENTIAL_REVOKED')
    expect(runtime.db.select().from(aiAppCredentials).all()[0]?.status).toBe('revoked')
  } finally {
    cleanup()
  }
})
