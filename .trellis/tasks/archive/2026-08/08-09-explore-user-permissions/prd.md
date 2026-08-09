# 探索当前脚手架的用户权限设计

## Goal

产出一份可以直接指导当前 TypeScript 全栈脚手架实现 RBAC 的调研报告。报告以 Auth0 的 User -> Role -> Permission 模型为参考，适配当前 Better Auth session-based 认证，不改动产品代码。

## Background

当前仓库的认证和请求链路已经具备以下事实：

- API 使用 Better Auth 1.6.x、Drizzle SQLite 适配器和 cookie session；`apps/api/src/modules/auth/auth.config.ts` 当前只配置邮箱密码、社交登录和用户创建后的 profile hook，没有启用 admin 或 organization plugin。
- API 的 `createRequireAuth` 在 `apps/api/src/modules/auth/auth.guard.ts` 中调用 `requireSession`，并把 `session.user.id` 写入 Hono 的 `currentUserId`；业务路由通过该变量限制当前用户资源。
- Better Auth 相关表目前位于 `apps/api/src/modules/auth/auth.schema.ts`，现有表为 `user`、`session`、`account`、`verification`，没有角色、权限和关联表。
- Admin 是 React + Vite + TypeScript 单页应用，使用 TanStack Router、TanStack Query 和原生 React；`apps/admin/src/app/router/auth-guard.ts` 当前只判断是否存在 session，注释明确写着权限尚未接入。
- Admin 通过 Better Auth cookie 和 `credentials: 'include'` 读取 session，React Query 管理认证查询；`apps/admin/src/api/http.ts` 已区分 401 和 403，但 API contracts 目前只定义了认证 401 等错误码。

## Requirements

### R1. Auth0 RBAC 模型调研

说明 User -> Role -> Permission 三层关系，覆盖：

- `resource:action` 权限命名、通配符支持情况、角色聚合权限、角色继承或嵌套能力。
- 用户直接分配角色与通过 Organization 获得角色的关系。
- Access Token 中 `permissions` claim 与 `scope` claim 的用途和差异。
- 每条外部结论附 Auth0 官方链接或可核验代码示例。

### R2. 当前项目的后端落地方案

基于 Hono + Drizzle + Better Auth + SQLite，给出可执行设计，覆盖：

- `roles`、`permissions`、`user_roles`、`role_permissions` 的字段、唯一约束、外键、索引、系统角色和删除策略。
- 权限定义采用数据库表、代码常量或组合方式的选择依据。
- `requirePermission("resource:action")` 的调用形态、与 `requireSession` 的顺序、查询边界、错误码和 401/403 响应。
- 无 Redis 环境下每请求查库、session 加载、进程内 Map 缓存的取舍，并给出适合当前管理后台规模的推荐。
- 权限查询如何复用当前 `currentUserId` 和现有 response/OpenAPI 约定。

### R3. 当前项目的 Admin 前端方案

基于现有 TanStack Router + React Query + 原生 React，给出可执行设计，覆盖：

- 权限信息从 session、独立的 `/api/me/permissions` 接口或混合方案获取，并说明缓存和失效时机。
- 路由级、页面组件级和按钮级权限控制的接口，例如 `PermissionGuard`、`usePermission` 和菜单过滤。
- 登录态、权限加载中、无权限、接口 403 和权限请求失败的可观察行为。
- 参考 auth0-react 的权限使用方式，但不引入 React Admin。

### R4. 权限变更同步

定义管理员撤销或增加角色后，已登录用户的行为：

- 后端何时重新读取权限、缓存如何失效、撤销权限的最长生效时间。
- 前端如何通过请求失败、重新获取权限或主动刷新发现变更。
- 不能把前端 UI 隐藏当作后端安全边界。

### R5. Better Auth 与扩展路线

判断 Better Auth admin plugin、organization plugin 和自定义 plugin 的适用边界，并说明：

- 哪些认证或用户管理能力直接复用。
- 哪些 RBAC 数据和中间件需要自建。
- 从 RBAC 向 ABAC、再向多租户/Organization 扩展时需要保留或重新设计的边界；不设计完整 ABAC 或多租户实现。

### R6. 报告结构和实施可行性

报告写入 `.trellis/tasks/08-09-explore-user-permissions/research.md`，并按 `Prompt.md` 要求输出以下结构：

1. Auth0 RBAC 核心发现
2. 后端落地方案
3. 前端落地方案
4. 前后端配合关键点
5. Better Auth 集成建议
6. 扩展路线

报告必须包含至少一条接口调用示例和一组足以指导两天内完成首版 RBAC 的实施清单：四张表 migration、权限中间件、前端权限工具和用户-角色-权限管理页面。

## Out of Scope

- 不修改 `apps/`、`packages/` 中的产品代码、数据库 schema、migration 或 UI。
- 不实现 Auth0 托管服务、计费、部署、Dashboard 或完整 Management API。
- 不深入比较 Casbin、Oso、Keycloak 等方案；只说明选用 Auth0 模式的直接理由。
- 不深入实现 Google Zanzibar、一致性模型、WebSocket 或完整 ABAC/多租户系统。

## Acceptance Criteria

- [x] 任务规划明确报告文件位置、调研边界和不做代码实现。
- [x] 报告逐项覆盖 `Prompt.md` 的 6 个章节和 P0/P1/P2 调研目标。
- [x] Auth0、Better Auth、auth0-react 的外部结论带来源链接或代码示例；无法核验的事实不得写成确定结论。
- [x] 报告与当前仓库的认证、数据库、Hono context、错误响应和 Admin 路由现状一致，并引用实际文件路径。
- [x] 报告给出可执行的 schema、中间件、前端权限工具、同步策略和验收清单，而不是只做概念介绍。
- [x] 完成 PRD、技术设计和执行计划后，由用户明确批准最终规划摘要，才能进入 `task.py start`。

## Research Deliverable

- `.trellis/tasks/08-09-explore-user-permissions/research.md`：最终调研报告。
- `.trellis/tasks/08-09-explore-user-permissions/design.md`：报告的技术设计边界、数据流和取舍。
- `.trellis/tasks/08-09-explore-user-permissions/implement.md`：报告调研、写作和验收步骤。
