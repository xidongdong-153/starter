# 用户权限实现研究摘要

来源：`.trellis/tasks/archive/2026-08/08-09-explore-user-permissions/research.md`。

## 已确认方案

- 当前项目使用 Better Auth cookie session，不把 Auth0 JWT 的 `permissions` claim 直接搬进 session。
- 授权模型是全局 User -> Role -> Permission。用户通过多个角色得到权限并集；首版只做精确 `resource:action` 匹配，不做通配符、角色继承、用户直接 permission 或 Organization 维度。
- 数据库新增 `roles`、`permissions`、`user_roles`、`role_permissions`。角色和权限可归档；授权查询过滤归档项；关联写入放事务。
- `requirePermission` 必须排在 `requireAuth` 后，从 Hono `currentUserId` 取用户，不信任浏览器提交的权限。无 session 是 401，已登录但无权是 403，数据库异常是 500。
- API 每次受保护请求查 SQLite，不使用 Redis 或进程内权限缓存。Admin 的权限集合可以由 TanStack Query 短时间缓存，但只影响菜单和按钮，不是安全边界。
- Admin 通过独立 `/api/me/permissions` 获取当前角色和权限。路由、菜单、组件和按钮可以复用权限判断；收到 403 时刷新权限，不把 403 当作退出登录；收到 401 才处理登录态。
- Better Auth 继续负责注册、登录、OAuth 和 session。Admin plugin 的用户管理能力可以后续评估，但首版业务 RBAC 表、Hono guard、权限接口和 Admin 工具自建；Organization plugin 留给多租户扩展。

## 当前仓库映射

- 认证入口：`apps/api/src/modules/auth/auth.guard.ts`、`auth.service.ts`、`auth.route.ts`。
- DB 汇总：`apps/api/src/infra/db/schema/index.ts`；测试 migration 由 `apps/api/src/test/helpers.ts` 执行。
- 错误契约：`packages/contracts/src/index.ts`、`apps/api/src/shared/app-error.ts`、`apps/api/src/openapi/responses.ts`、`apps/admin/src/api/http.ts`。
- Admin 路由和菜单：`apps/admin/src/app/router/{records,routes,auth-guard}.ts*`、`apps/admin/src/app/navigation/navigation.ts`。
- Admin server state：`apps/admin/src/api/*/*.query.ts` 使用 TanStack Query，权限不放 Zustand 或 localStorage。

## 实现时必须保留的边界

- RBAC 只判断动作类型，文件等业务 service 仍按 `currentUserId` 检查资源 owner。
- 前端隐藏受保护 UI 不能阻止直接请求，所有写接口都要在 API 挂 guard。
- 角色变更提交后，下一次 API 请求使用数据库最新关系；前端权限快照可稍后通过 403、窗口聚焦或主动刷新更新。
- 外部资料中的 Better Auth plugin 配置和 endpoint 版本可能变化；本任务不依赖这些插件的 RBAC 数据表。
