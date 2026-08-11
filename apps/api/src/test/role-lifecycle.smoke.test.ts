import type {
  AuthorizationPermissionImpact,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationRoleImpact,
} from "@starter/contracts";
import {
  ApiErrorCodes,
  AuditActions,
  PermissionKeys,
  RoleKeys,
} from "@starter/contracts";
import { asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  authorizationAuditEvents,
  permissions,
  rolePermissions,
  roles,
} from "@api/infra/db/schema/index.js";
import { createAuthorizationRepository } from "@api/modules/authorization/index.js";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

const systemContext = {
  actorType: "system",
  actorId: "test:role-lifecycle",
  requestId: null,
} as const;

type TestApp = ReturnType<typeof createTestApp>;
type TestDb = TestApp["runtime"]["db"];

function readRoleAuditRows(db: TestDb, targetId: string) {
  return db
    .select()
    .from(authorizationAuditEvents)
    .orderBy(
      asc(authorizationAuditEvents.createdAt),
      asc(authorizationAuditEvents.id),
    )
    .all()
    .filter((row) => row.targetId === targetId);
}

function readRoleUpdatedAt(db: TestDb, roleKey: string) {
  const row = db
    .select({ updatedAt: roles.updatedAt })
    .from(roles)
    .where(eq(roles.key, roleKey))
    .get();
  return row?.updatedAt;
}

async function setupAdmin(app: TestApp["app"], db: TestDb, email: string) {
  const admin = await register(app, email);
  const repository = createAuthorizationRepository(db);
  expect(repository.bootstrapAdminByEmail(email, systemContext).kind).toBe(
    "ok",
  );
  return admin;
}

function jsonHeaders(cookie: string) {
  return { cookie, "Content-Type": "application/json" };
}

it("创建自定义角色并在同一 transaction 写初始 permission 和 role.created", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-create@example.com");

    const emptyResponse = await app.request("/api/authorization/roles", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({
        key: "auditor",
        name: "审计员",
        description: null,
        permissionKeys: [],
      }),
    });
    expect(emptyResponse.status).toBe(200);
    const emptyRole = (await readSuccess<AuthorizationRole>(emptyResponse))
      .data;
    expect(emptyRole).toMatchObject({
      key: "auditor",
      isSystem: false,
      archivedAt: null,
      metadataEditable: true,
      permissionsEditable: true,
      lifecycleEditable: true,
      permissionKeys: [],
    });

    const response = await app.request("/api/authorization/roles", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({
        key: "file-clerk",
        name: "文件管理员",
        description: "只管文件",
        permissionKeys: [PermissionKeys.FILE_READ, PermissionKeys.FILE_LIST],
      }),
    });
    expect(response.status).toBe(200);
    const role = (await readSuccess<AuthorizationRole>(response)).data;
    expect(role.permissionKeys).toEqual([
      PermissionKeys.FILE_LIST,
      PermissionKeys.FILE_READ,
    ]);

    const auditRows = readRoleAuditRows(runtime.db, "file-clerk");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: AuditActions.ROLE_CREATED,
      targetType: "role",
      actorId: admin.user.id,
      requestId: expect.any(String),
    });
    expect(JSON.parse(auditRows[0]!.beforeJson)).toEqual({ role: null });
    expect(JSON.parse(auditRows[0]!.afterJson)).toEqual({
      role: {
        name: "文件管理员",
        description: "只管文件",
        permissionKeys: [PermissionKeys.FILE_LIST, PermissionKeys.FILE_READ],
        archived: false,
      },
    });
  } finally {
    cleanup();
  }
});

it("重复 key 返回 409 且不产生角色和审计事件", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-dup@example.com");

    const create = (key: string) =>
      app.request("/api/authorization/roles", {
        method: "POST",
        headers: jsonHeaders(admin.cookie),
        body: JSON.stringify({
          key,
          name: "重复测试",
          description: null,
          permissionKeys: [],
        }),
      });

    // 与活动系统角色冲突
    const activeConflict = await create("operator");
    expect(activeConflict.status).toBe(409);
    expect((await readFailure(activeConflict)).error.code).toBe(
      ApiErrorCodes.AUTH_ROLE_KEY_CONFLICT,
    );

    // 与归档角色冲突：key 不因归档释放
    expect((await create("temp-role")).status).toBe(200);
    const archive = await app.request(
      "/api/authorization/roles/temp-role/archive",
      { method: "POST", headers: jsonHeaders(admin.cookie) },
    );
    expect(archive.status).toBe(200);
    const archivedConflict = await create("temp-role");
    expect(archivedConflict.status).toBe(409);

    const roleRows = runtime.db
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.key, "temp-role"))
      .all();
    expect(roleRows).toHaveLength(1);
    // 冲突请求不追加审计事件：只有 created + archived 两条
    expect(readRoleAuditRows(runtime.db, "temp-role")).toHaveLength(2);
  } finally {
    cleanup();
  }
});

it("无效 permission 创建返回 400，角色和审计整体回滚", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-invalid@example.com");

    const response = await app.request("/api/authorization/roles", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({
        key: "bad-role",
        name: "坏角色",
        description: null,
        permissionKeys: ["file:nonexistent"],
      }),
    });
    expect(response.status).toBe(400);

    expect(
      runtime.db.select().from(roles).where(eq(roles.key, "bad-role")).all(),
    ).toHaveLength(0);
    expect(readRoleAuditRows(runtime.db, "bad-role")).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("归档 permission 创建返回 400，角色、关系和审计都不变", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(
      app,
      runtime.db,
      "rl-archived-permission@example.com",
    );
    const permission = runtime.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, PermissionKeys.FILE_READ))
      .get();
    expect(permission).toBeDefined();
    runtime.db
      .update(permissions)
      .set({ archivedAt: new Date() })
      .where(eq(permissions.id, permission!.id))
      .run();

    const relationRowsBefore = runtime.db.select().from(rolePermissions).all();
    const auditRowsBefore = runtime.db
      .select()
      .from(authorizationAuditEvents)
      .all();
    const response = await app.request("/api/authorization/roles", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({
        key: "archived-permission-role",
        name: "归档权限角色",
        description: null,
        permissionKeys: [PermissionKeys.FILE_READ],
      }),
    });

    expect(response.status).toBe(400);
    expect((await readFailure(response)).error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );
    expect(
      runtime.db
        .select()
        .from(roles)
        .where(eq(roles.key, "archived-permission-role"))
        .all(),
    ).toHaveLength(0);
    expect(runtime.db.select().from(rolePermissions).all()).toHaveLength(
      relationRowsBefore.length,
    );
    expect(
      runtime.db.select().from(authorizationAuditEvents).all(),
    ).toHaveLength(auditRowsBefore.length);
  } finally {
    cleanup();
  }
});

it("创建角色时 role_permissions 写入失败会回滚角色和审计", async () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const repository = createAuthorizationRepository(runtime.db);
    const relationRowsBefore = runtime.db.select().from(rolePermissions).all();
    runtime.database.sqlite.exec(
      "CREATE TRIGGER role_permissions_block BEFORE INSERT ON role_permissions BEGIN SELECT RAISE(ABORT, 'role permission insert blocked'); END",
    );

    expect(() =>
      repository.createRole(
        {
          key: "relation-rollback-role",
          name: "关系回滚",
          description: null,
          permissionKeys: [PermissionKeys.FILE_LIST],
        },
        systemContext,
      ),
    ).toThrow(/role permission insert blocked/);

    expect(
      runtime.db
        .select()
        .from(roles)
        .where(eq(roles.key, "relation-rollback-role"))
        .all(),
    ).toHaveLength(0);
    expect(runtime.db.select().from(rolePermissions).all()).toHaveLength(
      relationRowsBefore.length,
    );
    expect(
      readRoleAuditRows(runtime.db, "relation-rollback-role"),
    ).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("创建角色时审计写入失败会回滚角色和 permission 关系", async () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const repository = createAuthorizationRepository(runtime.db);
    const relationRowsBefore = runtime.db.select().from(rolePermissions).all();
    runtime.database.sqlite.exec(
      "CREATE TRIGGER role_create_audit_block BEFORE INSERT ON authorization_audit_events BEGIN SELECT RAISE(ABORT, 'role create audit blocked'); END",
    );

    expect(() =>
      repository.createRole(
        {
          key: "audit-rollback-role",
          name: "审计回滚",
          description: null,
          permissionKeys: [PermissionKeys.FILE_LIST],
        },
        systemContext,
      ),
    ).toThrow(/role create audit blocked/);

    const role = runtime.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, "audit-rollback-role"))
      .get();
    expect(role).toBeUndefined();
    expect(runtime.db.select().from(rolePermissions).all()).toHaveLength(
      relationRowsBefore.length,
    );
    expect(readRoleAuditRows(runtime.db, "audit-rollback-role")).toHaveLength(
      0,
    );
  } finally {
    cleanup();
  }
});

it("持有 authorization:manage 的非 admin 对所有新增写接口仍返回 403", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-admin@example.com");
    const operator = await register(app, "rl-operator@example.com");

    // 给 operator 授予 authorization:manage
    const role = runtime.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, RoleKeys.OPERATOR))
      .get();
    const permission = runtime.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, PermissionKeys.AUTHORIZATION_MANAGE))
      .get();
    runtime.db
      .insert(rolePermissions)
      .values({
        roleId: role!.id,
        permissionId: permission!.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .run();

    // 先由 admin 创建一个可操作角色
    const created = await app.request("/api/authorization/roles", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({
        key: "guarded",
        name: "被保护",
        description: null,
        permissionKeys: [],
      }),
    });
    expect(created.status).toBe(200);

    const attempts: [string, RequestInit][] = [
      [
        "/api/authorization/roles",
        {
          method: "POST",
          headers: jsonHeaders(operator.cookie),
          body: JSON.stringify({
            key: "sneaky",
            name: "越权",
            description: null,
            permissionKeys: [],
          }),
        },
      ],
      [
        "/api/authorization/roles/guarded",
        {
          method: "PATCH",
          headers: jsonHeaders(operator.cookie),
          body: JSON.stringify({ name: "改名" }),
        },
      ],
      [
        "/api/authorization/roles/guarded/archive",
        { method: "POST", headers: jsonHeaders(operator.cookie) },
      ],
      [
        "/api/authorization/roles/guarded/restore",
        { method: "POST", headers: jsonHeaders(operator.cookie) },
      ],
    ];
    for (const [path, init] of attempts) {
      const response = await app.request(path, init);
      expect(response.status).toBe(403);
      expect((await readFailure(response)).error.code).toBe(
        ApiErrorCodes.AUTH_FORBIDDEN,
      );
    }
    // 角色未被改动
    expect(
      runtime.db
        .select({ name: roles.name, archivedAt: roles.archivedAt })
        .from(roles)
        .where(eq(roles.key, "guarded"))
        .get(),
    ).toMatchObject({ name: "被保护", archivedAt: null });
    expect(
      runtime.db.select().from(roles).where(eq(roles.key, "sneaky")).all(),
    ).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("metadata PATCH 支持部分更新、幂等短路、系统角色和归档角色拒绝", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-patch@example.com");

    await app.request("/api/authorization/roles", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({
        key: "editor",
        name: "编辑",
        description: "初始描述",
        permissionKeys: [],
      }),
    });

    // 部分更新：只改名称
    const renamed = await app.request("/api/authorization/roles/editor", {
      method: "PATCH",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ name: "高级编辑" }),
    });
    expect(renamed.status).toBe(200);
    const renamedRole = (await readSuccess<AuthorizationRole>(renamed)).data;
    expect(renamedRole).toMatchObject({
      name: "高级编辑",
      description: "初始描述",
    });

    // 幂等：内容相同不写事件
    const idempotentUpdatedAt = new Date("2000-01-01T00:00:00.000Z");
    runtime.db
      .update(roles)
      .set({ updatedAt: idempotentUpdatedAt })
      .where(eq(roles.key, "editor"))
      .run();
    const idempotent = await app.request("/api/authorization/roles/editor", {
      method: "PATCH",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ name: "高级编辑", description: "初始描述" }),
    });
    expect(idempotent.status).toBe(200);
    expect(readRoleUpdatedAt(runtime.db, "editor")).toEqual(
      idempotentUpdatedAt,
    );

    const auditRows = readRoleAuditRows(runtime.db, "editor");
    const updatedRows = auditRows.filter(
      (row) => row.action === AuditActions.ROLE_UPDATED,
    );
    expect(updatedRows).toHaveLength(1);
    expect(JSON.parse(updatedRows[0]!.beforeJson)).toEqual({
      name: "编辑",
      description: "初始描述",
    });
    expect(JSON.parse(updatedRows[0]!.afterJson)).toEqual({
      name: "高级编辑",
      description: "初始描述",
    });

    // 系统角色拒绝
    const systemPatch = await app.request("/api/authorization/roles/viewer", {
      method: "PATCH",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ name: "新名字" }),
    });
    expect(systemPatch.status).toBe(403);

    // 归档角色按 not-found 拒绝
    await app.request("/api/authorization/roles/editor/archive", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
    });
    const archivedPatch = await app.request("/api/authorization/roles/editor", {
      method: "PATCH",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ name: "又一个名字" }),
    });
    expect(archivedPatch.status).toBe(404);
  } finally {
    cleanup();
  }
});

it("归档、恢复与用户分配保护", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-arch@example.com");
    const member = await register(app, "rl-member@example.com");
    const secondMember = await register(app, "rl-member-2@example.com");

    await app.request("/api/authorization/roles", {
      method: "POST",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({
        key: "temp-team",
        name: "临时团队",
        description: null,
        permissionKeys: [PermissionKeys.FILE_LIST],
      }),
    });

    // 分配用户后归档返回 409 和数量
    const assign = await app.request(
      `/api/authorization/users/${member.user.id}/roles`,
      {
        method: "PUT",
        headers: jsonHeaders(admin.cookie),
        body: JSON.stringify({ roleKeys: ["temp-team"] }),
      },
    );
    expect(assign.status).toBe(200);
    const secondAssign = await app.request(
      `/api/authorization/users/${secondMember.user.id}/roles`,
      {
        method: "PUT",
        headers: jsonHeaders(admin.cookie),
        body: JSON.stringify({ roleKeys: ["temp-team"] }),
      },
    );
    expect(secondAssign.status).toBe(200);

    const blocked = await app.request(
      "/api/authorization/roles/temp-team/archive",
      { method: "POST", headers: jsonHeaders(admin.cookie) },
    );
    expect(blocked.status).toBe(409);
    const blockedBody = await readFailure(blocked);
    expect(blockedBody.error.code).toBe(ApiErrorCodes.AUTH_ROLE_IN_USE);
    expect(blockedBody.error.details).toEqual({ assignedUserCount: 2 });

    // role impact 与分配一致
    const impact = await app.request(
      "/api/authorization/roles/temp-team/impact",
      { headers: { cookie: admin.cookie } },
    );
    expect((await readSuccess<AuthorizationRoleImpact>(impact)).data).toEqual({
      roleKey: "temp-team",
      assignedUserCount: 2,
    });

    // 移除分配后可以归档
    await app.request(`/api/authorization/users/${member.user.id}/roles`, {
      method: "PUT",
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }),
    });
    await app.request(
      `/api/authorization/users/${secondMember.user.id}/roles`,
      {
        method: "PUT",
        headers: jsonHeaders(admin.cookie),
        body: JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }),
      },
    );
    const archived = await app.request(
      "/api/authorization/roles/temp-team/archive",
      { method: "POST", headers: jsonHeaders(admin.cookie) },
    );
    expect(archived.status).toBe(200);
    const archivedRole = (await readSuccess<AuthorizationRole>(archived)).data;
    expect(archivedRole.archivedAt).not.toBeNull();
    expect(archivedRole.metadataEditable).toBe(false);
    expect(archivedRole.permissionsEditable).toBe(false);

    // 归档角色不能分配、不能修改 permission
    const assignArchived = await app.request(
      `/api/authorization/users/${member.user.id}/roles`,
      {
        method: "PUT",
        headers: jsonHeaders(admin.cookie),
        body: JSON.stringify({ roleKeys: ["temp-team"] }),
      },
    );
    expect(assignArchived.status).toBe(400);
    const replaceArchived = await app.request(
      "/api/authorization/roles/temp-team/permissions",
      {
        method: "PUT",
        headers: jsonHeaders(admin.cookie),
        body: JSON.stringify({ permissionKeys: [] }),
      },
    );
    expect(replaceArchived.status).toBe(404);

    // 归档目录能查到它，活动目录查不到
    const archivedCatalog = await app.request(
      "/api/authorization/roles?status=archived",
      { headers: { cookie: admin.cookie } },
    );
    const archivedData = (
      await readSuccess<AuthorizationRoleCatalog>(archivedCatalog)
    ).data;
    expect(archivedData.roles.map((role) => role.key)).toEqual(["temp-team"]);
    expect(archivedData.roles[0]!.permissionKeys).toEqual([
      PermissionKeys.FILE_LIST,
    ]);
    const activeCatalog = await app.request("/api/authorization/roles", {
      headers: { cookie: admin.cookie },
    });
    expect(
      (
        await readSuccess<AuthorizationRoleCatalog>(activeCatalog)
      ).data.roles.map((role) => role.key),
    ).not.toContain("temp-team");

    // 重复归档幂等，不写事件，也不刷新 updatedAt
    const archivedUpdatedAt = new Date("2001-01-01T00:00:00.000Z");
    runtime.db
      .update(roles)
      .set({ updatedAt: archivedUpdatedAt })
      .where(eq(roles.key, "temp-team"))
      .run();
    const rearchive = await app.request(
      "/api/authorization/roles/temp-team/archive",
      { method: "POST", headers: jsonHeaders(admin.cookie) },
    );
    expect(rearchive.status).toBe(200);
    expect(readRoleUpdatedAt(runtime.db, "temp-team")).toEqual(
      archivedUpdatedAt,
    );

    // 恢复保留 permission
    const restored = await app.request(
      "/api/authorization/roles/temp-team/restore",
      { method: "POST", headers: jsonHeaders(admin.cookie) },
    );
    expect(restored.status).toBe(200);
    const restoredRole = (await readSuccess<AuthorizationRole>(restored)).data;
    expect(restoredRole.archivedAt).toBeNull();
    expect(restoredRole.permissionKeys).toEqual([PermissionKeys.FILE_LIST]);

    // 重复恢复幂等，不写事件，也不刷新 updatedAt
    const restoredUpdatedAt = new Date("2002-01-01T00:00:00.000Z");
    runtime.db
      .update(roles)
      .set({ updatedAt: restoredUpdatedAt })
      .where(eq(roles.key, "temp-team"))
      .run();
    const rerestore = await app.request(
      "/api/authorization/roles/temp-team/restore",
      { method: "POST", headers: jsonHeaders(admin.cookie) },
    );
    expect(rerestore.status).toBe(200);
    expect(readRoleUpdatedAt(runtime.db, "temp-team")).toEqual(
      restoredUpdatedAt,
    );

    // 系统角色不能归档或恢复
    for (const path of [
      "/api/authorization/roles/admin/archive",
      "/api/authorization/roles/viewer/archive",
      "/api/authorization/roles/viewer/restore",
    ]) {
      const response = await app.request(path, {
        method: "POST",
        headers: jsonHeaders(admin.cookie),
      });
      expect(response.status).toBe(403);
    }

    // 审计事件序列：created、archived、restored 各一条，幂等操作不追加
    const auditRows = readRoleAuditRows(runtime.db, "temp-team");
    expect(auditRows.map((row) => row.action)).toEqual([
      AuditActions.ROLE_CREATED,
      AuditActions.ROLE_ARCHIVED,
      AuditActions.ROLE_RESTORED,
    ]);
    expect(auditRows.every((row) => row.actorId === admin.user.id)).toBe(true);
    expect(auditRows.every((row) => typeof row.requestId === "string")).toBe(
      true,
    );
    expect(JSON.parse(auditRows[1]!.beforeJson)).toEqual({ archived: false });
    expect(JSON.parse(auditRows[1]!.afterJson)).toEqual({ archived: true });
    expect(JSON.parse(auditRows[2]!.beforeJson)).toEqual({ archived: true });
    expect(JSON.parse(auditRows[2]!.afterJson)).toEqual({ archived: false });
  } finally {
    cleanup();
  }
});

it("permission impact 合并 admin 自动权限并对用户去重", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-impact@example.com");
    const multi = await register(app, "rl-multi@example.com");

    // multi 同时持有 operator 和 viewer，两个角色都提供 file:list
    const assign = await app.request(
      `/api/authorization/users/${multi.user.id}/roles`,
      {
        method: "PUT",
        headers: jsonHeaders(admin.cookie),
        body: JSON.stringify({
          roleKeys: [RoleKeys.OPERATOR, RoleKeys.VIEWER],
        }),
      },
    );
    expect(assign.status).toBe(200);

    const response = await app.request(
      `/api/authorization/permissions/${PermissionKeys.FILE_LIST}/impact`,
      { headers: { cookie: admin.cookie } },
    );
    expect(response.status).toBe(200);
    const impact = (await readSuccess<AuthorizationPermissionImpact>(response))
      .data;
    // admin 没有 file:list 的 role_permissions 行，但必须出现在有效角色里
    expect(impact.roleKeys).toEqual([
      RoleKeys.ADMIN,
      RoleKeys.OPERATOR,
      RoleKeys.VIEWER,
    ]);
    // multi 持有两个角色只计一次；admin 一人 → 共 2 人
    expect(impact.affectedUserCount).toBe(2);

    // authorization-audit:read 只挂在 admin 上，验证纯 admin 分支
    const auditImpact = await app.request(
      `/api/authorization/permissions/${PermissionKeys.AUTHORIZATION_AUDIT_READ}/impact`,
      { headers: { cookie: admin.cookie } },
    );
    const auditImpactData = (
      await readSuccess<AuthorizationPermissionImpact>(auditImpact)
    ).data;
    expect(auditImpactData.roleKeys).toContain(RoleKeys.ADMIN);
    expect(auditImpactData.affectedUserCount).toBeGreaterThanOrEqual(1);
  } finally {
    cleanup();
  }
});

it("新 action 的损坏 payload 或 targetType 返回 500", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await setupAdmin(app, runtime.db, "rl-corrupt@example.com");

    runtime.db
      .insert(authorizationAuditEvents)
      .values({
        id: "019c3e00-0020-7000-8000-000000000001",
        actorType: "user",
        actorId: admin.user.id,
        action: AuditActions.ROLE_ARCHIVED,
        targetType: "role",
        targetId: "broken-role",
        beforeJson: '{"roleKeys":["not-lifecycle-shape"]}',
        afterJson: '{"archived":true}',
        reason: null,
        requestId: null,
        createdAt: new Date(),
      })
      .run();

    const response = await app.request("/api/authorization/audit-events", {
      headers: { cookie: admin.cookie },
    });
    expect(response.status).toBe(500);
    const failure = await readFailure(response);
    expect(failure.error.code).toBe(ApiErrorCodes.SYSTEM_INTERNAL_ERROR);
    expect(JSON.stringify(failure)).not.toContain("not-lifecycle-shape");

    runtime.db
      .delete(authorizationAuditEvents)
      .where(
        eq(authorizationAuditEvents.id, "019c3e00-0020-7000-8000-000000000001"),
      )
      .run();
    runtime.db
      .insert(authorizationAuditEvents)
      .values({
        id: "019c3e00-0020-7000-8000-000000000002",
        actorType: "user",
        actorId: admin.user.id,
        action: AuditActions.ROLE_CREATED,
        targetType: "user",
        targetId: "broken-role-target",
        beforeJson: '{"role":null}',
        afterJson:
          '{"role":{"name":"broken","description":null,"permissionKeys":[],"archived":false}}',
        reason: null,
        requestId: null,
        createdAt: new Date(),
      })
      .run();

    const targetResponse = await app.request(
      "/api/authorization/audit-events",
      { headers: { cookie: admin.cookie } },
    );
    expect(targetResponse.status).toBe(500);
    expect((await readFailure(targetResponse)).error.code).toBe(
      ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
    );
  } finally {
    cleanup();
  }
});
