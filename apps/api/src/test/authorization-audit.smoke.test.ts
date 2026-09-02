import type { AuthorizationAuditEvent, AuthorizationAuditEventPage } from '@starter/contracts'
import { ApiErrorCodes, AuditActions, PermissionKeys, RoleKeys } from '@starter/contracts'
import { asc, eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { authorizationAuditEvents, permissions, rolePermissions, roles, userRoles } from '@api/infra/db/schema/index.js'
import { insertAuditEvent } from '@api/modules/authorization/authorization.audit.js'
import { createAuthorizationRepository } from '@api/modules/authorization/index.js'
import { createTestApp, readFailure, readSuccess, register } from './helpers.js'

const systemContext = {
  actorType: 'system',
  actorId: 'auth:bootstrap-admin',
  requestId: null,
} as const

type TestDb = ReturnType<typeof createTestApp>['runtime']['db']

function readAuditRows(db: TestDb) {
  return db
    .select()
    .from(authorizationAuditEvents)
    .orderBy(asc(authorizationAuditEvents.createdAt), asc(authorizationAuditEvents.id))
    .all()
}

function readAuditRowsFor(db: TestDb, targetId: string) {
  return readAuditRows(db).filter((row) => row.targetId === targetId)
}

function grantPermissionToRole(db: TestDb, roleKey: string, permissionKey: string) {
  const role = db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey)).get()
  const permission = db.select({ id: permissions.id }).from(permissions).where(eq(permissions.key, permissionKey)).get()
  expect(role).toBeDefined()
  expect(permission).toBeDefined()
  db.insert(rolePermissions)
    .values({
      roleId: role!.id,
      permissionId: permission!.id,
      assignedAt: new Date(),
      assignedBy: null,
    })
    .run()
}

it('审计构造器只序列化 action 允许的 payload 字段', () => {
  const { cleanup, runtime } = createTestApp()
  try {
    const before = {
      roleKeys: [RoleKeys.OPERATOR],
      password: 'must-not-be-stored',
    }
    const after = {
      roleKeys: [RoleKeys.VIEWER],
      token: 'must-not-be-stored',
    }

    runtime.db.transaction((tx) => {
      insertAuditEvent(tx, {
        actorType: 'system',
        actorId: 'test:payload-projection',
        action: AuditActions.USER_ROLES_REPLACED,
        targetType: 'user',
        targetId: 'target-user-id',
        before,
        after,
        requestId: null,
      })
    })

    const row = readAuditRows(runtime.db).at(-1)
    expect(row).toBeDefined()
    expect(row!.beforeJson).toBe(JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }))
    expect(row!.afterJson).toBe(JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }))
    expect(`${row!.beforeJson}${row!.afterJson}`).not.toContain('must-not-be-stored')
  } finally {
    cleanup()
  }
})

it('新用户注册写 user_roles.initialized，actor 是 system 且 request_id 为空', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const created = await register(app, 'audit-init@example.com')

    const rows = readAuditRowsFor(runtime.db, created.user.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorType: 'system',
      actorId: 'better-auth:user.create',
      action: AuditActions.USER_ROLES_INITIALIZED,
      targetType: 'user',
      targetId: created.user.id,
      beforeJson: JSON.stringify({ roleKeys: [] }),
      afterJson: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }),
      reason: null,
      requestId: null,
    })
  } finally {
    cleanup()
  }
})

it('用户角色替换按 admin 成员关系变化写三种 action', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'audit-admin@example.com')
    const target = await register(app, 'audit-target@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-admin@example.com', systemContext).kind).toBe('ok')

    async function replaceRoles(roleKeys: string[]) {
      const response = await app.request(`/api/authorization/users/${target.user.id}/roles`, {
        method: 'PUT',
        headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleKeys }),
      })
      expect(response.status).toBe(200)
    }

    // operator -> viewer：不涉及 admin，记 user_roles.replaced
    await replaceRoles([RoleKeys.VIEWER])
    // viewer -> admin：授予
    await replaceRoles([RoleKeys.ADMIN])
    // admin -> operator：撤销
    await replaceRoles([RoleKeys.OPERATOR])

    const rows = readAuditRowsFor(runtime.db, target.user.id)
    // 第一条是注册时的 initialized
    expect(rows.map((row) => row.action)).toEqual([
      AuditActions.USER_ROLES_INITIALIZED,
      AuditActions.USER_ROLES_REPLACED,
      AuditActions.PLATFORM_ADMIN_GRANTED,
      AuditActions.PLATFORM_ADMIN_REVOKED,
    ])

    // 三种 action 的 before/after 都是完整角色集合，不只记 admin 的变化
    expect(rows.slice(1).map((row) => [row.beforeJson, row.afterJson])).toEqual([
      [JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }), JSON.stringify({ roleKeys: [RoleKeys.VIEWER] })],
      [JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }), JSON.stringify({ roleKeys: [RoleKeys.ADMIN] })],
      [JSON.stringify({ roleKeys: [RoleKeys.ADMIN] }), JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] })],
    ])

    // actor 与 request_id：HTTP 写入必须是当前用户，且 request_id 落库
    for (const row of rows.slice(1)) {
      expect(row.actorType).toBe('user')
      expect(row.actorId).toBe(admin.user.id)
      expect(row.requestId).toEqual(expect.any(String))
    }

    // after 与最终数据库关系一致
    const finalRoleKeys = runtime.db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, target.user.id))
      .all()
      .map((role) => role.key)
    expect(finalRoleKeys).toEqual([RoleKeys.OPERATOR])
    expect(rows.at(-1)!.afterJson).toBe(JSON.stringify({ roleKeys: finalRoleKeys }))
  } finally {
    cleanup()
  }
})

it('角色权限替换写 role_permissions.replaced，target 是 role key', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'audit-perm-admin@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-perm-admin@example.com', systemContext).kind).toBe('ok')

    const response = await app.request('/api/authorization/roles/viewer/permissions', {
      method: 'PUT',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionKeys: [PermissionKeys.FILE_LIST] }),
    })
    expect(response.status).toBe(200)

    const rows = readAuditRowsFor(runtime.db, RoleKeys.VIEWER)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorType: 'user',
      actorId: admin.user.id,
      action: AuditActions.ROLE_PERMISSIONS_REPLACED,
      targetType: 'role',
      targetId: RoleKeys.VIEWER,
      beforeJson: JSON.stringify({
        permissionKeys: [PermissionKeys.FILE_LIST, PermissionKeys.FILE_READ],
      }),
      afterJson: JSON.stringify({
        permissionKeys: [PermissionKeys.FILE_LIST],
      }),
    })
  } finally {
    cleanup()
  }
})

it('bootstrap 首次执行写事件，重复执行和幂等请求都不写', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'audit-boot@example.com')
    const target = await register(app, 'audit-boot-target@example.com')
    const repository = createAuthorizationRepository(runtime.db)

    expect(repository.bootstrapAdminByEmail('audit-boot@example.com', systemContext).kind).toBe('ok')
    const afterFirst = readAuditRowsFor(runtime.db, admin.user.id)
    expect(afterFirst).toHaveLength(2)
    expect(afterFirst.at(-1)).toMatchObject({
      actorType: 'system',
      actorId: 'auth:bootstrap-admin',
      action: AuditActions.PLATFORM_ADMIN_GRANTED,
      requestId: null,
      beforeJson: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }),
      afterJson: JSON.stringify({ roleKeys: [RoleKeys.ADMIN] }),
    })

    // 重复 bootstrap 命中幂等短路，不追加事件
    expect(repository.bootstrapAdminByEmail('audit-boot@example.com', systemContext).kind).toBe('ok')
    expect(readAuditRowsFor(runtime.db, admin.user.id)).toHaveLength(2)

    // 幂等 HTTP 请求：提交与当前相同的角色集合
    const before = readAuditRowsFor(runtime.db, target.user.id).length
    const idempotent = await app.request(`/api/authorization/users/${target.user.id}/roles`, {
      method: 'PUT',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }),
    })
    expect(idempotent.status).toBe(200)
    expect(readAuditRowsFor(runtime.db, target.user.id)).toHaveLength(before)
  } finally {
    cleanup()
  }
})

it('审计插入失败时关系变更一并回滚', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    await register(app, 'audit-rollback@example.com')
    const target = await register(app, 'audit-rollback-target@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-rollback@example.com', systemContext).kind).toBe('ok')

    // 让审计插入必然失败：用触发器直接 ABORT。
    // 关系写入排在审计插入之前，能证明它被同一个 transaction 回滚。
    runtime.database.sqlite.exec(
      "CREATE TRIGGER audit_block BEFORE INSERT ON authorization_audit_events BEGIN SELECT RAISE(ABORT, 'audit insert blocked'); END",
    )

    expect(() =>
      repository.replaceUserRoles(target.user.id, [RoleKeys.VIEWER], {
        actorType: 'system',
        actorId: 'test',
        requestId: null,
      }),
    ).toThrow(/audit insert blocked/)

    const roleKeys = runtime.db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, target.user.id))
      .all()
      .map((role) => role.key)
    expect(roleKeys).toEqual([RoleKeys.OPERATOR])
    expect(readAuditRowsFor(runtime.db, target.user.id)).toHaveLength(1)
  } finally {
    cleanup()
  }
})

it('关系写入失败时不追加审计，关系删除也一并回滚', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    await register(app, 'audit-relation-rollback@example.com')
    const target = await register(app, 'audit-relation-rollback-target@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-relation-rollback@example.com', systemContext).kind).toBe('ok')

    const beforeAuditCount = readAuditRowsFor(runtime.db, target.user.id).length
    runtime.database.sqlite.exec(
      "CREATE TRIGGER user_roles_block BEFORE INSERT ON user_roles BEGIN SELECT RAISE(ABORT, 'relation insert blocked'); END",
    )

    expect(() =>
      repository.replaceUserRoles(target.user.id, [RoleKeys.VIEWER], {
        actorType: 'system',
        actorId: 'test',
        requestId: null,
      }),
    ).toThrow(/relation insert blocked/)

    const roleKeys = runtime.db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, target.user.id))
      .all()
      .map((role) => role.key)
    expect(roleKeys).toEqual([RoleKeys.OPERATOR])
    expect(readAuditRowsFor(runtime.db, target.user.id)).toHaveLength(beforeAuditCount)
  } finally {
    cleanup()
  }
})

it('审计查询要求 authorization-audit:read，返回结构化 before/after', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'audit-read-admin@example.com')
    const operator = await register(app, 'audit-read-operator@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-read-admin@example.com', systemContext).kind).toBe('ok')

    const unauthenticated = await app.request('/api/authorization/audit-events')
    expect(unauthenticated.status).toBe(401)

    const denied = await app.request('/api/authorization/audit-events', {
      headers: { cookie: operator.cookie },
    })
    expect(denied.status).toBe(403)
    expect((await readFailure(denied)).error.code).toBe(ApiErrorCodes.AUTH_FORBIDDEN)

    const allowed = await app.request('/api/authorization/audit-events', {
      headers: { cookie: admin.cookie },
    })
    expect(allowed.status).toBe(200)
    const page = (await readSuccess<AuthorizationAuditEventPage>(allowed)).data
    expect(page).toMatchObject({ page: 1, pageSize: 20 })
    expect(page.total).toBe(page.items.length)

    // Admin 收到结构化对象，不是原始 JSON 字符串
    const initialized = page.items.find((item) => item.action === AuditActions.USER_ROLES_INITIALIZED)
    expect(initialized).toBeDefined()
    expect(initialized!.before).toEqual({ roleKeys: [] })
    expect(initialized!.after).toEqual({ roleKeys: [RoleKeys.OPERATOR] })

    // 审计事件不含密码、token、cookie 等字段
    const serialized = JSON.stringify(page.items)
    for (const forbidden of ['password', 'token', 'cookie', 'secret', 'hash', 'session']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden)
    }
    expect(Object.keys(page.items[0]!).sort()).toEqual([
      'action',
      'actorId',
      'actorType',
      'after',
      'before',
      'createdAt',
      'id',
      'reason',
      'requestId',
      'targetId',
      'targetType',
    ])
  } finally {
    cleanup()
  }
})

it('审计查询支持过滤，并在相同 created_at 下按 id 稳定分页', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'audit-page-admin@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-page-admin@example.com', systemContext).kind).toBe('ok')

    // 多造几条事件，保证逐页取数足够多
    const other = await register(app, 'audit-page-other@example.com')
    const roleChange = await app.request(`/api/authorization/users/${other.user.id}/roles`, {
      method: 'PUT',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }),
    })
    expect(roleChange.status).toBe(200)
    const permissionChange = await app.request('/api/authorization/roles/viewer/permissions', {
      method: 'PUT',
      headers: { cookie: admin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionKeys: [PermissionKeys.FILE_LIST] }),
    })
    expect(permissionChange.status).toBe(200)

    // 把全部事件压到同一个 created_at，只留 id 作为区分
    const sameInstant = new Date(1700000000000)
    runtime.db.update(authorizationAuditEvents).set({ createdAt: sameInstant }).run()
    const total = readAuditRows(runtime.db).length
    expect(total).toBeGreaterThanOrEqual(3)

    const collected: string[] = []
    for (let page = 1; page <= total; page += 1) {
      const response = await app.request(`/api/authorization/audit-events?page=${page}&pageSize=1`, {
        headers: { cookie: admin.cookie },
      })
      expect(response.status).toBe(200)
      const body = (await readSuccess<AuthorizationAuditEventPage>(response)).data
      expect(body.total).toBe(total)
      expect(body.items).toHaveLength(1)
      collected.push(body.items[0]!.id)
    }

    // 逐页取到的 id 不重复、不丢失，且与 id 倒序一致
    expect(new Set(collected).size).toBe(total)
    expect(collected).toEqual([...collected].sort().reverse())

    const filtered = await app.request(
      `/api/authorization/audit-events?action=${AuditActions.USER_ROLES_INITIALIZED}`,
      { headers: { cookie: admin.cookie } },
    )
    const filteredPage = (await readSuccess<AuthorizationAuditEventPage>(filtered)).data
    expect(filteredPage.items.length).toBeGreaterThan(0)
    expect(filteredPage.items.every((item) => item.action === AuditActions.USER_ROLES_INITIALIZED)).toBe(true)

    const actorFiltered = await app.request(`/api/authorization/audit-events?actorId=${admin.user.id}`, {
      headers: { cookie: admin.cookie },
    })
    const actorPage = (await readSuccess<AuthorizationAuditEventPage>(actorFiltered)).data
    expect(actorPage.items.length).toBeGreaterThan(0)
    expect(actorPage.items.every((item) => item.actorId === admin.user.id)).toBe(true)

    const targetFiltered = await app.request(`/api/authorization/audit-events?targetId=${other.user.id}`, {
      headers: { cookie: admin.cookie },
    })
    const targetPage = (await readSuccess<AuthorizationAuditEventPage>(targetFiltered)).data
    expect(targetPage.items.length).toBeGreaterThan(0)
    expect(targetPage.items.every((item) => item.targetId === other.user.id)).toBe(true)

    const sameInstantIso = encodeURIComponent(sameInstant.toISOString())
    const timeFiltered = await app.request(
      `/api/authorization/audit-events?from=${sameInstantIso}&to=${sameInstantIso}`,
      { headers: { cookie: admin.cookie } },
    )
    const timePage = (await readSuccess<AuthorizationAuditEventPage>(timeFiltered)).data
    expect(timePage.total).toBe(total)

    const afterSameInstant = encodeURIComponent(new Date(sameInstant.getTime() + 1).toISOString())
    const outsideRange = await app.request(`/api/authorization/audit-events?from=${afterSameInstant}`, {
      headers: { cookie: admin.cookie },
    })
    expect((await readSuccess<AuthorizationAuditEventPage>(outsideRange)).data.total).toBe(0)

    const unknownAction = await app.request('/api/authorization/audit-events?action=not-a-real-action', {
      headers: { cookie: admin.cookie },
    })
    expect(unknownAction.status).toBe(400)
  } finally {
    cleanup()
  }
})

it('损坏的审计 JSON、payload 或 target type 返回 500，不泄漏原始值', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'audit-corrupt@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-corrupt@example.com', systemContext).kind).toBe('ok')

    runtime.database.sqlite
      .prepare(
        `INSERT INTO authorization_audit_events
           (id, actor_type, actor_id, action, target_type, target_id,
            before_json, after_json, reason, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '019c3e00-0002-7000-8000-000000000001',
        'system',
        'test',
        AuditActions.USER_ROLES_REPLACED,
        'user',
        admin.user.id,
        'not json',
        JSON.stringify({ roleKeys: [] }),
        null,
        null,
        Date.now() + 1000,
      )

    const response = await app.request('/api/authorization/audit-events', {
      headers: { cookie: admin.cookie },
    })
    expect(response.status).toBe(500)
    const failure = await readFailure(response)
    expect(failure.error.code).toBe(ApiErrorCodes.SYSTEM_INTERNAL_ERROR)
    expect(JSON.stringify(failure)).not.toContain('not json')

    runtime.database.sqlite
      .prepare('DELETE FROM authorization_audit_events WHERE id = ?')
      .run('019c3e00-0002-7000-8000-000000000001')
    runtime.database.sqlite
      .prepare(
        `INSERT INTO authorization_audit_events
           (id, actor_type, actor_id, action, target_type, target_id,
            before_json, after_json, reason, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '019c3e00-0002-7000-8000-000000000003',
        'system',
        'test',
        AuditActions.ROLE_PERMISSIONS_REPLACED,
        'role',
        RoleKeys.VIEWER,
        JSON.stringify({ roleKeys: [] }),
        JSON.stringify({ permissionKeys: [] }),
        null,
        null,
        Date.now() + 1000,
      )

    const mismatched = await app.request('/api/authorization/audit-events', {
      headers: { cookie: admin.cookie },
    })
    expect(mismatched.status).toBe(500)
    expect((await readFailure(mismatched)).error.code).toBe(ApiErrorCodes.SYSTEM_INTERNAL_ERROR)

    runtime.database.sqlite
      .prepare('DELETE FROM authorization_audit_events WHERE id = ?')
      .run('019c3e00-0002-7000-8000-000000000003')
    runtime.database.sqlite
      .prepare(
        `INSERT INTO authorization_audit_events
           (id, actor_type, actor_id, action, target_type, target_id,
            before_json, after_json, reason, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '019c3e00-0002-7000-8000-000000000004',
        'system',
        'test',
        AuditActions.ROLE_PERMISSIONS_REPLACED,
        'user',
        RoleKeys.VIEWER,
        JSON.stringify({ permissionKeys: [] }),
        JSON.stringify({ permissionKeys: [PermissionKeys.FILE_LIST] }),
        null,
        null,
        Date.now() + 1000,
      )

    const mismatchedTarget = await app.request('/api/authorization/audit-events', { headers: { cookie: admin.cookie } })
    expect(mismatchedTarget.status).toBe(500)
    expect((await readFailure(mismatchedTarget)).error.code).toBe(ApiErrorCodes.SYSTEM_INTERNAL_ERROR)
  } finally {
    cleanup()
  }
})

it('持有 authorization-audit:read 的非管理员可以读审计但不能写授权', async () => {
  const { app, cleanup, runtime } = createTestApp()
  try {
    const admin = await register(app, 'audit-scope-admin@example.com')
    const auditor = await register(app, 'audit-scope-viewer@example.com')
    const repository = createAuthorizationRepository(runtime.db)
    expect(repository.bootstrapAdminByEmail('audit-scope-admin@example.com', systemContext).kind).toBe('ok')

    grantPermissionToRole(runtime.db, RoleKeys.OPERATOR, PermissionKeys.AUTHORIZATION_AUDIT_READ)

    const readable = await app.request('/api/authorization/audit-events', {
      headers: { cookie: auditor.cookie },
    })
    expect(readable.status).toBe(200)

    // 只读权限不带来写能力
    const write = await app.request(`/api/authorization/users/${admin.user.id}/roles`, {
      method: 'PUT',
      headers: { cookie: auditor.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }),
    })
    expect(write.status).toBe(403)
  } finally {
    cleanup()
  }
})

it('审计事件类型在 contracts 中按 action 判别 payload', () => {
  const roleEvent: AuthorizationAuditEvent = {
    id: '019c3e00-0002-7000-8000-000000000002',
    actorType: 'system',
    actorId: 'test',
    action: AuditActions.USER_ROLES_REPLACED,
    targetType: 'user',
    targetId: 'user-1',
    before: { roleKeys: [RoleKeys.OPERATOR] },
    after: { roleKeys: [RoleKeys.VIEWER] },
    reason: null,
    requestId: null,
    createdAt: new Date().toISOString(),
  }
  const permissionEvent: AuthorizationAuditEvent = {
    ...roleEvent,
    action: AuditActions.ROLE_PERMISSIONS_REPLACED,
    targetType: 'role',
    targetId: RoleKeys.VIEWER,
    before: { permissionKeys: [PermissionKeys.FILE_LIST] },
    after: { permissionKeys: [] },
  }

  // 缩窄后直接访问对应字段：类型已经保证两个 action 分支的 payload 不会弄反。
  expect(roleEvent.before.roleKeys).toEqual([RoleKeys.OPERATOR])
  expect(permissionEvent.before.permissionKeys).toEqual([PermissionKeys.FILE_LIST])
})
