# 用户管理现状与 Better Auth Admin plugin 调研

## 仓库现状

- 当前仓库使用 Better Auth `1.6.16`、Hono、Drizzle ORM 和 SQLite。
- `apps/api/src/modules/auth/auth.schema.ts` 的用户表已有 `id`、`name`、`email`、`emailVerified`、`image`、`createdAt`、`updatedAt`。
- `GET /api/authorization/users` 已能返回全部用户的 `id`、`name`、`email` 和 `roleKeys`，但没有查询参数、服务端分页、状态字段或用户详情。
- `apps/admin/src/features/authorization/pages/AuthorizationSettings.tsx` 已在授权设置页显示用户及角色，并支持修改其他用户的角色。
- `/settings/authorization` 和现有查询接口由 `authorization:read` 保护；现有 `admin` 角色拥有全部活动权限。当前角色权限可在授权设置页调整，因此“拥有读取权限”和“角色必须是 admin”不是同一条规则。
- 仓库使用数据库表 `roles`、`permissions`、`user_roles`、`role_permissions` 作为 RBAC 唯一依据。Better Auth Admin plugin 尚未配置。

## Better Auth Admin plugin 1.6.16

官方文档：<https://better-auth.com/docs/plugins/admin>

插件提供以下用户管理能力：

- 创建用户。
- 按姓名或邮箱搜索用户，支持过滤、排序、`limit`、`offset`，响应包含 `users`、`total`、`limit` 和 `offset`。
- 按 ID 读取用户。
- 修改用户资料、角色和密码。
- 封禁或解封用户；封禁会阻止后续登录并撤销现有会话。
- 查看用户会话、撤销单个会话或撤销全部会话。
- 模拟用户登录。
- 物理删除用户。

插件需要给 `user` 表增加 `role`、`banned`、`banReason`、`banExpires`，给 `session` 表增加 `impersonatedBy`。服务端配置 `admin()`，客户端配置 `adminClient()`，并重新生成或迁移数据库 schema。

## 对当前任务的影响

- 只做只读列表时，直接扩展现有 Hono authorization 模块最短，不需要引入插件字段，也不会产生第二套角色来源。
- 需要封禁、密码重置、会话管理或删除时，Admin plugin 已有经过维护的认证侧操作，但它默认使用 `user.role` 做权限判断。接入前必须明确如何与现有数据库 RBAC 共存，不能让 `user.role` 和 `user_roles` 同时决定业务权限。
- “系统管理员可查看”需要明确成可测试规则：按现有 `authorization:read` permission 判断，或强制当前用户拥有系统 `admin` 角色。前者符合现有权限体系，后者限制更严格。
- 物理删除、管理员代登录和直接设置密码风险较高，不应自动进入首版范围。
