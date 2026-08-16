import type {
  AuthorizationRoleCatalog,
  AuthorizationUser,
  CurrentPermissions,
  FileItem,
} from "@starter/contracts";
import { ApiErrorCodes, PermissionKeys, RoleKeys } from "@starter/contracts";
import { and, eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { createAuthorizationRepository } from "@api/modules/authorization/index.js";
import { runBootstrapAdmin } from "@api/scripts/bootstrap-admin.js";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../infra/db/migrations",
);

it("授权 migration 写入系统目录并给已有用户回填 operator", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(
      readFileSync(resolve(migrationsFolder, "0000_broken_komodo.sql"), "utf8"),
    );
    sqlite
      .prepare(
        `INSERT INTO user
          (id, name, email, email_verified, image, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "019c3e00-0010-7000-8000-000000000001",
        "Existing User",
        "existing@example.com",
        0,
        null,
        1786254001432,
        1786254001432,
      );

    sqlite.exec(
      readFileSync(resolve(migrationsFolder, "0001_tidy_hellcat.sql"), "utf8"),
    );
    sqlite.exec(
      readFileSync(
        resolve(migrationsFolder, "0002_mean_iron_fist.sql"),
        "utf8",
      ),
    );
    sqlite.exec(
      readFileSync(
        resolve(migrationsFolder, "0004_system_logs_read.sql"),
        "utf8",
      ),
    );
    sqlite.exec(
      readFileSync(resolve(migrationsFolder, "0005_pale_madrox.sql"), "utf8"),
    );
    sqlite.exec(
      readFileSync(resolve(migrationsFolder, "0006_crazy_banshee.sql"), "utf8"),
    );
    sqlite.exec(
      readFileSync(
        resolve(migrationsFolder, "0007_clammy_shinobi_shaw.sql"),
        "utf8",
      ),
    );

    expect(sqlite.prepare("SELECT key FROM roles ORDER BY key").all()).toEqual([
      { key: "admin" },
      { key: "operator" },
      { key: "viewer" },
    ]);
    expect(
      sqlite.prepare("SELECT key FROM permissions ORDER BY key").all(),
    ).toEqual(
      Object.values(PermissionKeys)
        .sort()
        .map((key) => ({ key })),
    );
    expect(
      sqlite
        .prepare(
          `SELECT roles.key
             FROM user_roles
             INNER JOIN roles ON user_roles.role_id = roles.id
            WHERE user_roles.user_id = ?`,
        )
        .get("019c3e00-0010-7000-8000-000000000001"),
    ).toEqual({ key: RoleKeys.OPERATOR });
  } finally {
    sqlite.close();
  }
});

it("bootstrap admin 命令返回可执行的配置和 migration 错误", () => {
  const testDir = mkdtempSync(join(tmpdir(), "starter-bootstrap-"));
  const errors: string[] = [];
  const output = {
    error(message: string) {
      errors.push(message);
    },
    log() {},
  };
  const baseEnv = {
    APP_ENV: "test",
    BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
    DATABASE_PATH: join(testDir, "app.db"),
    FILES_DIR: join(testDir, "files"),
  };

  try {
    expect(runBootstrapAdmin(baseEnv, output)).toBe(1);
    expect(errors.at(-1)).toContain("未配置 AUTH_BOOTSTRAP_ADMIN_EMAIL");

    expect(
      runBootstrapAdmin(
        { ...baseEnv, AUTH_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com" },
        output,
      ),
    ).toBe(1);
    expect(errors.at(-1)).toContain(
      "请先运行 pnpm --filter @starter/api db:migrate",
    );
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});

it("权限查询区分 401、403，默认 operator 和多角色权限并集可用", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const unauthenticated = await app.request("/api/me/permissions");
    expect(unauthenticated.status).toBe(401);
    expect((await readFailure(unauthenticated)).error.code).toBe(
      ApiErrorCodes.AUTH_UNAUTHENTICATED,
    );

    const admin = await register(app, "admin@example.com");
    const viewer = await register(app, "viewer@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    };
    const bootstrapMessages: string[] = [];
    const bootstrapOutput = {
      error(message: string) {
        bootstrapMessages.push(message);
      },
      log(message: string) {
        bootstrapMessages.push(message);
      },
    };
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);
    expect(
      runBootstrapAdmin(
        {
          ...bootstrapEnv,
          AUTH_BOOTSTRAP_ADMIN_EMAIL: "missing@example.com",
        },
        bootstrapOutput,
      ),
    ).toBe(1);
    expect(bootstrapMessages.at(-1)).toContain("请先注册账号");
    expect(
      runtime.db
        .select()
        .from(userRoles)
        .where(eq(userRoles.userId, admin.user.id))
        .all(),
    ).toHaveLength(1);

    const operatorPermissions = await app.request("/api/me/permissions", {
      headers: { cookie: viewer.cookie },
    });
    expect(operatorPermissions.status).toBe(200);
    const operatorData = (
      await readSuccess<CurrentPermissions>(operatorPermissions)
    ).data;
    expect(operatorData.roles).toEqual([RoleKeys.OPERATOR]);
    expect(operatorData.permissions).toEqual([
      PermissionKeys.FILE_DELETE,
      PermissionKeys.FILE_LIST,
      PermissionKeys.FILE_READ,
      PermissionKeys.FILE_RENAME,
      PermissionKeys.FILE_UPLOAD,
    ]);

    const deniedManagement = await app.request("/api/authorization/users", {
      headers: { cookie: viewer.cookie },
    });
    expect(deniedManagement.status).toBe(403);
    expect((await readFailure(deniedManagement)).error.code).toBe(
      ApiErrorCodes.AUTH_FORBIDDEN,
    );

    const adminPermissions = await app.request("/api/me/permissions", {
      headers: { cookie: admin.cookie },
    });
    expect(
      (await readSuccess<CurrentPermissions>(adminPermissions)).data
        .permissions,
    ).toHaveLength(Object.values(PermissionKeys).length);

    const union = runtime.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, RoleKeys.VIEWER))
      .get();
    expect(union).toBeDefined();
    runtime.db
      .insert(userRoles)
      .values({
        userId: viewer.user.id,
        roleId: union!.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .run();

    const unionPermissions = await app.request("/api/me/permissions", {
      headers: { cookie: viewer.cookie },
    });
    const unionData = (await readSuccess<CurrentPermissions>(unionPermissions))
      .data;
    expect(unionData.roles).toEqual([RoleKeys.OPERATOR, RoleKeys.VIEWER]);
    expect(unionData.version).not.toBe(operatorData.version);
    expect(unionData.permissions).toHaveLength(5);

    const isolated = await app.request(
      `/api/me/permissions?userId=${admin.user.id}`,
      { headers: { cookie: viewer.cookie } },
    );
    expect(
      (await readSuccess<CurrentPermissions>(isolated)).data.roles,
    ).toEqual([RoleKeys.OPERATOR, RoleKeys.VIEWER]);
  } finally {
    cleanup();
  }
});

it("权限表查询失败返回 500，不降级为 403", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const operator = await register(app, "database-error@example.com");
    runtime.database.sqlite.exec(
      "ALTER TABLE permissions RENAME TO permissions_unavailable",
    );

    const response = await app.request("/api/files", {
      headers: { cookie: operator.cookie },
    });
    expect(response.status).toBe(500);
    expect((await readFailure(response)).error.code).toBe(
      ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
    );
  } finally {
    cleanup();
  }
});

it("管理接口使用事务替换角色，viewer 写操作拒绝且归档立即失效", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "owner-admin@example.com");
    const viewer = await register(app, "owner-viewer@example.com");
    const repository = createAuthorizationRepository(runtime.db);
    expect(
      repository.bootstrapAdminByEmail("owner-admin@example.com", {
        actorType: "system",
        actorId: "auth:bootstrap-admin",
        requestId: null,
      }).kind,
    ).toBe("ok");

    const users = await app.request("/api/authorization/users", {
      headers: { cookie: admin.cookie },
    });
    expect(users.status).toBe(200);
    expect(
      (await readSuccess<AuthorizationUser[]>(users)).data.find(
        (item) => item.id === viewer.user.id,
      )?.roleKeys,
    ).toEqual([RoleKeys.OPERATOR]);

    const replaceViewer = await app.request(
      `/api/authorization/users/${viewer.user.id}/roles`,
      {
        method: "PUT",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }),
      },
    );
    expect(replaceViewer.status).toBe(200);
    expect(
      (await readSuccess<AuthorizationUser>(replaceViewer)).data.roleKeys,
    ).toEqual([RoleKeys.VIEWER]);

    const rolesResponse = await app.request("/api/authorization/roles", {
      headers: { cookie: admin.cookie },
    });
    const catalog = (await readSuccess<AuthorizationRoleCatalog>(rolesResponse))
      .data;
    expect(
      catalog.roles.find((role) => role.key === RoleKeys.ADMIN),
    ).toMatchObject({
      permissionsEditable: false,
      permissionKeys: expect.arrayContaining(Object.values(PermissionKeys)),
    });

    const viewerBeforePermissionChange = await app.request(
      "/api/me/permissions",
      { headers: { cookie: viewer.cookie } },
    );
    const viewerBeforeData = (
      await readSuccess<CurrentPermissions>(viewerBeforePermissionChange)
    ).data;
    const replaceViewerPermissions = await app.request(
      "/api/authorization/roles/viewer/permissions",
      {
        method: "PUT",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissionKeys: [PermissionKeys.FILE_LIST] }),
      },
    );
    expect(replaceViewerPermissions.status).toBe(200);
    expect(
      (
        await readSuccess<AuthorizationRoleCatalog["roles"][number]>(
          replaceViewerPermissions,
        )
      ).data.permissionKeys,
    ).toEqual([PermissionKeys.FILE_LIST]);

    const viewerAfterPermissionChange = await app.request(
      "/api/me/permissions",
      { headers: { cookie: viewer.cookie } },
    );
    const viewerAfterData = (
      await readSuccess<CurrentPermissions>(viewerAfterPermissionChange)
    ).data;
    expect(viewerAfterData.permissions).toEqual([PermissionKeys.FILE_LIST]);
    expect(viewerAfterData.version).not.toBe(viewerBeforeData.version);

    const restoreViewerPermissions = await app.request(
      "/api/authorization/roles/viewer/permissions",
      {
        method: "PUT",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          permissionKeys: [PermissionKeys.FILE_LIST, PermissionKeys.FILE_READ],
        }),
      },
    );
    expect(restoreViewerPermissions.status).toBe(200);

    const selfMutation = await app.request(
      `/api/authorization/users/${admin.user.id}/roles`,
      {
        method: "PUT",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }),
      },
    );
    expect(selfMutation.status).toBe(403);
    expect((await readFailure(selfMutation)).error.code).toBe(
      ApiErrorCodes.AUTH_FORBIDDEN,
    );

    const protectedAdminMutation = await app.request(
      "/api/authorization/roles/admin/permissions",
      {
        method: "PUT",
        headers: {
          cookie: admin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissionKeys: [] }),
      },
    );
    expect(protectedAdminMutation.status).toBe(403);

    const form = new FormData();
    form.set("file", new File(["owned"], "owned.txt", { type: "text/plain" }));
    const upload = await app.request("/api/files", {
      method: "POST",
      headers: { cookie: admin.cookie },
      body: form,
    });
    const file = (await readSuccess<FileItem>(upload)).data;

    const viewerUpload = await app.request("/api/files", {
      method: "POST",
      headers: { cookie: viewer.cookie },
      body: form,
    });
    expect(viewerUpload.status).toBe(403);
    expect((await readFailure(viewerUpload)).error.code).toBe(
      ApiErrorCodes.AUTH_FORBIDDEN,
    );

    const viewerList = await app.request("/api/files", {
      headers: { cookie: viewer.cookie },
    });
    expect(viewerList.status).toBe(200);
    expect((await readSuccess<FileItem[]>(viewerList)).data).toEqual([]);

    const otherOwnerContent = await app.request(
      `/api/files/${file.id}/content`,
      { headers: { cookie: viewer.cookie } },
    );
    expect(otherOwnerContent.status).toBe(404);
    expect((await readFailure(otherOwnerContent)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    const operatorRole = runtime.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, RoleKeys.OPERATOR))
      .get();
    expect(operatorRole).toBeDefined();
    runtime.db
      .update(roles)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(roles.key, RoleKeys.VIEWER))
      .run();

    const archivedPermission = await app.request("/api/me/permissions", {
      headers: { cookie: viewer.cookie },
    });
    expect(
      (await readSuccess<CurrentPermissions>(archivedPermission)).data,
    ).toEqual({
      roles: [],
      permissions: [],
      version: expect.any(String),
    });
    expect(
      (
        await app.request(`/api/files/${file.id}/content`, {
          headers: { cookie: viewer.cookie },
        })
      ).status,
    ).toBe(403);

    runtime.db
      .update(permissions)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(permissions.key, PermissionKeys.FILE_UPLOAD),
          eq(permissions.isSystem, true),
        ),
      )
      .run();
    const archivedOperator = await app.request("/api/me/permissions", {
      headers: { cookie: admin.cookie },
    });
    expect(
      (await readSuccess<CurrentPermissions>(archivedOperator)).data
        .permissions,
    ).not.toContain(PermissionKeys.FILE_UPLOAD);
  } finally {
    cleanup();
  }
});

const systemContext = {
  actorType: "system",
  actorId: "auth:bootstrap-admin",
  requestId: null,
} as const;

/** 给指定角色补一条权限关联，用于构造"持有权限但不是平台管理员"的 actor。 */
function grantPermissionToRole(
  db: ReturnType<typeof createTestApp>["runtime"]["db"],
  roleKey: string,
  permissionKey: string,
) {
  const role = db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, roleKey))
    .get();
  const permission = db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, permissionKey))
    .get();
  expect(role).toBeDefined();
  expect(permission).toBeDefined();
  db.insert(rolePermissions)
    .values({
      roleId: role!.id,
      permissionId: permission!.id,
      assignedAt: new Date(),
      assignedBy: null,
    })
    .run();
}

function readUserRoleKeys(
  db: ReturnType<typeof createTestApp>["runtime"]["db"],
  userId: string,
) {
  return db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))
    .all()
    .map((role) => role.key)
    .sort();
}

function readRolePermissionKeys(
  db: ReturnType<typeof createTestApp>["runtime"]["db"],
  roleKey: string,
) {
  return db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(roles.key, roleKey))
    .all()
    .map((permission) => permission.key)
    .sort();
}

it("持有 authorization:manage 的非平台管理员不能写入授权关系", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "boundary-admin@example.com");
    const operator = await register(app, "boundary-operator@example.com");
    const target = await register(app, "boundary-target@example.com");
    const repository = createAuthorizationRepository(runtime.db);
    expect(
      repository.bootstrapAdminByEmail(
        "boundary-admin@example.com",
        systemContext,
      ).kind,
    ).toBe("ok");

    // 默认 seed 不给 operator 这个权限，必须显式构造才能走到 repository 的 actor 校验。
    grantPermissionToRole(
      runtime.db,
      RoleKeys.OPERATOR,
      PermissionKeys.AUTHORIZATION_MANAGE,
    );
    const operatorPermissions = await app.request("/api/me/permissions", {
      headers: { cookie: operator.cookie },
    });
    expect(
      (await readSuccess<CurrentPermissions>(operatorPermissions)).data
        .permissions,
    ).toContain(PermissionKeys.AUTHORIZATION_MANAGE);

    const deniedUserRoles = await app.request(
      `/api/authorization/users/${target.user.id}/roles`,
      {
        method: "PUT",
        headers: {
          cookie: operator.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roleKeys: [RoleKeys.ADMIN] }),
      },
    );
    expect(deniedUserRoles.status).toBe(403);
    const deniedUserRolesBody = await readFailure(deniedUserRoles);
    expect(deniedUserRolesBody.error.code).toBe(ApiErrorCodes.AUTH_FORBIDDEN);
    expect(deniedUserRolesBody.error.message).toBe(
      "只有平台管理员可以修改授权关系",
    );
    expect(readUserRoleKeys(runtime.db, target.user.id)).toEqual([
      RoleKeys.OPERATOR,
    ]);

    // 请求的权限集合和 viewer 当前值不同，被拒绝后关系必须保持原样。
    const viewerPermissionsBefore = readRolePermissionKeys(
      runtime.db,
      RoleKeys.VIEWER,
    );
    expect(viewerPermissionsBefore).not.toEqual([PermissionKeys.FILE_UPLOAD]);
    const deniedRolePermissions = await app.request(
      "/api/authorization/roles/viewer/permissions",
      {
        method: "PUT",
        headers: {
          cookie: operator.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissionKeys: [PermissionKeys.FILE_UPLOAD] }),
      },
    );
    expect(deniedRolePermissions.status).toBe(403);
    expect((await readFailure(deniedRolePermissions)).error.message).toBe(
      "只有平台管理员可以修改授权关系",
    );
    expect(readRolePermissionKeys(runtime.db, RoleKeys.VIEWER)).toEqual(
      viewerPermissionsBefore,
    );

    // 同样的两个写操作，平台管理员可以执行。
    const allowedUserRoles = await app.request(
      `/api/authorization/users/${target.user.id}/roles`,
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ roleKeys: [RoleKeys.VIEWER] }),
      },
    );
    expect(allowedUserRoles.status).toBe(200);
    expect(
      (await readSuccess<AuthorizationUser>(allowedUserRoles)).data.roleKeys,
    ).toEqual([RoleKeys.VIEWER]);

    const allowedRolePermissions = await app.request(
      "/api/authorization/roles/viewer/permissions",
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKeys: [PermissionKeys.FILE_UPLOAD] }),
      },
    );
    expect(allowedRolePermissions.status).toBe(200);
    expect(readRolePermissionKeys(runtime.db, RoleKeys.VIEWER)).toEqual([
      PermissionKeys.FILE_UPLOAD,
    ]);
  } finally {
    cleanup();
  }
});

it("提交相同集合时短路，不重写授权关系", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "idempotent-admin@example.com");
    const target = await register(app, "idempotent-target@example.com");
    const repository = createAuthorizationRepository(runtime.db);
    expect(
      repository.bootstrapAdminByEmail(
        "idempotent-admin@example.com",
        systemContext,
      ).kind,
    ).toBe("ok");

    // 用哨兵时间戳而不是比较前后时钟：assigned_at 是 timestamp_ms，
    // 同一毫秒内的重写会产生相同的值，那样的断言证明不了短路。
    const sentinel = new Date(1700000000000);
    runtime.db
      .update(userRoles)
      .set({ assignedAt: sentinel })
      .where(eq(userRoles.userId, target.user.id))
      .run();

    const sameRoles = await app.request(
      `/api/authorization/users/${target.user.id}/roles`,
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }),
      },
    );
    expect(sameRoles.status).toBe(200);
    expect(
      (await readSuccess<AuthorizationUser>(sameRoles)).data.roleKeys,
    ).toEqual([RoleKeys.OPERATOR]);
    const targetAssignment = runtime.db
      .select({ assignedAt: userRoles.assignedAt })
      .from(userRoles)
      .where(eq(userRoles.userId, target.user.id))
      .get();
    expect(targetAssignment?.assignedAt).toEqual(sentinel);

    const viewerRole = runtime.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, RoleKeys.VIEWER))
      .get();
    expect(viewerRole).toBeDefined();
    const currentViewerPermissions = runtime.db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, viewerRole!.id))
      .all()
      .map((permission) => permission.key)
      .sort();
    runtime.db
      .update(rolePermissions)
      .set({ assignedAt: sentinel })
      .where(eq(rolePermissions.roleId, viewerRole!.id))
      .run();

    const samePermissions = await app.request(
      "/api/authorization/roles/viewer/permissions",
      {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKeys: currentViewerPermissions }),
      },
    );
    expect(samePermissions.status).toBe(200);
    expect(
      runtime.db
        .select({ assignedAt: rolePermissions.assignedAt })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, viewerRole!.id))
        .all()
        .map((row) => row.assignedAt),
    ).toEqual(currentViewerPermissions.map(() => sentinel));

    // bootstrap 对已是纯 admin 的用户重复执行同样不重写。
    runtime.db
      .update(userRoles)
      .set({ assignedAt: sentinel })
      .where(eq(userRoles.userId, admin.user.id))
      .run();
    expect(
      repository.bootstrapAdminByEmail(
        "idempotent-admin@example.com",
        systemContext,
      ).kind,
    ).toBe("ok");
    const adminAssignment = runtime.db
      .select({ assignedAt: userRoles.assignedAt })
      .from(userRoles)
      .where(eq(userRoles.userId, admin.user.id))
      .get();
    expect(adminAssignment?.assignedAt).toEqual(sentinel);
  } finally {
    cleanup();
  }
});

it("撤销最后一个平台管理员被拒绝，关系不变", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "last-admin@example.com");
    const repository = createAuthorizationRepository(runtime.db);
    expect(
      repository.bootstrapAdminByEmail("last-admin@example.com", systemContext)
        .kind,
    ).toBe("ok");
    expect(readUserRoleKeys(runtime.db, admin.user.id)).toEqual([
      RoleKeys.ADMIN,
    ]);

    // 走 repository 而不是 HTTP：HTTP 上 actor 必须是活动 admin 且不能改自己，
    // 撤销别人的 admin 之后 actor 自己还在，这条路径当前不可达。
    expect(
      repository.replaceUserRoles(
        admin.user.id,
        [RoleKeys.OPERATOR],
        systemContext,
      ),
    ).toEqual({ kind: "last-platform-admin" });
    expect(readUserRoleKeys(runtime.db, admin.user.id)).toEqual([
      RoleKeys.ADMIN,
    ]);

    // 存在第二个平台管理员时，同样的撤销可以成功。
    const second = await register(app, "second-admin@example.com");
    expect(
      repository.replaceUserRoles(second.user.id, [RoleKeys.ADMIN], {
        actorType: "system",
        actorId: "test",
        requestId: null,
      }).kind,
    ).toBe("ok");
    expect(
      repository.replaceUserRoles(
        admin.user.id,
        [RoleKeys.OPERATOR],
        systemContext,
      ).kind,
    ).toBe("ok");
    expect(readUserRoleKeys(runtime.db, admin.user.id)).toEqual([
      RoleKeys.OPERATOR,
    ]);
  } finally {
    cleanup();
  }
});

it("互斥角色（SSD）：admin 独占，违反互斥组的角色分配被拒绝且关系不变", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "admin@example.com");
    const target = await register(app, "target@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    };
    expect(runBootstrapAdmin(bootstrapEnv, { error() {}, log() {} })).toBe(0);

    const putRoles = (roleKeys: string[]) =>
      app.request(`/api/authorization/users/${target.user.id}/roles`, {
        method: "PUT",
        headers: { cookie: admin.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ roleKeys }),
      });

    // 分配 [admin, operator] 违反 admin 独占：403，角色保持默认 operator 不变。
    const conflict = await putRoles([RoleKeys.ADMIN, RoleKeys.OPERATOR]);
    expect(conflict.status).toBe(403);
    const conflictBody = await readFailure(conflict);
    expect(conflictBody.error.code).toBe(ApiErrorCodes.AUTH_ROLE_CONFLICT);
    expect(conflictBody.error.message).toBe(
      "角色分配违反职责分离约束：admin 与 operator 不能同时分配",
    );
    expect(readUserRoleKeys(runtime.db, target.user.id)).toEqual([
      RoleKeys.OPERATOR,
    ]);

    // 单独分配 [admin] 成功。
    const adminOnly = await putRoles([RoleKeys.ADMIN]);
    expect(adminOnly.status).toBe(200);
    expect(
      (await readSuccess<AuthorizationUser>(adminOnly)).data.roleKeys,
    ).toEqual([RoleKeys.ADMIN]);

    // 幂等提交 [admin] 放行，不报互斥错误。
    const idempotent = await putRoles([RoleKeys.ADMIN]);
    expect(idempotent.status).toBe(200);

    // 非互斥组合 [operator, viewer] 成功。
    const nonConflicting = await putRoles([RoleKeys.OPERATOR, RoleKeys.VIEWER]);
    expect(nonConflicting.status).toBe(200);
    expect(readUserRoleKeys(runtime.db, target.user.id)).toEqual([
      RoleKeys.OPERATOR,
      RoleKeys.VIEWER,
    ]);

    // 存量违规（绕过校验直接写入 admin）不被扫描或自动修改；
    // 幂等提交相同集合（before == after）时放行，只有实际变更的写入才被拦截。
    const adminRole = runtime.db
      .select()
      .from(roles)
      .where(eq(roles.key, RoleKeys.ADMIN))
      .get();
    expect(adminRole).toBeDefined();
    runtime.db
      .insert(userRoles)
      .values({
        userId: target.user.id,
        roleId: adminRole!.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .run();
    expect(readUserRoleKeys(runtime.db, target.user.id)).toEqual([
      RoleKeys.ADMIN,
      RoleKeys.OPERATOR,
      RoleKeys.VIEWER,
    ]);

    const staleSubmit = await putRoles([
      RoleKeys.ADMIN,
      RoleKeys.OPERATOR,
      RoleKeys.VIEWER,
    ]);
    expect(staleSubmit.status).toBe(200);
    expect(readUserRoleKeys(runtime.db, target.user.id)).toEqual([
      RoleKeys.ADMIN,
      RoleKeys.OPERATOR,
      RoleKeys.VIEWER,
    ]);
  } finally {
    cleanup();
  }
});
