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
- `system:logs:read`

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
| GET | `/api/authorization/roles?status=active\|archived` | `authorization:read` |
| POST | `/api/authorization/roles` | `authorization:manage` |
| PATCH | `/api/authorization/roles/{roleKey}` | `authorization:manage` |
| PUT | `/api/authorization/roles/{roleKey}/permissions` | `authorization:manage` |
| POST | `/api/authorization/roles/{roleKey}/archive` | `authorization:manage` |
| POST | `/api/authorization/roles/{roleKey}/restore` | `authorization:manage` |
| GET | `/api/authorization/roles/{roleKey}/impact` | `authorization:read` |
| GET | `/api/authorization/permissions/{permissionKey}/impact` | `authorization:read` |
| GET | `/api/authorization/audit-events` | `authorization-audit:read` |
| GET | `/api/system/logs` | `system:logs:read` |

`GET /api/authorization/roles` 不传 `status` 时只返回活动角色，保持旧客户端行为。响应中的 permission 目录始终只包含 `PermissionKeys` 已注册且数据库未归档的记录。

角色替换 body 为 `{ "roleKeys": string[] }`，至少一个 key 且不能重复。角色权限替换 body 为 `{ "permissionKeys": Permission[] }`，不能包含未注册、已归档或重复 key。

创建角色 body 为 `{ key, name, description, permissionKeys }`：`key` 使用 `roleKeySchema`，名称长度为 1 到 80，描述为 `null` 或最多 500 个字符，permission 集合可以为空。服务端不根据名称生成 key，也不接受 `isSystem`、`archivedAt` 或创建后的 key 修改。

metadata 更新 body 只接受可选的 `name` 和 `description`，至少提供一个字段。`AuthorizationRole` 由服务端返回 `archivedAt`、`metadataEditable`、`permissionsEditable` 和 `lifecycleEditable`，Admin 不重复实现系统角色判断。

自定义角色写入现有 `roles` 与 `role_permissions`。创建和初始 permission、metadata 更新、归档、恢复及各自审计事件都在单个 repository transaction 内提交。角色不物理删除；归档保留 permission 关系，恢复不创建用户角色关系。

管理 service 禁止调用者修改自己的角色；禁止修改 `admin` 角色权限。所有 `isSystem=true` 的角色都不能修改 metadata 或生命周期，`operator` 和 `viewer` 的活动 permission 仍可通过现有接口调整。

`AUTH_BOOTSTRAP_ADMIN_EMAIL` 是可选环境变量。bootstrap 命令只处理已存在且邮箱精确匹配的用户，把该用户角色幂等替换为 `admin`；API 启动和普通注册不自动创建管理员。

### 平台管理员写入边界

`authorization:manage` 只决定能不能进入写路由，不决定能不能落库。`authorization.repository.ts` 的 `replaceUserRoles`、`replaceRolePermissions`、`createRole`、`updateRoleMetadata`、`archiveRole` 和 `restoreRole` 都在写 transaction 内用 `isActivePlatformAdmin(tx, actorId)` 重查 actor 是否关联未归档的 `admin` 角色，查不到就返回 `actor-not-platform-admin`，service 翻成 403 `AUTH.FORBIDDEN`。检查放在 transaction 内，是因为并发撤权时 transaction 外读到的快照可能已经过期。

所以 `authorization:manage` 不是可委派权限。把它加给 `operator` 或任何自定义角色，持有者仍不能修改用户角色、角色 permission 或角色生命周期；要放开写操作只能把用户加进 `admin`。

上述六个 HTTP 写函数和 `bootstrapAdminByEmail` 的最后一个参数都是 `AuthorizationWriteContext`，service 把它作为第一个参数接收并透传：

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

关系替换 transaction 的判断顺序不能调换：目标存在性 -> key 有效性 -> actor 平台管理员 -> 读 before 集合 -> 幂等短路 -> SSD 互斥校验 -> 最后一个平台管理员 -> 写入。角色 metadata、归档和恢复也必须先检查 actor，再执行幂等短路；否则无权 actor 提交当前状态会拿到 200。

创建角色先在 transaction 内确认请求中的 permission 都处于活动状态，再检查 actor 和全状态 key 冲突。归档角色在 transaction 内统计 `COUNT(DISTINCT user.id)`；影响查询返回的人数只用于预览，不能替代这次提交时重查。

### 静态职责分离（SSD）互斥角色

NIST RBAC (INCITS 359) Constrained 层已落地 SSD：互斥角色组定义在 `packages/contracts` 的 `ExclusiveRoleGroups` 常量，无数据库表、无管理接口：

```ts
export const ExclusiveRoleGroups: readonly (readonly string[])[] = [
  [RoleKeys.ADMIN], // 单元素组 = 独占角色
] as const
```

语义规则：

- 组内角色数 >= 2：两两互斥，目标角色集中至多出现组内一个角色。
- 组内角色数 == 1：独占角色，目标角色集中包含该角色时，目标角色集大小必须为 1。
- 组内 key 指向不存在或已归档角色时忽略（互斥组只按 key 匹配目标集合）。

校验在 `replaceUserRoles` transaction 内、幂等短路之后、最后一个平台管理员检查之前执行。命中时返回 `exclusive-role-group-conflict`（携带 `group` 和 `conflictingKeys`），service 翻成 403 `AUTH.ROLE_CONFLICT`，details 为 `{ group, conflictingKeys }`。

设计边界：

- 互斥组是代码常量，变更需要发版；这是有意的，安全治理配置变更应可审计，且未来要可配置时再加表和接口的迁移成本低。
- 只拦截实际变更的写入。幂等提交（before == after）放行，存量违规不扫描、不自动修改；用户角色只能经 `replaceUserRoles` 整体替换，下一次实际修改时自然被拦截。
- 单元素独占组命中时，`conflictingKeys` 包含独占角色本身和当前持有的其他角色（如 `admin` 与 `operator`），错误文案可完整表达冲突。
- `bootstrapAdminByEmail` 走独立写入路径，目标集合固定为 `[admin]`，天然满足独占约束。

### 幂等与最后一个平台管理员

`replaceUserRoles`、`replaceRolePermissions` 和 `bootstrapAdminByEmail` 都先读排序后的 before 集合，与 after 相同时直接返回成功，不执行 `delete` + `insert`。重复提交相同集合不会刷新 `assigned_at`，也不会写审计事件；DTO 不暴露 `assigned_at`，改动不影响响应。

`updateRoleMetadata` 对相同名称和描述直接返回当前角色；重复归档已归档角色、重复恢复活动角色也直接返回。三类幂等请求都不能改 `updated_at` 或追加审计。创建角色不是幂等操作，活动或归档角色占用同一 key 时返回 409 `AUTH.ROLE_KEY_CONFLICT`。

`replaceUserRoles` 只在目标用户从有 `admin` 变成无 `admin` 时才统计活动平台管理员：现存 `user` 记录通过 `user_roles` 关联到未归档的 `admin` 角色。提交后数量归零时返回 `last-platform-admin`，service 翻成 409 `AUTH.LAST_PLATFORM_ADMIN`。当前 HTTP 路径走不到这条保护（actor 必须是活动 admin，又不能改自己，撤销别人的 admin 之后自己还在），只有 repository 级测试覆盖它。

### 角色状态与影响查询

角色 impact 查询接受活动或归档 role key，返回 `{ roleKey, assignedUserCount }`。人数只统计仍存在的 `user` 记录，并按 user ID 去重。

permission impact 查询先确认 key 属于 `PermissionKeys` 且数据库记录未归档，再返回 `{ permissionKey, roleKeys, affectedUserCount }`：

- 普通活动角色从 `role_permissions` 读取。
- 活动 `admin` 对每个活动注册 permission 自动有效，即使没有对应 `role_permissions` 行。
- 归档角色和归档 permission 不参与结果。
- `roleKeys` 排序去重；关联多个有效角色的同一用户只计算一次。

这一语义必须与 `findCurrentAuthorization` 和 `hasPermission` 的 `admin` 特殊分支一致。只查询 `role_permissions` 会漏掉平台管理员。

### 授权审计

写入口只在授权事实实际变化时各写一条事件，并与业务写入使用同一个 SQLite transaction：

| 入口 | action | actor |
| --- | --- | --- |
| 用户角色替换 | `platform_admin.granted`、`platform_admin.revoked` 或 `user_roles.replaced` | 当前用户与 request ID |
| 角色权限替换 | `role_permissions.replaced` | 当前用户与 request ID |
| 自定义角色创建 | `role.created` | 当前用户与 request ID |
| 自定义角色 metadata 更新 | `role.updated` | 当前用户与 request ID |
| 自定义角色归档 | `role.archived` | 当前用户与 request ID |
| 自定义角色恢复 | `role.restored` | 当前用户与 request ID |
| Better Auth 新用户 hook | `user_roles.initialized` | `better-auth:user.create`，request ID 为空 |
| 管理员 bootstrap | `platform_admin.granted` 或 `user_roles.replaced` | `auth:bootstrap-admin`，request ID 为空 |

用户角色事件的 before/after 都保存完整、排序后的 role key 集合。角色权限事件保存完整、排序后的 permission key 集合。角色事件使用以下封闭 payload：

- `role.created`：before 为 `{ role: null }`，after 为 `{ role: { name, description, permissionKeys, archived: false } }`。
- `role.updated`：before/after 都为 `{ name, description }`。
- `role.archived`、`role.restored`：before/after 都为 `{ archived }`。

role key 只写在 `targetId`。事件构造器必须按 action 显式投影允许字段，不接收或序列化 user、session、account 或数据库 role record。角色、permission 关系或审计插入任一步失败时，transaction 必须整体回滚。

构造器还必须按 action 显式创建 `{ roleKeys }` 或 `{ permissionKeys }`，不能直接 `JSON.stringify(input.before)`。TypeScript 使用结构类型：调用方先把对象存进变量时，变量可以带额外字段并继续赋给较窄的参数类型。显式投影能保证这类字段不会进入审计 JSON。

```ts
// 错误：变量可能同时带 password、token 等额外字段
beforeJson: JSON.stringify(input.before)

// 正确：只取当前 action 允许的字段
beforeJson: JSON.stringify({ roleKeys: input.before.roleKeys })
```

`GET /api/authorization/audit-events` 支持 action、actor ID、target ID、起止时间和 `page`/`pageSize`。查询固定按 `created_at DESC, id DESC` 排序。presenter 按 action 解析并校验 `before_json`、`after_json` 和 `target_type`；JSON 无法解析或结构与 action 不匹配时返回 `SYSTEM.INTERNAL_ERROR` 和 500，不把原始字符串交给客户端。

已经写入角色生命周期事件后，回滚 API 或 Admin 时仍要保留 contracts、presenter 和审计展示对这些 action 的解析。旧版本不认识 action 时，读取历史审计会返回 500；不能删除已经写入的审计行来规避兼容问题。

审计表当前没有导出、归档和保留期策略。部署方需要自行监控 SQLite 文件增长。

## 4. Validation & Error Matrix

| 条件 | HTTP | Error code / 命令结果 | 处理 |
| --- | --- | --- | --- |
| 无 session | 401 | 既有 `AUTH.UNAUTHENTICATED` | 不进入 permission 查询 |
| session 无效 | 401 | 既有 `AUTH.SESSION_INVALID` | 不进入业务 handler |
| 已登录但无所需 permission | 403 | `AUTH.FORBIDDEN` | 不执行 handler |
| 权限表查询异常 | 500 | `SYSTEM.INTERNAL_ERROR` | 不降级为 403 或允许 |
| 审计 JSON、action、payload 或 target type 损坏 | 500 | `SYSTEM.INTERNAL_ERROR` | 不返回原始存储值 |
| 目标用户、role 或 permission 不存在 | 404 | `COMMON.NOT_FOUND` | 不执行写入 |
| role key 格式错误，permission 未注册、已归档或重复 | 400 | `COMMON.INVALID_REQUEST` | 不执行写入 |
| 活动或归档 role 已占用创建 key | 409 | `AUTH.ROLE_KEY_CONFLICT` | 不创建角色、关系或审计 |
| 自定义 role 仍有关联用户 | 409 | `AUTH.ROLE_IN_USE`，details 为 `{ assignedUserCount }` | 不归档、不写审计 |
| 修改归档 role 的 metadata 或 permission | 404 | `COMMON.NOT_FOUND` | 先恢复再修改 |
| 修改系统 role 的 metadata 或生命周期 | 403 | `AUTH.FORBIDDEN` | 不更新 role |
| 调用者修改自己的 role | 403 | `AUTH.FORBIDDEN` | 不更新关联表 |
| actor 不是活动平台管理员 | 403 | `AUTH.FORBIDDEN` | 不执行任何授权写入 |
| 撤销最后一个活动平台管理员 | 409 | `AUTH.LAST_PLATFORM_ADMIN` | 不更新关联表 |
| 目标角色集违反互斥角色组 | 403 | `AUTH.ROLE_CONFLICT`，details 为 `{ group, conflictingKeys }` | 不更新关联表 |
| 修改 `admin` permission | 403 | `AUTH.FORBIDDEN` | 不更新关联表 |
| bootstrap 未配置邮箱 | non-zero | 明确命令错误 | 不打开或写入授权关系 |
| bootstrap 用户不存在或 migration 缺失 | non-zero | 明确命令错误 | 不写入授权关系 |

403 message 要保留具体拒绝原因：自改角色是「不能修改自己的角色」，actor 不是平台管理员是「只有平台管理员可以修改授权关系」，改 `admin` 权限是「不能修改 admin 角色的权限」，系统角色 metadata、归档和恢复分别说明对应操作不允许。客户端按稳定 code 和 status 处理，不根据中文 message 分支。

## 5. Good / Base / Bad Cases

- Good：route 先执行 `requireAuth`，再执行 `createRequirePermission`，业务 service 最后检查资源 owner。
- Good：角色权限修改后，下一次请求重新查询 SQLite 并使用新关系。
- Good：归档前先查 role impact 提示人数，提交时仍在 transaction 内重新统计并在人数大于 0 时返回 `AUTH.ROLE_IN_USE`。
- Good：permission impact 显式合并活动 `admin`，再按 user ID 去重。
- Base：Admin 隐藏没有 `file:delete` 的按钮，但直接调用删除接口仍由 middleware 返回 403。
- Bad：把影响查询结果当成归档写入依据，跳过 transaction 内重查。
- Bad：permission impact 只联结 `role_permissions`，导致 `admin` 从结果中消失。
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
- 分配 `[admin, operator]` 返回 403 `AUTH.ROLE_CONFLICT` 且角色不变；单独分配 `[admin]` 和非互斥组合 `[operator, viewer]` 返回 200；幂等提交不报互斥错误；绕过校验写入的存量违规在幂等提交时不被扫描或自动修改。
- OpenAPI 包含授权 endpoint 及其 403 response，`PUT /api/authorization/users/{userId}/roles` 还要包含 409 response。

`apps/api/src/test/role-lifecycle.smoke.test.ts` 至少覆盖：

- 空 permission 和带初始 permission 的角色创建；关系与 `role.created` 在同一 transaction 提交。
- 活动或归档 key 冲突返回 `AUTH.ROLE_KEY_CONFLICT`；无效或归档 permission 不留下角色、关系或审计。
- 持有 `authorization:manage` 的非 admin 对创建、更新、归档和恢复仍返回 403。
- metadata 部分更新和幂等更新；系统角色、归档角色拒绝修改。
- 多个用户关联时归档返回 `AUTH.ROLE_IN_USE` 和去重人数；移除分配后可以归档。
- 重复归档、重复恢复和幂等 metadata 不改变 `updated_at`，不追加审计。
- 恢复保留 permission，不创建用户角色；归档角色不能分配或修改 permission。
- role impact 统计任意状态角色；permission impact 合并 `admin` 自动权限并对多角色用户去重。
- 关系插入失败和审计插入失败都回滚创建 transaction。
- 四个角色 action 的 actor、target、request ID 和 payload；损坏 payload 或 target type 返回 500。
- OpenAPI 为新增路径声明实际可能返回的 400、401、403、404、409 和 500。

`apps/api/src/test/authorization-audit.smoke.test.ts` 至少覆盖：

- 用户角色变更的三种 action、角色权限替换、新用户初始化和 bootstrap actor。
- 幂等 HTTP 与重复 bootstrap 不追加事件。
- 关系写入失败和审计写入失败都会回滚 transaction，不产生部分结果。
- action、actor ID、target ID、时间范围过滤和相同 `created_at` 下的稳定分页。稳定分页测试只验证查询结果；SQLite 可能反向扫描 `(created_at, id)` 索引，使删除显式 `desc(id)` 后仍碰巧得到同样顺序，因此代码检查还要确认两个排序键都存在。
- 非持有者 403，持有 `authorization-audit:read` 的非 admin 可以读取但不能写授权。
- 无效 JSON、与 action 不匹配的 payload 或 target type 返回 500；响应不含密码、token、cookie 或原始 JSON 字符串。
- 直接给审计构造器传带额外字段的 payload，断言落库 JSON 只含 `roleKeys` 或 `permissionKeys`。

`apps/api/src/test/permission-matrix.smoke.test.ts` 至少覆盖：

- 表驱动矩阵：「角色集合 × 资源 × 动作 → 期望状态码」，全部用例由同一驱动函数执行，单用例失败可定位。
- BFLA：有 file 权限但非 owner 的用户读取、重命名、删除他人文件返回 404 `COMMON.NOT_FOUND`；admin 有全部权限但不是文件 owner 时同样 404。
- BOLA：两个都有 file 权限的用户不能互相读取、重命名、删除对方文件，也不能把对方文件设为头像（`PUT /api/profile/avatar` 返回 404）。
- 被拒写操作不改变资源：删除被拒后文件仍存在、重命名被拒后文件名不变、头像被拒后 `avatarUrl` 仍为 null、控制面写被拒后关系快照不变。
- 控制面：持有 `authorization:manage` 的非 admin 写操作 403、读操作 200；匿名请求 401。
- admin 特权语义：删除 admin 角色全部 `role_permissions` 行后 `GET /api/me/permissions` 仍返回全部注册 permission，控制面读写仍 200。

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

> 平台管理员写入边界、追加式审计、自定义角色生命周期和影响查询已经实现。下面只记录仍未进入当前 schema 或接口的能力。

### 8.1 默认产品画像

- 默认脚手架是通用单租户后台，继续使用全局 User -> Role -> Permission RBAC。
- `admin` 是平台根角色，不是 Organization role，也不是 Better Auth Admin plugin 的 `user.role`。
- `operator` 和 `viewer` 是受保护的内置角色；自定义角色使用同一 `roles` 表并支持 metadata、permission、归档和恢复。
- Organization、API Key、M2M 和 FGA 不进入默认 schema 或接口。

### 8.2 已实现的授权治理基础

当前所有 HTTP 授权控制面写操作都遵守以下约束：

- repository transaction 内重新检查 actor 的活动 `admin` 关系。
- 普通角色即使拥有 `authorization:manage`，也不能修改用户角色、角色 permission 或角色生命周期。
- self-mutation 返回 403；撤销最后一个活动 `admin` 返回 `AUTH.LAST_PLATFORM_ADMIN` 和 409。
- 自定义角色 key 创建后不可修改；系统角色不能改 metadata 或生命周期。
- 有现存用户分配的自定义角色返回 `AUTH.ROLE_IN_USE` 和去重人数，不能归档。
- before 与 after 相同的幂等 mutation 不更新时间、不重写关系，也不写审计事件。
- 实际发生的每次 mutation 只写一条授权审计事件，业务数据和事件在同一 transaction 提交。
- `replaceUserRoles` 在事务内执行 SSD 互斥校验（`ExclusiveRoleGroups`），违反时返回 403 `AUTH.ROLE_CONFLICT`；互斥组是代码常量，变更需发版。
- HTTP actor 使用当前用户和 request ID；bootstrap 与 Better Auth hook 使用稳定的 system actor。
- 失败和拒绝不自动视为成功审计；当前 `AppError` 4xx 也不会自动写 Pino，拒绝日志需要单独设计。

审计 DTO 由 contracts 按 action 提供判别联合，Admin 不直接解析数据库 JSON。permission impact 与运行时授权都必须保留 `admin` 自动获得全部活动注册 permission 的分支。

### 8.3 数据与回滚边界

- 角色不提供物理删除；停用使用归档，恢复保留原有 permission。
- permission 仍通过 contracts、API guard、migration、默认角色和测试一起发布，不提供运行时 CRUD。
- 本阶段没有数据库 schema 变化。回滚 UI 或 endpoint 时，保留对已经写入的角色审计 action 的解析与展示。
- 用户账号停用、恢复、邀请和 Session 撤销不属于角色生命周期，进入独立任务。

### 8.4 条件能力

- 资源范围先由业务 service 和精确 permission 组合表达，不预先增加通配符、继承或策略 DSL。
- 多租户启用时，Better Auth Organization plugin 必须成为 organization、member 和组织角色的唯一来源；不能给当前全局 role 表增加第二套组织角色事实。
- API Key、M2M principal 与人类用户分开；不能写入 `user_roles`。
- FGA/OpenFGA 只有在对象关系授权成为主要需求后单独评估。
