# 平台管理员写入边界

## Goal

把 `admin` 明确为平台根角色：所有授权控制面写操作在写 transaction 内重新校验 actor 的活动 `admin` 角色，并保护最后一个活动平台管理员。

同时一次性引入 repository 写入上下文（actor 类型、actor ID、request ID），让 S3 只需往同一 transaction 追加审计插入，不必再改一遍函数签名。

## Background

父任务：`08-09-rbac-governance`。前置：S1 `08-09-admin-test-harness` 已完成（本任务不改 Admin，但父任务顺序如此）。

当前实现的问题（已核对源码）：

- `authorization.route.ts` 的两个写路由只挂 `requireAuth` 和 `requireAuthorizationManage`。
- `authorization.service.ts` 只有两条保护：`replaceUserRoles` 禁止 actor 改自己的角色；`replaceRolePermissions` 禁止修改 `admin` 角色的权限。
- `authorization.repository.ts` 的 `replaceUserRoles` 和 `replaceRolePermissions` 在 transaction 内只校验目标存在性和 key 有效性，不校验 actor 身份。

结果：任何持有 `authorization:manage` 的普通角色都可以给其他用户授予 `admin`，也可以修改自己所属的非 `admin` 角色的权限。默认 seed 没有把 `authorization:manage` 给 `operator` 或 `viewer`，所以当前数据不会触发这条路径，但接口形状不成立。

另外 `bootstrapAdminByEmail` 无条件 `delete` + `insert`，目标已经是纯 `admin` 时也重写关系。S3 要求"幂等无变化不写事件"，所以 before 读取必须在本任务或 S3 引入。本任务引入，理由见 Product Decision。

## Product Decision

- actor 平台管理员检查放在 repository 的 transaction 内，不放 service。route 的 `authorization:manage` 和 service 检查只负责尽早拒绝。理由：并发撤权时 transaction 外的快照可能过期。
- repository 保持现有 discriminated union 返回风格，不在 repository 抛 `AppError`。新增两个 kind 由 service 翻译成 HTTP 错误。
- 一次性引入 `AuthorizationWriteContext`，替换现有的 `assignedBy: string` 参数。S3 只往 transaction 内追加审计插入。
- 引入 before 读取和幂等短路。before 与 after 相同时不删除重插关系，直接返回成功。理由：一是为 S3 的"无变化不写事件"提供基础，二是避免每次替换都产生无意义的 `assignedAt` 更新。
- 最后一个平台管理员保护在当前 HTTP 路径上不可达（actor 必须是活动 admin 且不能改自己，撤销别人的 admin 之后 actor 自己还在）。仍然实现，只做 repository 级测试，不声称这是已具备的 HTTP 行为。
- `authorization:manage` 收紧后，普通角色持有它只能读不能写。本任务只在 API 返回明确 403 message 并更新 spec，不改 Admin UI 和 role catalog DTO。

## Requirements

### R1. 写入上下文

- 在 `apps/api/src/modules/authorization/` 定义 `AuthorizationWriteContext`：`actorType: 'user' | 'system'`、`actorId: string`、`requestId: string | null`。
- `replaceUserRoles`、`replaceRolePermissions`、`bootstrapAdminByEmail` 的 `assignedBy: string` 参数替换为该上下文。
- `assignedBy` 字段的写入值：`actorType === 'user'` 时写 `actorId`，`actorType === 'system'` 时写 `null`，与当前 hook 和 bootstrap 的行为一致。
- HTTP 路由传 `{ actorType: 'user', actorId: c.var.currentUserId, requestId: c.var.requestId }`。
- `bootstrap-admin` 脚本传 `{ actorType: 'system', actorId: 'auth:bootstrap-admin', requestId: null }`。
- 本任务不新增审计表，上下文只用于 `assignedBy` 和 S3 的准备。

### R2. Transaction 内平台管理员检查

- `replaceUserRoles` 和 `replaceRolePermissions` 在 transaction 内查询 actor 是否关联未归档的 `admin` 角色。
- `actorType === 'system'` 跳过该检查。系统入口不经过浏览器 actor 校验。
- 检查失败返回 `{ kind: 'actor-not-platform-admin' }`，service 翻译为 `AUTH.FORBIDDEN` 403。
- 检查顺序在目标存在性校验之后、关系写入之前，与现有 kind 判断风格一致。

### R3. 最后一个平台管理员保护

- `replaceUserRoles` 在目标用户从"有 admin"变为"无 admin"时，在同一 transaction 内统计活动平台管理员数量。
- 提交后数量会归零时返回 `{ kind: 'last-platform-admin' }`。
- service 翻译为新增的 `AUTH.LAST_PLATFORM_ADMIN`，HTTP 409。
- 「活动平台管理员」定义：现存 `user` 记录通过 `user_roles` 关联到未归档的 `admin` 角色。当前 user schema 没有封禁字段，不把这条关系描述成"可登录"。

### R4. 幂等短路

- `replaceUserRoles`、`replaceRolePermissions`、`bootstrapAdminByEmail` 在写入前读取规范排序后的 before 值。
- before 与 after 集合相同时不执行 `delete` + `insert`，直接返回成功和当前值。
- 幂等短路发生在平台管理员检查之后，不能让无权 actor 通过"提交相同值"绕过检查。

### R5. 错误契约

- 在 `packages/contracts/src/index.ts` 的 `ApiErrorCodes` 增加 `AUTH_LAST_PLATFORM_ADMIN: 'AUTH.LAST_PLATFORM_ADMIN'`。
- 在 `apps/api/src/openapi/responses.ts` 增加 409 response，或复用已有 conflict response（实现时确认是否存在）。
- `replaceUserRolesRoute` 声明 409。
- 403 的 message 区分两种原因：修改自己的角色、actor 不是平台管理员。

### R6. 测试

在 `apps/api/src/test/authorization.smoke.test.ts` 增加：

- 持有 `authorization:manage` 的非 admin 用户替换其他用户角色返回 403，关系不变。
- 持有 `authorization:manage` 的非 admin 用户替换角色权限返回 403，关系不变。
- admin 用户执行同样操作成功。
- 提交与当前完全相同的 roleKeys 时返回成功，且 `assignedAt` 未变化（证明幂等短路）。
- 提交与当前完全相同的 permissionKeys 时同上。
- 直接调用 repository 撤销最后一个活动平台管理员，返回 `last-platform-admin`，关系不变。
- `bootstrapAdminByEmail` 对已是纯 admin 的用户重复执行时不重写关系。
- 现有的 self-mutation 403、admin 角色权限只读 403 仍然通过。

## Out of Scope

- 不新增审计表、审计事件、审计查询接口（S3）。
- 不改动 `apps/admin` 任何文件。
- 不改动 role catalog DTO 和 `authorization:read` 的语义。
- 不新增角色创建、编辑、归档、恢复接口。
- 不修改四张 RBAC 表的 schema，不生成 migration。
- 不引入委派管理模型，不拆分 `authorization:manage`。
- 不给 `AppError` 4xx 增加 Pino 日志。

## Acceptance Criteria

- [ ] 持有 `authorization:manage` 的普通角色不能替换任何用户角色，也不能修改任何角色权限，返回 403。
- [ ] 活动 `admin` 执行两个写操作正常成功。
- [ ] 平台管理员检查在写 transaction 内进行，可通过代码位置验证。
- [ ] 提交相同集合时不重写关系，`assignedAt` 保持不变。
- [ ] repository 层测试证明撤销最后一个活动平台管理员返回 `last-platform-admin`，关系不变。
- [ ] `AUTH.LAST_PLATFORM_ADMIN` 已加入 contracts，`replaceUserRolesRoute` 声明 409。
- [ ] 系统入口（`bootstrap-admin`）跳过 actor 检查，仍能正常执行。
- [ ] `git diff` 确认 `apps/admin` 未被修改。
- [ ] `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm --filter @starter/api db:check` 全部通过。
