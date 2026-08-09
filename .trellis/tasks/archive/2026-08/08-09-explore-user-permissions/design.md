# 技术设计

## 目标边界

本任务只生成 `.trellis/tasks/08-09-explore-user-permissions/research.md`。报告负责把 Auth0 RBAC 的可核验事实转换成适合当前脚手架的 Better Auth + Hono + Drizzle + SQLite + React 方案；不在本任务中修改运行时代码或数据库。

## 输入与证据

报告使用三类输入：

1. 用户给出的 `Prompt.md`：定义章节、优先级、输出格式和两天内可实施的目标。
2. 当前仓库代码与 Trellis 规范：
   - `apps/api/src/modules/auth/auth.config.ts`
   - `apps/api/src/modules/auth/auth.guard.ts`
   - `apps/api/src/modules/auth/auth.service.ts`
   - `apps/api/src/modules/auth/auth.schema.ts`
   - `apps/api/src/shared/hono-env.ts`
   - `apps/api/src/openapi/responses.ts`
   - `packages/contracts/src/index.ts`
   - `apps/admin/src/app/router/auth-guard.ts`
   - `apps/admin/src/app/router/routes.tsx`
   - `apps/admin/src/api/auth/session.api.ts`
   - `apps/admin/src/api/auth/auth.query.ts`
   - `apps/admin/src/api/http.ts`
   - `.trellis/spec/api/backend/`
   - `.trellis/spec/admin/frontend/`
3. 外部一手资料：Prompt 中列出的 Auth0 RBAC、API RBAC、Core RBAC、Express 示例、Access Token、Better Auth Admin、Better Auth Organization 和 `auth0-react` 官方资料。

外部结论必须带原始链接或代码片段。无法从来源核验的内容写成待确认项，不写成项目决策。

## 报告中的目标数据流

```text
Better Auth cookie session
  -> requireSession
  -> currentUserId in Hono context
  -> permission repository reads user_roles + role_permissions + permissions
  -> requirePermission("resource:action")
  -> route handler
  -> unified 401/403 response

Admin cookie session
  -> getAdminSession / permissions query
  -> React Query cache
  -> TanStack Router route guard
  -> PermissionGuard / usePermission / menu and action visibility
  -> API request remains authoritative
```

报告需要明确每个边界的输入、输出、错误和一致性责任：数据库负责关联完整性，API 负责最终授权，前端只负责导航和界面可见性。

## 方案分析边界

报告按以下顺序展开，避免把认证、授权和多租户混在一起：

1. 先说明 Auth0 的三层权限模型、token claim 和角色来源。
2. 再把模型映射到本项目的四张 RBAC 业务表，说明 Better Auth 自有表不应被重复建模。
3. 然后定义 Hono 中间件的调用链和错误契约，特别区分未认证与已认证但无权限。
4. 再定义 Admin 权限获取、路由守卫、组件控制和 React Query 失效策略。
5. 最后判断 Better Auth 插件的复用边界，并给出 RBAC 到 ABAC/Organization 的后续边界。

报告可以给出目标接口和 schema 草图，但不产生 migration、TypeScript 文件、UI 页面或测试代码。

## 关键取舍

- 权限校验必须在 API 端完成；任何前端权限集合都不能替代后端校验。
- session-based 项目不直接照搬 Auth0 JWT claim；报告需要比较 session 返回权限、独立权限接口和服务端实时查询，并针对当前 SQLite、无 Redis、管理后台规模给出一种首版方案。
- 角色权限表与 Better Auth Admin plugin 的用户管理能力分开分析。Admin plugin 的内置角色能力只有在与自定义权限模型不冲突时才复用；Organization plugin 只作为多租户扩展候选，不把组织成员关系混入首版全局 RBAC。
- 报告中的缓存建议必须同时说明权限撤销的最长生效时间和多实例风险，不能只比较查询性能。

## 兼容性与风险

- 当前 `HonoEnv.Variables` 只有 `currentUserId` 等请求变量；报告应建议新增授权上下文时的边界，但不能直接修改类型。
- 当前 contracts 没有权限错误码，且 `apps/admin/src/api/http.ts` 已能读取 403；报告需指出新增错误码、OpenAPI 响应和前端行为的对应关系。
- 当前 `auth.config.ts` 未启用插件，Better Auth 官方文档的版本和配置可能变化；报告应记录资料访问日期和相关版本假设。
- 当前仓库是低并发、SQLite、管理后台场景；若未来多实例或高并发，缓存和权限变更机制需要重新评估。

## 完成定义

`research.md` 能让实现者直接回答：表如何建、请求如何写、前端如何取权限、撤销后多久生效、哪些能力由 Better Auth 提供，以及首版如何验收。所有结论均能回溯到 Prompt、仓库文件或官方来源。