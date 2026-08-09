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
import { permissions, roles, userRoles } from "@api/infra/db/schema/index.js";
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
    ).toHaveLength(7);

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
    const repository = (
      await import("@api/modules/authorization/index.js")
    ).createAuthorizationRepository(runtime.db);
    expect(
      repository.bootstrapAdminByEmail("owner-admin@example.com").kind,
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
