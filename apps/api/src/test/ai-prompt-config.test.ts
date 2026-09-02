import { ApiErrorCodes } from '@starter/contracts'
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'

import { permissions, rolePermissions, roles, userRoles } from '@api/infra/db/schema/index.js'

import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

it('system prompt CRUD：创建、更新、列表、删除全链路', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await registerAdmin(app, runtime)
    const created = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
      name: 'code-reviewer',
      content: '你是资深代码审查专家。',
    })
    expect(created.status).toBe(200)
    const body = await readSuccess<{
      id: string
      name: string
      content: string
      enabled: boolean
    }>(created)
    expect(body.data.name).toBe('code-reviewer')

    const updated = await putJson(app, `/api/ai/system-prompts/${body.data.id}`, admin.cookie, {
      content: '你是资深代码审查专家，用中文回答。',
    })
    expect(updated.status).toBe(200)

    const list = await getJson(app, '/api/ai/system-prompts', admin.cookie)
    expect(list.status).toBe(200)
    const listBody = await readSuccess<{ name: string }[]>(list)
    expect(listBody.data).toHaveLength(1)
    expect(listBody.data[0]?.name).toBe('code-reviewer')

    const deleted = await app.request(`/api/ai/system-prompts/${body.data.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    })
    expect(deleted.status).toBe(200)
    const listAfter = await getJson(app, '/api/ai/system-prompts', admin.cookie)
    const listAfterBody = await readSuccess<unknown[]>(listAfter)
    expect(listAfterBody.data).toHaveLength(0)
  } finally {
    cleanup()
  }
})

it('system prompt 写接口无 manage 权限返回 403，列表无 read 权限返回 403', async () => {
  const { app, cleanup } = createTestApp()
  try {
    const owner = await register(app, 'prompt-403@example.com')
    const created = await postJson(app, '/api/ai/system-prompts', owner.cookie, { name: 'no-permission', content: 'x' })
    expect(created.status).toBe(403)
    const listed = await getJson(app, '/api/ai/system-prompts', owner.cookie)
    expect(listed.status).toBe(403)
  } finally {
    cleanup()
  }
})

it('被引用为全局默认的 system prompt 不能删除（409）', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await registerAdmin(app, runtime)
    const created = await postJson(app, '/api/ai/system-prompts', admin.cookie, {
      name: 'global-rule',
      content: '全局规则',
    })
    const body = await readSuccess<{ id: string }>(created)
    const set = await putJson(app, '/api/ai/settings/system-prompt', admin.cookie, { systemPromptId: body.data.id })
    expect(set.status).toBe(200)

    const deleted = await app.request(`/api/ai/system-prompts/${body.data.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    })
    expect(deleted.status).toBe(409)
    const failure = await readFailure(deleted)
    expect(failure.error.code).toBe(ApiErrorCodes.AI_PROMPT_REFERENCED)
  } finally {
    cleanup()
  }
})

it('prompt 模板 CRUD 与列表排序：enabled 优先、sortOrder 升序', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await registerAdmin(app, runtime)
    await postJson(app, '/api/ai/prompt-templates', admin.cookie, {
      name: 'review-code',
      description: '代码审查',
      content: '请审查这段代码：',
      sortOrder: 2,
    })
    await postJson(app, '/api/ai/prompt-templates', admin.cookie, {
      name: 'write-sql',
      description: 'SQL 设计',
      content: '请设计 SQL：',
      enabled: false,
      sortOrder: 1,
    })
    await postJson(app, '/api/ai/prompt-templates', admin.cookie, {
      name: 'explain-term',
      description: '概念解释',
      content: '请解释概念：',
      sortOrder: 0,
    })

    const owner = await register(app, 'template-user@example.com')
    const list = await getJson(app, '/api/ai/prompt-templates', owner.cookie)
    expect(list.status).toBe(200)
    const body = await readSuccess<{ name: string; enabled: boolean }[]>(list)
    expect(body.data.map((item) => item.name)).toEqual(['explain-term', 'review-code', 'write-sql'])
  } finally {
    cleanup()
  }
})

async function registerAdmin(
  app: ReturnType<typeof createTestApp>['app'],
  runtime: ReturnType<typeof createTestApp>['runtime'],
) {
  const owner = await register(app, `admin-${Date.now()}@example.com`)
  const adminRole = runtime.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'admin')).get()!
  const aiPermissions = runtime.db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(eq(permissions.key, 'ai:config:manage'))
    .all()
  const aiReadPermissions = runtime.db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(eq(permissions.key, 'ai:config:read'))
    .all()
  for (const permission of [...aiPermissions, ...aiReadPermissions]) {
    runtime.db
      .insert(rolePermissions)
      .values({
        roleId: adminRole.id,
        permissionId: permission.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .run()
  }
  runtime.db.update(userRoles).set({ roleId: adminRole.id }).where(eq(userRoles.userId, owner.user.id)).run()
  return owner
}

async function postJson(
  app: ReturnType<typeof createTestApp>['app'],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function putJson(
  app: ReturnType<typeof createTestApp>['app'],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getJson(app: ReturnType<typeof createTestApp>['app'], path: string, cookie: string) {
  return app.request(path, { method: 'GET', headers: { cookie } })
}
