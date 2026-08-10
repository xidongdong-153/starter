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

- `authorization-audit:read`
- `authorization:read`、`authorization:manage`
- `file:list`、`file:read`、`file:upload`、`file:rename`、`file:delete`

系统 role 为 `admin`、`operator`、`viewer`：

- `admin` 对全部未归档且已注册 permission 授权；它的权限集合不可通过管理接口修改。
- `operator` 是 migration 前已有用户和新注册用户的默认角色，拥有全部 file permission。
- `viewer` 只有 `file:list` 和 `file:read`。

授权关系表为 `roles`、`permissions`、`user_roles`、`role_permissions`。角色和权限的 key 唯一，可归档；关联表使用复合主键。授权查询必须过滤归档 role 和 permission。

`authorization_audit_events` 是独立的追加式历史表。`actor_id` 和 `target_id` 不设外键，用户或角色删除后仍保留原 ID 文本；该表不声明 Drizzle relation。

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
| GET | `/api/authorization/audit-events` | `authorization-audit:read` |

角色替换 body 为 `{ "roleKeys": string[] }`，至少一个 key 且不能重复。角色权限替换 body 为 `{ "permissionKeys": Permission[] }`，不能包含未注册或重复 key。

管理 service 禁止调用者修改自己的角色；禁止修改 `admin` 角色权限。角色关系和角色权限关系的替换必须各自在 repository transaction 内完成。

`AUTH_BOOTSTRAP_ADMIN_EMAIL` 是可选环境变量。bootstrap 命令只处理已存在且邮箱精确匹配的用户，把该用户角色幂等替换为 `admin`；API 启动和普通注册不自动创建管理员。

### 平台管理员写入边界

`authorization:manage` 只决定能不能进入写路由，不决定能不能落库。`authorization.repository.ts` 的 `replaceUserRoles` 和 `replaceRolePermissions` 在写 transaction 内用 `isActivePlatformAdmin(tx, actorId)` 重查一次 actor 是否关联未归档的 `admin` 角色，查不到就返回 `actor-not-platform-admin`，service 翻成 403 `AUTH.FORBIDDEN`。检查放在 transaction 内，是因为并发撤权时 transaction 外读到的快照可能已经过期。

所以 `authorization:manage` 不是可委派权限。把它加给 `operator` 或任何自定义角色，持有者仍然只能读授权数据，两个写接口一律 403；要放开写操作只能把用户加进 `admin`。

repository 三个写函数（`replaceUserRoles`、`replaceRolePermissions`、`bootstrapAdminByEmail`）的最后一个参数是 `AuthorizationWriteContext`，service 把它作为第一个参数接收并透传：

```ts
interface AuthorizationWriteContext {
  actorType: 'user' | 'system'
  actorId: string
  requestId: string | null
}
```

- HTTP 路由传 `{ actorType: 'user', actorId: c.var.currentUserId, requestId: c.var.requestId }`。
- `apps/api/src/scripts/bootstrap-admin.ts` 传 `{ actorType: 'system', actorId: 'auth:bootstrap-admin', requestId: null }`，跳过 actor 校验。
- `assigned_by` 的写入值由 `actorType` 决定：`user` 写 `actorId`，`system` 写 `null`。
- `requestId` 写入同一 transaction 内创建的审计事件，不写入关系表；system actor 固定为 `null`。

transaction 内的判断顺序不能调换：目标存在性 -> key 有效性 -> actor 平台管理员 -> 读 before 集合 -> 幂等短路 -> 最后一个平台管理员 -> 写入。幂等短路必须排在 actor 校验之后，否则无权 actor 提交一份与当前相同的集合就能拿到 200。

### 幂等与最后一个平台管理员

`replaceUserRoles`、`replaceRolePermissions` 和 `bootstrapAdminByEmail` 都先读排序后的 before 集合，与 after 相同时直接返回成功，不执行 `delete` + `insert`。重复提交相同集合不会刷新 `assigned_at`，也不会写审计事件；DTO 不暴露 `assigned_at`，改动不影响响应。

`replaceUserRoles` 只在目标用户从有 `admin` 变成无 `admin` 时才统计活动平台管理员：现存 `user` 记录通过 `user_roles` 关联到未归档的 `admin` 角色。提交后数量归零时返回 `last-platform-admin`，service 翻成 409 `AUTH.LAST_PLATFORM_ADMIN`。当前 HTTP 路径走不到这条保护（actor 必须是活动 admin，又不能改自己，撤销别人的 admin 之后自己还在），只有 repository 级测试覆盖它。

### 授权审计

四个写入口只在授权事实实际变化时各写一条事件，并与关系写入使用同一个 SQLite transaction：

| 入口 | action | actor |
| --- | --- | --- |
| 用户角色替换 | `platform_admin.granted`、`platform_admin.revoked` 或 `user_roles.replaced` | 当前用户与 request ID |
| 角色权限替换 | `role_permissions.replaced` | 当前用户与 request ID |
| Better Auth 新用户 hook | `user_roles.initialized` | `better-auth:user.create`，request ID 为空 |
| 管理员 bootstrap | `platform_admin.granted` 或 `user_roles.replaced` | `auth:bootstrap-admin`，request ID 为空 |

用户角色事件的 before/after 都保存完整、排序后的 role key 集合。角色权限事件保存完整、排序后的 permission key 集合。事件构造器只接收这些 key 数组，不接收 user、session 或 account record。

构造器还必须按 action 显式创建 `{ roleKeys }` 或 `{ permissionKeys }`，不能直接 `JSON.stringify(input.before)`。TypeScript 使用结构类型：调用方先把对象存进变量时，变量可以带额外字段并继续赋给较窄的参数类型。显式投影能保证这类字段不会进入审计 JSON。

```ts
// 错误：变量可能同时带 password、token 等额外字段
beforeJson: JSON.stringify(input.before)

// 正确：只取当前 action 允许的字段
beforeJson: JSON.stringify({ roleKeys: input.before.roleKeys })
```

`GET /api/authorization/audit-events` 支持 action、actor ID、target ID、起止时间和 `page`/`pageSize`。查询固定按 `created_at DESC, id DESC` 排序。presenter 按 action 解析并校验 `before_json`、`after_json` 和 `target_type`；JSON 无法解析或结构与 action 不匹配时返回 `SYSTEM.INTERNAL_ERROR` 和 500，不把原始字符串交给客户端。

审计表当前没有导出、归档和保留期策略。部署方需要自行监控 SQLite 文件增长。

## 4. Validation & Error Matrix

| 条件 | HTTP | Error code / 命令结果 | 处理 |
| --- | --- | --- | --- |
| 无 session | 401 | 既有 `AUTH.UNAUTHENTICATED` | 不进入 permission 查询 |
| session 无效 | 401 | 既有 `AUTH.SESSION_INVALID` | 不进入业务 handler |
| 已登录但无所需 permission | 403 | `AUTH.FORBIDDEN` | 不执行 handler |
| 权限表查询异常 | 500 | `SYSTEM.INTERNAL_ERROR` | 不降级为 403 或允许 |
| 审计 JSON、action、payload 或 target type 损坏 | 500 | `SYSTEM.INTERNAL_ERROR` | 不返回原始存储值 |
| 目标用户或 role 不存在 | 404 | `COMMON.NOT_FOUND` | 不更新关联表 |
| role key 无效、归档或重复 | 400 | `COMMON.INVALID_REQUEST` | 不更新关联表 |
| 调用者修改自己的 role | 403 | `AUTH.FORBIDDEN` | 不更新关联表 |
| actor 不是活动平台管理员 | 403 | `AUTH.FORBIDDEN` | 不更新关联表 |
| 撤销最后一个活动平台管理员 | 409 | `AUTH.LAST_PLATFORM_ADMIN` | 不更新关联表 |
| 修改 `admin` permission | 403 | `AUTH.FORBIDDEN` | 不更新关联表 |
| bootstrap 未配置邮箱 | non-zero | 明确命令错误 | 不打开或写入授权关系 |
| bootstrap 用户不存在或 migration 缺失 | non-zero | 明确命令错误 | 不写入授权关系 |

三个 403 的 message 各不相同，用来区分拒绝原因：自改角色是「不能修改自己的角色」，actor 不是平台管理员是「只有平台管理员可以修改授权关系」，改 `admin` 权限是「不能修改 admin 角色的权限」。

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
- 持有 `authorization:manage` 的非 admin 用户替换用户角色和角色权限都返回 403，两张关联表都不变；同样的操作由活动 admin 执行返回 200。
- 提交与当前相同的 roleKeys 或 permissionKeys 返回 200，且 `assigned_at` 不变。断言要先把 `assigned_at` 改成哨兵时间戳再比对：这个列是 `timestamp_ms`，同一毫秒内的重写会写出相同的值，直接比对前后时钟证明不了短路。
- `bootstrapAdminByEmail` 对已是纯 `admin` 的用户重复执行时不重写关系。
- repository 级撤销最后一个活动平台管理员返回 `last-platform-admin`，关系不变；库里存在第二个平台管理员时同样的撤销成功。
- OpenAPI 包含授权 endpoint 及其 403 response，`PUT /api/authorization/users/{userId}/roles` 还要包含 409 response。

`apps/api/src/test/authorization-audit.smoke.test.ts` 至少覆盖：

- 用户角色变更的三种 action、角色权限替换、新用户初始化和 bootstrap actor。
- 幂等 HTTP 与重复 bootstrap 不追加事件。
- 关系写入失败和审计写入失败都会回滚 transaction，不产生部分结果。
- action、actor ID、target ID、时间范围过滤和相同 `created_at` 下的稳定分页。稳定分页测试只验证查询结果；SQLite 可能反向扫描 `(created_at, id)` 索引，使删除显式 `desc(id)` 后仍碰巧得到同样顺序，因此代码检查还要确认两个排序键都存在。
- 非持有者 403，持有 `authorization-audit:read` 的非 admin 可以读取但不能写授权。
- 无效 JSON、与 action 不匹配的 payload 或 target type 返回 500；响应不含密码、token、cookie 或原始 JSON 字符串。
- 直接给审计构造器传带额外字段的 payload，断言落库 JSON 只含 `roleKeys` 或 `permissionKeys`。

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

## 8. 后续演进边界

> 平台管理员写入边界和授权审计已经实现。下面只记录尚未进入当前 schema 或接口的后续能力。

### 8.1 默认产品画像

- 默认脚手架是通用单租户后台，继续使用全局 User -> Role -> Permission RBAC。
- `admin` 是平台根角色，不是 Organization role，也不是 Better Auth Admin plugin 的 `user.role`。
- `operator` 和 `viewer` 保留为受保护的内置角色；自定义角色生命周期排在授权审计之后。
- Organization、API Key、M2M 和 FGA 不进入默认 schema 或接口。

### 8.2 已实现的授权治理基础

当前所有 HTTP 授权控制面写操作都遵守以下约束：

- repository transaction 内重新检查 actor 的活动 `admin` 关系。
- 普通角色即使拥有 `authorization:manage`，也不能替换任何用户角色或角色 permission。
- 现有 self-mutation 继续返回 403。
- 撤销目标用户最后一个活动 `admin` 时返回 `AUTH.LAST_PLATFORM_ADMIN` 和 409；关系和审计事件都不提交。
- before 与 after 相同的幂等 mutation 不重写关系，也不写审计事件。
- 实际发生的每次 mutation 只写一条授权审计事件，关系变更和事件在同一 transaction 提交。
- HTTP actor 使用当前用户和 request ID；bootstrap 与 Better Auth hook 使用 `actor_type=system`，`actor_id` 分别为稳定值 `auth:bootstrap-admin`、`better-auth:user.create`，缺少 request ID 时保持为空。
- 失败和拒绝不自动视为成功审计；当前 `AppError` 4xx 也不会自动写 Pino，拒绝日志需要单独设计。

transaction 内 actor 校验、最后一个平台管理员保护和幂等短路由任务 `platform-admin-write-boundary` 实现；追加式审计表、四个写入口和审计查询由任务 `authorization-audit-trail` 实现。当前事件 action 为 `user_roles.replaced`、`role_permissions.replaced`、`user_roles.initialized`、`platform_admin.granted`、`platform_admin.revoked`。

角色生命周期阶段再增加 `role.created`、`role.updated`、`role.archived`、`role.restored`。审计 DTO 继续由 contracts 按 action 提供判别联合，Admin 不直接解析数据库 JSON。

### 8.3 生命周期顺序

平台根边界、审计表、审计查询和 API/Admin 回归测试已经完成。下一阶段实现自定义角色创建、metadata 修改、permission 替换、归档、恢复和影响查询。角色 key 创建后不可修改；系统角色不能归档或删除；有活动用户分配的自定义角色不能归档。不增加物理删除或 permission 创建接口。

### 8.4 条件能力

- 资源范围先由业务 service 和精确 permission 组合表达，不预先增加通配符、继承或策略 DSL。
- 多租户启用时，Better Auth Organization plugin 必须成为 organization、member 和组织角色的唯一来源；不能给当前全局 role 表增加第二套组织角色事实。
- API Key、M2M principal 与人类用户分开；不能写入 `user_roles`。
- FGA/OpenFGA 只有在对象关系授权成为主要需求后单独评估。
