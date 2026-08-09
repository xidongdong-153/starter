# API 授权规范

> 状态：已实现。实现位于 `apps/api/src/modules/authorization/`，共享契约位于 `packages/contracts/src/index.ts`。

## 1. Scope / Trigger

当 API 需要根据数据库角色保护管理接口或业务动作时，使用本规范。认证身份继续来自 Better Auth cookie session；授权只读取 SQLite 的 User -> Role -> Permission 关系。

首版只支持精确 `resource:action` key，不支持通配符、角色继承、用户直接 permission 或多租户维度。

## 2. Signatures

```ts
const requireAuth = createRequireAuth(runtime.auth)
const requireFileUpload = createRequirePermission(
  runtime.db,
  PermissionKeys.FILE_UPLOAD,
)

app.openapi(
  { ...uploadRoute, middleware: [requireAuth, requireFileUpload] },
  handler,
)
```

数据库关系：

```text
user -> user_roles -> roles -> role_permissions -> permissions
```

当前授权接口：

```http
GET /api/me/permissions
Cookie: Better Auth session cookie
```

```json
{
  "ok": true,
  "data": {
    "roles": ["operator"],
    "permissions": [
      "file:delete",
      "file:list",
      "file:read",
      "file:rename",
      "file:upload"
    ],
    "version": "951f01537251c7b3"
  },
  "meta": {
    "requestId": "request-id",
    "timestamp": "2026-08-09T00:00:00.000Z"
  }
}
```

管理员 bootstrap：

```bash
AUTH_BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
  pnpm --filter @starter/api auth:bootstrap-admin
```

## 3. Contracts

### Permission 和 role 目录

`@starter/contracts` 的 `PermissionKeys` 是唯一的 permission key 来源。当前值：

- `authorization:read`、`authorization:manage`
- `file:list`、`file:read`、`file:upload`、`file:rename`、`file:delete`

系统 role 为 `admin`、`operator`、`viewer`：

- `admin` 对全部未归档且已注册 permission 授权；它的权限集合不可通过管理接口修改。
- `operator` 是 migration 前已有用户和新注册用户的默认角色，拥有全部 file permission。
- `viewer` 只有 `file:list` 和 `file:read`。

四张表为 `roles`、`permissions`、`user_roles`、`role_permissions`。角色和权限的 key 唯一，可归档；关联表使用复合主键。授权查询必须过滤归档 role 和 permission。

### Middleware 与资源边界

`createRequirePermission(db, permission)` 必须位于 `createRequireAuth` 后。它从 `c.var.currentUserId` 查询数据库，不接受浏览器传入的角色或权限集合。

file route 的 permission 与动作一一对应：列表、内容、上传、重命名、删除。通过 permission 后，`files.service.ts` 和 `files.repository.ts` 仍必须按 `currentUserId` 检查 owner；permission 不提供跨用户访问能力。

### 授权管理接口

| Method | Path | Required permission |
| --- | --- | --- |
| GET | `/api/me/permissions` | 已登录 |
| GET | `/api/authorization/users` | `authorization:read` |
| PUT | `/api/authorization/users/{userId}/roles` | `authorization:manage` |
| GET | `/api/authorization/roles` | `authorization:read` |
| PUT | `/api/authorization/roles/{roleKey}/permissions` | `authorization:manage` |

角色替换 body 为 `{ "roleKeys": string[] }`，至少一个 key 且不能重复。角色权限替换 body 为 `{ "permissionKeys": Permission[] }`，不能包含未注册或重复 key。

管理 service 禁止调用者修改自己的角色；禁止修改 `admin` 角色权限。角色关系和角色权限关系的替换必须各自在 repository transaction 内完成。

`AUTH_BOOTSTRAP_ADMIN_EMAIL` 是可选环境变量。bootstrap 命令只处理已存在且邮箱精确匹配的用户，把该用户角色幂等替换为 `admin`；API 启动和普通注册不自动创建管理员。

## 4. Validation & Error Matrix

| 条件 | HTTP | Error code / 命令结果 | 处理 |
| --- | --- | --- | --- |
| 无 session | 401 | 既有 `AUTH.UNAUTHENTICATED` | 不进入 permission 查询 |
| session 无效 | 401 | 既有 `AUTH.SESSION_INVALID` | 不进入业务 handler |
| 已登录但无所需 permission | 403 | `AUTH.FORBIDDEN` | 不执行 handler |
| 权限表查询异常 | 500 | `SYSTEM.INTERNAL_ERROR` | 不降级为 403 或允许 |
| 目标用户或 role 不存在 | 404 | `COMMON.NOT_FOUND` | 不更新关联表 |
| role key 无效、归档或重复 | 400 | `COMMON.INVALID_REQUEST` | 不更新关联表 |
| 调用者修改自己的 role | 403 | `AUTH.FORBIDDEN` | 不更新关联表 |
| 修改 `admin` permission | 403 | `AUTH.FORBIDDEN` | 不更新关联表 |
| bootstrap 未配置邮箱 | non-zero | 明确命令错误 | 不打开或写入授权关系 |
| bootstrap 用户不存在或 migration 缺失 | non-zero | 明确命令错误 | 不写入授权关系 |

## 5. Good / Base / Bad Cases

- Good：route 先执行 `requireAuth`，再执行 `createRequirePermission`，业务 service 最后检查资源 owner。
- Good：角色权限修改后，下一次请求重新查询 SQLite 并使用新关系。
- Base：Admin 隐藏没有 `file:delete` 的按钮，但直接调用删除接口仍由 middleware 返回 403。
- Bad：把 `permissions` request body 或 session 扩展字段当成 API 授权依据。
- Bad：把 SQLite 查询异常转换成 403，掩盖基础设施错误。
- Bad：在 permission middleware 中删除 owner 条件，导致拥有 file permission 的用户读取他人资源。

## 6. Tests Required

`apps/api/src/test/authorization.smoke.test.ts` 至少覆盖：

- 新 migration seed、已有用户 `operator` 回填、代码 permission key 与数据库目录一致。
- 默认 role、bootstrap 成功、重复 bootstrap、未配置邮箱、用户不存在和缺失 migration。
- 401、403、2xx、数据库查询异常 500。
- 多 role 并集、version 变化、当前 session 用户隔离。
- 用户角色替换、角色权限替换、禁止自改角色、禁止编辑 `admin`。
- role 或 permission 归档后下一次授权失败。
- 两个均有 file permission 的用户仍不能读取对方文件。
- OpenAPI 包含授权 endpoint 及其 403 response。

## 7. Wrong vs Correct

### Wrong

```ts
app.delete('/api/files/:fileId', requireAuth, removeFile)
```

这只验证登录态，任何已登录用户都能尝试删除文件。

### Correct

```ts
app.openapi(
  {
    ...removeFileRoute,
    middleware: [
      createRequireAuth(runtime.auth),
      createRequirePermission(runtime.db, PermissionKeys.FILE_DELETE),
    ],
  },
  (c) => service.remove(c.req.valid('param').fileId, c.var.currentUserId),
)
```

middleware 决定动作资格，`service.remove` 继续依据 `currentUserId` 决定资源归属。

## 8. 已批准的演进边界（尚未实现）

> 本节记录任务 `permission-role-evolution` 的已批准规划。当前代码仍以第 2、3 节的已实现契约为准；后续实现必须另建任务并逐项更新本规范。

### 8.1 默认产品画像

- 默认脚手架是通用单租户后台，继续使用全局 User -> Role -> Permission RBAC。
- `admin` 是平台根角色，不是 Organization role，也不是 Better Auth Admin plugin 的 `user.role`。
- `operator` 和 `viewer` 保留为受保护的内置角色；自定义角色生命周期排在授权审计之后。
- Organization、API Key、M2M 和 FGA 不进入默认 schema 或接口。

### 8.2 授权治理基础

下一项实现任务必须覆盖所有 HTTP 授权控制面写操作，而不只是 `admin` 角色变更：

- repository transaction 内重新检查 actor 的活动 `admin` 关系。
- 普通角色即使拥有 `authorization:manage`，也不能替换任何用户角色或角色 permission。
- 现有 self-mutation 继续返回 403。
- 撤销目标用户最后一个活动 `admin` 时返回 `AUTH.LAST_PLATFORM_ADMIN` 和 409；关系和审计事件都不提交。
- before 与 after 相同的幂等 mutation 不重写关系，也不写审计事件。
- 实际发生的每次 mutation 只写一条授权审计事件，关系变更和事件在同一 transaction 提交。
- HTTP actor 使用当前用户和 request ID；bootstrap 与 Better Auth hook 使用 `actor_type=system`，`actor_id` 分别为稳定值 `auth:bootstrap-admin`、`better-auth:user.create`，缺少 request ID 时保持为空。
- 失败和拒绝不自动视为成功审计；当前 `AppError` 4xx 也不会自动写 Pino，拒绝日志需要单独设计。

授权治理基础阶段的事件 action 为：`user_roles.replaced`、`role_permissions.replaced`、`user_roles.initialized`、`platform_admin.granted`、`platform_admin.revoked`。角色生命周期阶段再增加 `role.created`、`role.updated`、`role.archived`、`role.restored`。审计 DTO 由 contracts 按 action 提供判别联合，Admin 不直接解析数据库 JSON。

### 8.3 生命周期顺序

先实现平台根边界、审计表、审计查询和 API/Admin 回归测试，再实现自定义角色创建、metadata 修改、permission 替换、归档、恢复和影响查询。角色 key 创建后不可修改；系统角色不能归档或删除；有活动用户分配的自定义角色不能归档。不增加物理删除或 permission 创建接口。

### 8.4 条件能力

- 资源范围先由业务 service 和精确 permission 组合表达，不预先增加通配符、继承或策略 DSL。
- 多租户启用时，Better Auth Organization plugin 必须成为 organization、member 和组织角色的唯一来源；不能给当前全局 role 表增加第二套组织角色事实。
- API Key、M2M principal 与人类用户分开；不能写入 `user_roles`。
- FGA/OpenFGA 只有在对象关系授权成为主要需求后单独评估。
