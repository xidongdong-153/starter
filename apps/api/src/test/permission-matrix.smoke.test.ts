import type {
  AccountProfile,
  CurrentPermissions,
  FileItem,
} from "@starter/contracts";
import { ApiErrorCodes, PermissionKeys, RoleKeys } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { createAuthorizationRepository } from "@api/modules/authorization/index.js";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

/**
 * 权限矩阵表驱动测试（BOLA / BFLA）。
 * 以「角色集合 × 资源 × 动作 → 期望状态码」表格形式覆盖 files、profile 头像
 * 和授权控制面，并验证 admin 特权语义（删除 role_permissions 行后权限不变）。
 * 全部用例由同一个驱动函数执行，单用例失败可通过用例名定位。
 */

const MATRIX_CONTROL_ROLE = "matrix-control";
const MATRIX_WRITE_ROLE = "matrix-write-role";
const MATRIX_CREATED_ROLE = "matrix-created-role";
const AVATAR_FILE_NAME = "avatar.png";
const NOTES_FILE_NAME = "notes.txt";
const AVATAR_BYTES = new Uint8Array([137, 80, 78, 71]);
const NOTES_BYTES = new TextEncoder().encode("matrix notes");

const systemContext = {
  actorType: "system",
  actorId: "auth:bootstrap-admin",
  requestId: null,
} as const;

type ActorKey =
  "anonymous" | "viewer" | "ownerA" | "ownerB" | "powerUser" | "admin";

interface MatrixContext {
  app: ReturnType<typeof createTestApp>["app"];
  db: ReturnType<typeof createTestApp>["runtime"]["db"];
  cookies: Record<Exclude<ActorKey, "anonymous">, string>;
  userIds: Record<Exclude<ActorKey, "anonymous">, string>;
  fileA: FileItem;
  fileB: FileItem;
}

interface MatrixCase {
  /** 用例名，it.each 定位用。 */
  name: string;
  actor: ActorKey;
  method: "GET" | "PATCH" | "PUT" | "DELETE" | "POST";
  path: string | ((ctx: MatrixContext) => string);
  /** 请求 JSON body。 */
  body?: unknown;
  /** 依赖 beforeAll 装配资源的动态 body，用例执行时求值。 */
  bodyFn?: (ctx: MatrixContext) => unknown;
  expectedStatus: number;
  /** 非 2xx 时断言 ApiErrorCodes。 */
  expectedCode?: string;
  /** 请求发出前执行（写被拒用例先读取关系快照）。 */
  before?: (ctx: MatrixContext) => void | Promise<void>;
  /** 请求完成后执行：被拒后资源未修改断言，或成功用例后的状态恢复。 */
  verifyUnchanged?: (ctx: MatrixContext) => void | Promise<void>;
}

async function runMatrixCase(ctx: MatrixContext, tc: MatrixCase) {
  await tc.before?.(ctx);
  const body = tc.bodyFn ? tc.bodyFn(ctx) : tc.body;
  const headers: Record<string, string> = {};
  if (tc.actor !== "anonymous") headers.cookie = ctx.cookies[tc.actor];
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await ctx.app.request(
    typeof tc.path === "function" ? tc.path(ctx) : tc.path,
    {
      method: tc.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  expect(response.status).toBe(tc.expectedStatus);
  if (tc.expectedStatus >= 400 && tc.expectedCode) {
    const failure = await readFailure(response);
    expect(failure.error.code).toBe(tc.expectedCode);
  }
  await tc.verifyUnchanged?.(ctx);
}

async function uploadFile(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  name: string,
  content: Uint8Array,
  mimeType: string,
): Promise<FileItem> {
  const form = new FormData();
  form.set("file", new File([content], name, { type: mimeType }));
  const response = await app.request("/api/files", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  expect(response.status).toBe(201);
  return (await readSuccess<FileItem>(response)).data;
}

async function readFileList(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
): Promise<FileItem[]> {
  const response = await app.request("/api/files", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await readSuccess<FileItem[]>(response)).data;
}

async function readProfile(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
): Promise<AccountProfile> {
  const response = await app.request("/api/profile", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await readSuccess<AccountProfile>(response)).data;
}

function readRoleKeys(
  db: ReturnType<typeof createTestApp>["runtime"]["db"],
  userId: string,
) {
  return db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))
    .all()
    .map((row) => row.key)
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
    .map((row) => row.key)
    .sort();
}

/** 被拒的删除后文件仍存在。 */
function fileStillExists(
  file: "fileA" | "fileB",
  owner: Exclude<ActorKey, "anonymous">,
) {
  return async (ctx: MatrixContext) => {
    const list = await readFileList(ctx.app, ctx.cookies[owner]);
    expect(list.find((item) => item.id === ctx[file].id)).toBeDefined();
  };
}

/** 被拒的重命名后文件名不变。 */
function fileNameUnchanged(
  file: "fileA" | "fileB",
  owner: Exclude<ActorKey, "anonymous">,
  name: string,
) {
  return async (ctx: MatrixContext) => {
    const list = await readFileList(ctx.app, ctx.cookies[owner]);
    expect(list.find((item) => item.id === ctx[file].id)?.name).toBe(name);
  };
}

/** 被拒的头像设置后 avatarUrl 仍为 null。 */
function avatarStillNull(actor: Exclude<ActorKey, "anonymous">) {
  return async (ctx: MatrixContext) => {
    const profile = await readProfile(ctx.app, ctx.cookies[actor]);
    expect(profile.avatarUrl).toBeNull();
  };
}

/** 写前读取用户角色快照，拒绝后比对。 */
function snapshotRoleKeys(userIdKey: keyof MatrixContext["userIds"]) {
  let snapshot: string[] = [];
  return {
    before(ctx: MatrixContext) {
      snapshot = readRoleKeys(ctx.db, ctx.userIds[userIdKey]);
    },
    verifyUnchanged(ctx: MatrixContext) {
      expect(readRoleKeys(ctx.db, ctx.userIds[userIdKey])).toEqual(snapshot);
    },
  };
}

/** 写前读取角色权限快照，拒绝后比对。 */
function snapshotRolePermissionKeys(roleKey: string) {
  let snapshot: string[] = [];
  return {
    before(ctx: MatrixContext) {
      snapshot = readRolePermissionKeys(ctx.db, roleKey);
    },
    verifyUnchanged(ctx: MatrixContext) {
      expect(readRolePermissionKeys(ctx.db, roleKey)).toEqual(snapshot);
    },
  };
}

const matrixCases: MatrixCase[] = [
  // ---- files 资源矩阵（fileA 属 ownerA）：BFLA + BOLA ----
  {
    name: "files：anonymous 列表 → 401",
    actor: "anonymous",
    method: "GET",
    path: "/api/files",
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "files：viewer 列表 → 200",
    actor: "viewer",
    method: "GET",
    path: "/api/files",
    expectedStatus: 200,
  },
  {
    name: "files：ownerB 列表 → 200",
    actor: "ownerB",
    method: "GET",
    path: "/api/files",
    expectedStatus: 200,
  },
  {
    name: "files：powerUser 列表 → 200",
    actor: "powerUser",
    method: "GET",
    path: "/api/files",
    expectedStatus: 200,
  },
  {
    name: "files：admin 列表 → 200",
    actor: "admin",
    method: "GET",
    path: "/api/files",
    expectedStatus: 200,
  },
  {
    name: "files：ownerA 列表 → 200",
    actor: "ownerA",
    method: "GET",
    path: "/api/files",
    expectedStatus: 200,
  },
  {
    name: "files：anonymous 读 fileA 内容 → 401",
    actor: "anonymous",
    method: "GET",
    path: (ctx) => `/api/files/${ctx.fileA.id}/content`,
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "files：viewer 读 fileA 内容 → 404（BFLA：有 file:read 但非 owner）",
    actor: "viewer",
    method: "GET",
    path: (ctx) => `/api/files/${ctx.fileA.id}/content`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
  },
  {
    name: "files：ownerB 读 fileA 内容 → 404（BOLA：有全部 file 权限但对象不属自己）",
    actor: "ownerB",
    method: "GET",
    path: (ctx) => `/api/files/${ctx.fileA.id}/content`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
  },
  {
    name: "files：powerUser 读 fileA 内容 → 404（BFLA）",
    actor: "powerUser",
    method: "GET",
    path: (ctx) => `/api/files/${ctx.fileA.id}/content`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
  },
  {
    name: "files：admin 读 fileA 内容 → 404（BFLA：权限不提供跨用户访问能力）",
    actor: "admin",
    method: "GET",
    path: (ctx) => `/api/files/${ctx.fileA.id}/content`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
  },
  {
    name: "files：ownerA 读 fileA 内容 → 200",
    actor: "ownerA",
    method: "GET",
    path: (ctx) => `/api/files/${ctx.fileA.id}/content`,
    expectedStatus: 200,
  },
  {
    name: "files：anonymous 重命名 fileA → 401",
    actor: "anonymous",
    method: "PATCH",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    body: { name: "hacked-avatar.png" },
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "files：viewer 重命名 fileA → 403（无 rename 权限）",
    actor: "viewer",
    method: "PATCH",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    body: { name: "hacked-avatar.png" },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    verifyUnchanged: fileNameUnchanged("fileA", "ownerA", AVATAR_FILE_NAME),
  },
  {
    name: "files：ownerB 重命名 fileA → 404（BOLA）",
    actor: "ownerB",
    method: "PATCH",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    body: { name: "hacked-avatar.png" },
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileNameUnchanged("fileA", "ownerA", AVATAR_FILE_NAME),
  },
  {
    name: "files：powerUser 重命名 fileA → 404（BFLA）",
    actor: "powerUser",
    method: "PATCH",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    body: { name: "hacked-avatar.png" },
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileNameUnchanged("fileA", "ownerA", AVATAR_FILE_NAME),
  },
  {
    name: "files：admin 重命名 fileA → 404（BFLA）",
    actor: "admin",
    method: "PATCH",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    body: { name: "hacked-avatar.png" },
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileNameUnchanged("fileA", "ownerA", AVATAR_FILE_NAME),
  },
  {
    name: "files：ownerA 重命名 fileA → 200（随后恢复原名）",
    actor: "ownerA",
    method: "PATCH",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    body: { name: "renamed-avatar.png" },
    expectedStatus: 200,
    verifyUnchanged: async (ctx) => {
      const restored = await ctx.app.request(`/api/files/${ctx.fileA.id}`, {
        method: "PATCH",
        headers: {
          cookie: ctx.cookies.ownerA,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: AVATAR_FILE_NAME }),
      });
      expect(restored.status).toBe(200);
      expect((await readSuccess<FileItem>(restored)).data.name).toBe(
        AVATAR_FILE_NAME,
      );
    },
  },
  {
    name: "files：anonymous 删除 fileA → 401",
    actor: "anonymous",
    method: "DELETE",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "files：viewer 删除 fileA → 403（无 delete 权限）",
    actor: "viewer",
    method: "DELETE",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    verifyUnchanged: fileStillExists("fileA", "ownerA"),
  },
  {
    name: "files：ownerB 删除 fileA → 404（BOLA）",
    actor: "ownerB",
    method: "DELETE",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileStillExists("fileA", "ownerA"),
  },
  {
    name: "files：powerUser 删除 fileA → 404（BFLA）",
    actor: "powerUser",
    method: "DELETE",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileStillExists("fileA", "ownerA"),
  },
  {
    name: "files：admin 删除 fileA → 404（BFLA）",
    actor: "admin",
    method: "DELETE",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileStillExists("fileA", "ownerA"),
  },
  // 反向 BOLA：ownerA 操作 fileB（属 ownerB），双向互不能操作。
  {
    name: "files：ownerA 读 fileB 内容 → 404（反向 BOLA）",
    actor: "ownerA",
    method: "GET",
    path: (ctx) => `/api/files/${ctx.fileB.id}/content`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
  },
  {
    name: "files：ownerA 重命名 fileB → 404（反向 BOLA）",
    actor: "ownerA",
    method: "PATCH",
    path: (ctx) => `/api/files/${ctx.fileB.id}`,
    body: { name: "stolen-notes.txt" },
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileNameUnchanged("fileB", "ownerB", NOTES_FILE_NAME),
  },
  {
    name: "files：ownerA 删除 fileB → 404（反向 BOLA）",
    actor: "ownerA",
    method: "DELETE",
    path: (ctx) => `/api/files/${ctx.fileB.id}`,
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: fileStillExists("fileB", "ownerB"),
  },

  // ---- profile 头像矩阵（BOLA）：不能把他人文件设为头像 ----
  {
    name: "profile：anonymous 设置头像 → 401",
    actor: "anonymous",
    method: "PUT",
    path: "/api/profile/avatar",
    bodyFn: (ctx) => ({ fileId: ctx.fileA.id }),
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "profile：viewer 设置他人头像 → 404",
    actor: "viewer",
    method: "PUT",
    path: "/api/profile/avatar",
    bodyFn: (ctx) => ({ fileId: ctx.fileA.id }),
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: avatarStillNull("viewer"),
  },
  {
    name: "profile：ownerB 设置他人头像 → 404（BOLA）",
    actor: "ownerB",
    method: "PUT",
    path: "/api/profile/avatar",
    bodyFn: (ctx) => ({ fileId: ctx.fileA.id }),
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: avatarStillNull("ownerB"),
  },
  {
    name: "profile：powerUser 设置他人头像 → 404（BFLA）",
    actor: "powerUser",
    method: "PUT",
    path: "/api/profile/avatar",
    bodyFn: (ctx) => ({ fileId: ctx.fileA.id }),
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: avatarStillNull("powerUser"),
  },
  {
    name: "profile：admin 设置他人头像 → 404（BFLA）",
    actor: "admin",
    method: "PUT",
    path: "/api/profile/avatar",
    bodyFn: (ctx) => ({ fileId: ctx.fileA.id }),
    expectedStatus: 404,
    expectedCode: ApiErrorCodes.COMMON_NOT_FOUND,
    verifyUnchanged: avatarStillNull("admin"),
  },
  {
    name: "profile：ownerA 设置自己的头像 → 200（随后清理）",
    actor: "ownerA",
    method: "PUT",
    path: "/api/profile/avatar",
    bodyFn: (ctx) => ({ fileId: ctx.fileA.id }),
    expectedStatus: 200,
    verifyUnchanged: async (ctx) => {
      const cleared = await ctx.app.request("/api/profile/avatar", {
        method: "DELETE",
        headers: { cookie: ctx.cookies.ownerA },
      });
      expect(cleared.status).toBe(200);
      const profile = await readProfile(ctx.app, ctx.cookies.ownerA);
      expect(profile.avatarUrl).toBeNull();
    },
  },

  // ---- 授权控制面矩阵 ----
  {
    name: "控制面：anonymous 读用户列表 → 401",
    actor: "anonymous",
    method: "GET",
    path: "/api/authorization/users",
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "控制面：viewer 读用户列表 → 403",
    actor: "viewer",
    method: "GET",
    path: "/api/authorization/users",
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：ownerA 读用户列表 → 403",
    actor: "ownerA",
    method: "GET",
    path: "/api/authorization/users",
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：powerUser 读用户列表 → 200",
    actor: "powerUser",
    method: "GET",
    path: "/api/authorization/users",
    expectedStatus: 200,
  },
  {
    name: "控制面：admin 读用户列表 → 200",
    actor: "admin",
    method: "GET",
    path: "/api/authorization/users",
    expectedStatus: 200,
  },
  {
    name: "控制面：anonymous 读角色影响 → 401",
    actor: "anonymous",
    method: "GET",
    path: "/api/authorization/roles/viewer/impact",
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "控制面：viewer 读角色影响 → 403",
    actor: "viewer",
    method: "GET",
    path: "/api/authorization/roles/viewer/impact",
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：ownerA 读角色影响 → 403",
    actor: "ownerA",
    method: "GET",
    path: "/api/authorization/roles/viewer/impact",
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：powerUser 读角色影响 → 200",
    actor: "powerUser",
    method: "GET",
    path: "/api/authorization/roles/viewer/impact",
    expectedStatus: 200,
  },
  {
    name: "控制面：admin 读角色影响 → 200",
    actor: "admin",
    method: "GET",
    path: "/api/authorization/roles/viewer/impact",
    expectedStatus: 200,
  },
  {
    name: "控制面：anonymous 替换用户角色 → 401",
    actor: "anonymous",
    method: "PUT",
    path: (ctx) => `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
    body: { roleKeys: [RoleKeys.OPERATOR, RoleKeys.VIEWER] },
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "控制面：viewer 替换用户角色 → 403",
    actor: "viewer",
    method: "PUT",
    path: (ctx) => `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
    body: { roleKeys: [RoleKeys.OPERATOR, RoleKeys.VIEWER] },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    ...snapshotRoleKeys("ownerA"),
  },
  {
    name: "控制面：ownerA 替换用户角色 → 403",
    actor: "ownerA",
    method: "PUT",
    path: (ctx) => `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
    body: { roleKeys: [RoleKeys.OPERATOR, RoleKeys.VIEWER] },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    ...snapshotRoleKeys("ownerA"),
  },
  {
    name: "控制面：powerUser 替换用户角色 → 403（非平台管理员）",
    actor: "powerUser",
    method: "PUT",
    path: (ctx) => `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
    body: { roleKeys: [RoleKeys.OPERATOR, RoleKeys.VIEWER] },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    ...snapshotRoleKeys("ownerA"),
  },
  {
    name: "控制面：admin 替换用户角色 → 200（随后恢复）",
    actor: "admin",
    method: "PUT",
    path: (ctx) => `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
    body: { roleKeys: [RoleKeys.OPERATOR, RoleKeys.VIEWER] },
    expectedStatus: 200,
    verifyUnchanged: async (ctx) => {
      const restored = await ctx.app.request(
        `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
        {
          method: "PUT",
          headers: {
            cookie: ctx.cookies.admin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }),
        },
      );
      expect(restored.status).toBe(200);
      expect(readRoleKeys(ctx.db, ctx.userIds.ownerA)).toEqual([
        RoleKeys.OPERATOR,
      ]);
    },
  },
  {
    name: "控制面：anonymous 创建角色 → 401",
    actor: "anonymous",
    method: "POST",
    path: "/api/authorization/roles",
    body: {
      key: MATRIX_WRITE_ROLE,
      name: "矩阵写角色",
      description: null,
      permissionKeys: [],
    },
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "控制面：viewer 创建角色 → 403",
    actor: "viewer",
    method: "POST",
    path: "/api/authorization/roles",
    body: {
      key: MATRIX_WRITE_ROLE,
      name: "矩阵写角色",
      description: null,
      permissionKeys: [],
    },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：ownerA 创建角色 → 403",
    actor: "ownerA",
    method: "POST",
    path: "/api/authorization/roles",
    body: {
      key: MATRIX_WRITE_ROLE,
      name: "矩阵写角色",
      description: null,
      permissionKeys: [],
    },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：powerUser 创建角色 → 403（非平台管理员）",
    actor: "powerUser",
    method: "POST",
    path: "/api/authorization/roles",
    body: {
      key: MATRIX_WRITE_ROLE,
      name: "矩阵写角色",
      description: null,
      permissionKeys: [],
    },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    verifyUnchanged: (ctx) => {
      expect(
        ctx.db
          .select()
          .from(roles)
          .where(eq(roles.key, MATRIX_WRITE_ROLE))
          .get(),
      ).toBeUndefined();
    },
  },
  {
    name: "控制面：admin 创建角色 → 200",
    actor: "admin",
    method: "POST",
    path: "/api/authorization/roles",
    body: {
      key: MATRIX_CREATED_ROLE,
      name: "矩阵创建角色",
      description: null,
      permissionKeys: [],
    },
    expectedStatus: 200,
  },
  {
    name: "控制面：anonymous 替换角色权限 → 401",
    actor: "anonymous",
    method: "PUT",
    path: "/api/authorization/roles/viewer/permissions",
    body: { permissionKeys: [PermissionKeys.FILE_LIST] },
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "控制面：viewer 替换角色权限 → 403",
    actor: "viewer",
    method: "PUT",
    path: "/api/authorization/roles/viewer/permissions",
    body: { permissionKeys: [PermissionKeys.FILE_LIST] },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    ...snapshotRolePermissionKeys(RoleKeys.VIEWER),
  },
  {
    name: "控制面：ownerA 替换角色权限 → 403",
    actor: "ownerA",
    method: "PUT",
    path: "/api/authorization/roles/viewer/permissions",
    body: { permissionKeys: [PermissionKeys.FILE_LIST] },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    ...snapshotRolePermissionKeys(RoleKeys.VIEWER),
  },
  {
    name: "控制面：powerUser 替换角色权限 → 403（非平台管理员）",
    actor: "powerUser",
    method: "PUT",
    path: "/api/authorization/roles/viewer/permissions",
    body: { permissionKeys: [PermissionKeys.FILE_LIST] },
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
    ...snapshotRolePermissionKeys(RoleKeys.VIEWER),
  },
  {
    name: "控制面：admin 替换角色权限 → 200（随后恢复）",
    actor: "admin",
    method: "PUT",
    path: "/api/authorization/roles/viewer/permissions",
    body: { permissionKeys: [PermissionKeys.FILE_LIST] },
    expectedStatus: 200,
    verifyUnchanged: async (ctx) => {
      const restored = await ctx.app.request(
        "/api/authorization/roles/viewer/permissions",
        {
          method: "PUT",
          headers: {
            cookie: ctx.cookies.admin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            permissionKeys: [
              PermissionKeys.FILE_LIST,
              PermissionKeys.FILE_READ,
            ],
          }),
        },
      );
      expect(restored.status).toBe(200);
      expect(readRolePermissionKeys(ctx.db, RoleKeys.VIEWER)).toEqual([
        PermissionKeys.FILE_LIST,
        PermissionKeys.FILE_READ,
      ]);
    },
  },
  {
    name: "控制面：anonymous 读审计事件 → 401",
    actor: "anonymous",
    method: "GET",
    path: "/api/authorization/audit-events",
    expectedStatus: 401,
    expectedCode: ApiErrorCodes.AUTH_UNAUTHENTICATED,
  },
  {
    name: "控制面：viewer 读审计事件 → 403",
    actor: "viewer",
    method: "GET",
    path: "/api/authorization/audit-events",
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：ownerA 读审计事件 → 403",
    actor: "ownerA",
    method: "GET",
    path: "/api/authorization/audit-events",
    expectedStatus: 403,
    expectedCode: ApiErrorCodes.AUTH_FORBIDDEN,
  },
  {
    name: "控制面：powerUser 读审计事件 → 200",
    actor: "powerUser",
    method: "GET",
    path: "/api/authorization/audit-events",
    expectedStatus: 200,
  },
  {
    name: "控制面：admin 读审计事件 → 200",
    actor: "admin",
    method: "GET",
    path: "/api/authorization/audit-events",
    expectedStatus: 200,
  },
  // 成功删除依赖 fileA 存活，必须放整个矩阵最后。
  {
    name: "files：ownerA 删除自己的 fileA → 200（放最后）",
    actor: "ownerA",
    method: "DELETE",
    path: (ctx) => `/api/files/${ctx.fileA.id}`,
    expectedStatus: 200,
    verifyUnchanged: async (ctx) => {
      const list = await readFileList(ctx.app, ctx.cookies.ownerA);
      expect(list.find((item) => item.id === ctx.fileA.id)).toBeUndefined();
    },
  },
];

let ctx!: MatrixContext;
let cleanup: (() => void) | undefined;

beforeAll(async () => {
  const { app, runtime, cleanup: appCleanup } = createTestApp();
  cleanup = appCleanup;
  const repository = createAuthorizationRepository(runtime.db);

  const viewer = await register(app, "matrix-viewer@example.com");
  const ownerA = await register(app, "matrix-owner-a@example.com");
  const ownerB = await register(app, "matrix-owner-b@example.com");
  const powerUser = await register(app, "matrix-power@example.com");
  const admin = await register(app, "matrix-admin@example.com");

  expect(
    repository.replaceUserRoles(
      viewer.user.id,
      [RoleKeys.VIEWER],
      systemContext,
    ).kind,
  ).toBe("ok");
  expect(
    repository.createRole(
      {
        key: MATRIX_CONTROL_ROLE,
        name: "矩阵控制角色",
        description: null,
        permissionKeys: [
          PermissionKeys.AUTHORIZATION_MANAGE,
          PermissionKeys.AUTHORIZATION_READ,
          PermissionKeys.AUTHORIZATION_AUDIT_READ,
        ],
      },
      systemContext,
    ).kind,
  ).toBe("ok");
  expect(
    repository.replaceUserRoles(
      powerUser.user.id,
      [RoleKeys.OPERATOR, MATRIX_CONTROL_ROLE],
      systemContext,
    ).kind,
  ).toBe("ok");
  expect(
    repository.bootstrapAdminByEmail("matrix-admin@example.com", systemContext)
      .kind,
  ).toBe("ok");

  const fileA = await uploadFile(
    app,
    ownerA.cookie,
    AVATAR_FILE_NAME,
    AVATAR_BYTES,
    "image/png",
  );
  const fileB = await uploadFile(
    app,
    ownerB.cookie,
    NOTES_FILE_NAME,
    NOTES_BYTES,
    "text/plain",
  );

  ctx = {
    app,
    db: runtime.db,
    cookies: {
      viewer: viewer.cookie,
      ownerA: ownerA.cookie,
      ownerB: ownerB.cookie,
      powerUser: powerUser.cookie,
      admin: admin.cookie,
    },
    userIds: {
      viewer: viewer.user.id,
      ownerA: ownerA.user.id,
      ownerB: ownerB.user.id,
      powerUser: powerUser.user.id,
      admin: admin.user.id,
    },
    fileA,
    fileB,
  };
});

afterAll(() => {
  cleanup?.();
});

it.each(matrixCases)("$name", async (tc) => {
  await runMatrixCase(ctx, tc);
});

it("admin 特权语义：删除 admin 角色全部 role_permissions 行后权限与访问能力不变", async () => {
  const adminRole = ctx.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, RoleKeys.ADMIN))
    .get();
  expect(adminRole).toBeDefined();
  ctx.db
    .delete(rolePermissions)
    .where(eq(rolePermissions.roleId, adminRole!.id))
    .run();
  expect(
    ctx.db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, adminRole!.id))
      .all(),
  ).toHaveLength(0);

  const me = await ctx.app.request("/api/me/permissions", {
    headers: { cookie: ctx.cookies.admin },
  });
  expect(me.status).toBe(200);
  const meData = (await readSuccess<CurrentPermissions>(me)).data;
  expect(meData.roles).toEqual([RoleKeys.ADMIN]);
  expect(meData.permissions).toEqual(Object.values(PermissionKeys).sort());

  const users = await ctx.app.request("/api/authorization/users", {
    headers: { cookie: ctx.cookies.admin },
  });
  expect(users.status).toBe(200);

  const replace = await ctx.app.request(
    `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
    {
      method: "PUT",
      headers: {
        cookie: ctx.cookies.admin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR, RoleKeys.VIEWER] }),
    },
  );
  expect(replace.status).toBe(200);
  expect(readRoleKeys(ctx.db, ctx.userIds.ownerA)).toEqual([
    RoleKeys.OPERATOR,
    RoleKeys.VIEWER,
  ]);

  const restored = await ctx.app.request(
    `/api/authorization/users/${ctx.userIds.ownerA}/roles`,
    {
      method: "PUT",
      headers: {
        cookie: ctx.cookies.admin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roleKeys: [RoleKeys.OPERATOR] }),
    },
  );
  expect(restored.status).toBe(200);
  expect(readRoleKeys(ctx.db, ctx.userIds.ownerA)).toEqual([RoleKeys.OPERATOR]);
});
