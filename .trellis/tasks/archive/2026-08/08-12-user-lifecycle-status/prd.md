# PRD：用户生命周期状态

## 目标

给脚手架的用户主体增加生命周期状态（借鉴课程《AI 电子伴侣企业级实战》认证与用户系统系列，
`users.status` 设计），让管理员可以禁用/启用用户，被禁用的用户无法登录也无法继续使用已建立的会话。

## 背景

课程亮点（168 认证数据库设计、182 角色管理）：

- `users` 表有 `status`（active / suspended / deleted）+ `last_login_at_ms`。
- 用户主体只回答"这个用户是谁"，邮箱、密码、角色、订阅都通过独立表表达。
- 禁用是独立于删除的生命周期状态。

当前脚手架证据（代码现状）：

- `apps/api/src/modules/auth/auth.schema.ts`：`user` 表只有 id / name / email / emailVerified /
  image / createdAt / updatedAt，**没有 status**。
- `apps/api/src/modules/users/`：只有读接口（`GET /api/users` 分页列表、`GET /api/users/{userId}`
  详情），受 `PermissionKeys.AUTHORIZATION_READ` 保护；**没有任何用户状态写接口**。
- 用户角色替换走 `authorization` 模块，用 `AUTHORIZATION_MANAGE` 权限；审计经
  `insertAuditEvent` 写入 `authorizationAuditEvents`。
- 权限点（`packages/contracts/src/index.ts` PermissionKeys）：`authorization-audit:read`、
  `authorization:manage`、`authorization:read`、`file:*`，没有 user:* 权限点。
- 认证链路：Better Auth（v1.6.x），支持 `user.additionalFields`（自定义用户字段随
  getSession/登录返回）和 `databaseHooks.session.create.before`（返回 false 可拒绝创建 session）。
- `auth.guard.ts` 只检查登录态，不检查用户状态。

## 需求（已确认）

1. `user` 表增加 `status` 字段：两态 `active` / `suspended`，默认 `active`，带 CHECK 约束。
   Q1 已确认：不做 deleted 软删除，延后。
2. 被禁用（suspended）的用户：登录被拒绝（创建 session 前拦截）；已建立的会话在 guard 层
   被拒绝（每次请求查 user.status，即时失效）。Q2 已确认方案 A。
   禁用操作同时删除该用户全部 session，保证 Better Auth 内部接口（update-user 等）也失效。
3. 管理端提供禁用/启用接口：`PATCH /api/users/{userId}/status`，受 `AUTHORIZATION_MANAGE`
   权限保护。Q4 已确认：复用现有权限点，不新增。
4. 状态变更记录审计事件（新 action `user.status_changed`，before/after 均为 { status }）。
5. admin 前端用户管理页提供禁用/启用操作与状态展示。
6. 契约（contracts）与 OpenAPI 同步更新。
7. 防呆：禁止管理员禁用自己，请求返回 400。Q5 已确认。
8. 幂等：目标状态与当前状态一致时直接成功返回。
9. 不实现 lastLoginAt。Q3 已确认：本次不加。

## 验收标准

1. `pnpm --filter @starter/api db:generate` 生成 migration，`db:migrate` 可执行，
   现有数据默认值为 active。
2. 禁用用户后：该用户密码登录失败（不创建 session）；该用户已有会话的后续自有 API 请求
   返回 401（错误码 `AUTH.USER_SUSPENDED`）；该用户已无任何 session。
3. 启用用户后：可正常重新登录。
4. 管理接口：未登录 401、无 `authorization:manage` 权限 403、用户不存在 404、
   禁用自己 400、重复提交目标状态 200（幂等）。
5. 状态变更写入 `authorizationAuditEvents`（action = `user.status_changed`），
   审计接口可查询到。
6. 契约类型：`UserManagementUser` 含 `status`；`updateUserStatusSchema` 校验
   `active | suspended`。
7. 前端：用户列表展示状态，可对 active 用户禁用、对 suspended 用户启用。
8. `pnpm check`（types → lint → format 零错误）+ `pnpm test` 全绿。

## 非目标（已确认）

- 不做用户软删除（deleted 状态），延后。
- 不做 lastLoginAt 统计字段。
- 不改 Better Auth 表结构（session / account / verification 保持原样，只给 user 表加列）。
- 不新增 user:* 权限点；登录失败不区分"封禁"与"密码错误"细节（安全考虑）。
- 不实现自助注销、设备管理等其他用户生命周期能力。
