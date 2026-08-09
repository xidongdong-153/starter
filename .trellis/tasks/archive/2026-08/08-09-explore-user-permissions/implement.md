# 执行计划

## 1. 复核任务边界

- [x] 读取最终版 `prd.md`、`design.md` 和 `Prompt.md`。
- [x] 确认本任务只生成 `research.md`，不修改 `apps/`、`packages/` 或 migration。
- [x] 以 Prompt 的 P0/P1/P2 优先级分配调研精力：Auth0 RBAC、后端中间件和前端控制为主，插件和扩展路线为辅。

## 2. 核验外部资料

- [x] 阅读 Auth0 RBAC 总览，记录 User -> Role -> Permission、角色与权限关系。
- [x] 阅读 Auth0 API RBAC 和 Access Token 资料，记录 `permissions` claim、`scope` 和授权校验边界。
- [x] 阅读 Auth0 Core RBAC 和 Express 示例，记录角色分配、权限命名及 middleware 调用方式；对通配符、继承和组织角色只在来源明确时下结论。
- [x] 阅读 Better Auth Admin plugin 和 Organization plugin，区分内置用户管理/角色能力与本项目自定义权限模型。
- [x] 阅读 `auth0-react` 的权限相关使用方式，转换为当前原生 React + TanStack Query 结构。
- [x] 每个外部结论在报告中保留官方链接或最小代码示例。

## 3. 复核仓库现状

- [x] 记录 Better Auth 配置、session cookie、现有表和 migration 入口。
- [x] 记录 Hono `currentUserId` 的写入位置、认证 middleware 的调用顺序和统一错误响应。
- [x] 记录 Admin 路由登录守卫、session query、HTTP 401/403 解析和状态管理规范。
- [x] 将事实与建议分开写，避免把当前行为误写成目标设计。

## 4. 形成调研报告

- [x] 按 Prompt 的六个章节写 `research.md`。
- [x] 给出四张表的字段、关系、约束、索引、系统角色和删除策略。
- [x] 给出 `requirePermission("resource:action")` 的接口示例、认证/授权顺序和 401/403 契约。
- [x] 比较 session 携带、独立 `/api/me/permissions` 和混合获取方式，选出首版推荐方案。
- [x] 给出 `PermissionGuard`、`usePermission`、路由和按钮控制的接口草图。
- [x] 给出权限变更同步、缓存失效和撤销权限最长生效时间。
- [x] 给出两天内可执行的分步实施清单和测试验收项。

## 5. 质量检查

- [x] 从头阅读 `research.md`，检查六个章节、P0/P1/P2 要点和实现清单是否完整。
- [x] 检查每个外部结论都有来源，无法核验的内容标为假设或待确认。
- [x] 检查报告引用的仓库路径真实存在，方案没有引入 React Admin、JWT 或 Redis 作为未请求前提。
- [x] 检查 API、数据库、前端和权限同步四段数据流是否能首尾对应。
- [x] 运行链接可访问性检查；8 个官方链接均返回 HTTP 200。
- [x] 运行 Trellis 检查流程，确认任务文件格式和规范覆盖正确。

## 6. 规范更新

- [x] 新增 `.trellis/spec/api/backend/authorization-guidelines.md`，记录候选授权契约、错误矩阵和测试边界。
- [x] 更新 `.trellis/spec/api/backend/index.md` 的文件索引。
- [x] 明确 spec 标记为“候选设计，尚未实现”，避免未来把调研建议误读为当前行为。

## 风险与回滚点

- 外部文档版本变化：在报告中保留访问日期、页面链接和版本假设；实现前重新核对 Better Auth 当前版本。
- 当前项目规模与未来多租户需求混淆：把多租户列为扩展路线，不扩大首版权限模型。
- 方案误导实现：所有前端控制都标注为 UX 辅助，后端 middleware 作为安全边界。
- 本任务不涉及产品代码；若报告方向需要改动代码，应另建实现任务，不在本任务中扩大范围。

## 验证命令

```bash
pnpm exec prettier --check .trellis/tasks/08-09-explore-user-permissions/*.md
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-09-explore-user-permissions
```

开始执行后的产品代码检查命令，留给后续实现任务：

```bash
pnpm check
pnpm test
```
