# Admin 仅保留 AI 管理控制面

## Goal

让 `apps/admin` 只承担 AI 管理控制面职责，移除 Agent 聊天和 Run 运行消费页面。Admin 继续管理 Provider、模型、Prompt、Skill、Agent、Tool 和用量，不再作为产品 Chat 或 Agent 工作流的示例前端。

同时补上控制面缺的一块：API 已经提供 `/api/ai/admin/applications*`（产品应用凭据的创建、列表、轮换、撤销），Admin 还没有页面，凭据只能靠手敲 HTTP 创建。本任务一起把这个页面做出来。

## Dependencies

- 前置任务：`08-21-ai-api-foundation-boundary`。
- 必须先确认公开运行协议和 Web 接入边界，再删除 `AgentSessions` 页面及其专用消费代码。

## Requirements

### 移除运行面消费代码

- 从 `apps/admin/src/features/ai/routes.tsx` 移除 `AgentSessions` 路由和菜单项。
- 保留管理页面：`Agents`、`SystemPrompts`、`PromptTemplates`、`Skills`、`AiProviders`、`AiSettings`、`AiUsageAudit`。
- 检查 AI 菜单、本地化文案、权限和路由测试，不留下指向已删除 Agent 会话页面的入口。
- 删除或迁移仅被 Agent 聊天页面使用的 API query、SSE 消费封装、timeline reducer 和页面组件；仍被管理功能使用的 contracts/API 保留。
- Admin 不新增产品 Chat，不把 Admin Harness reducer 变成公共运行协议。
- 管理页面继续通过 API 和 contracts 工作，不直接读取 AI 数据库或 Pi Session 数据。

### 新增应用凭据管理页面

- 新增页面 `apps/admin/src/features/ai/pages/AiApplications.tsx`，路由 `/ai/applications`，进 AI 菜单组。
- 路由权限用 `PermissionKeys.AI_CONFIG_MANAGE`，与 API 侧 `requireManage` 一致；页面内写操作按钮同样受 `AI_CONFIG_MANAGE` 控制。
- 列表显示 `name`、`tenantId`、`projectId`、`status`、`secretPrefix`、`createdAt`、`lastUsedAt`；`revoked` 状态可见但不可轮换。
- 创建表单字段只有 `name`、`tenantId`、`projectId`，校验规则跟随 `createAiApplicationSchema`。
- secret 只在创建和轮换的响应里返回一次：用独立弹窗展示、提供复制按钮、写明关闭后不可再查看；secret 不进 React Query 缓存、不进 URL、不写日志。
- 撤销走二次确认，撤销后刷新列表；`tenantId`/`projectId` 不可编辑，改 scope 的方式是撤销后重建。
- API 层新增 `apps/admin/src/api/ai/application.api.ts` 与 `application.query.ts`，通过 `apiRpc` + `unwrapApiData` 调用，query key 挂在 `aiQueryKeys.admin` 下，并从 `apps/admin/src/api/ai/index.ts` 导出。
- 中英文文案补齐菜单项和页面内文案，不留 i18n 缺 key。

## Acceptance Criteria

- [x] Admin AI 菜单中不再出现 Agent Sessions/聊天入口。
- [x] Provider、模型、Prompt、Skill、Agent、Settings 和用量管理页面仍可访问，并保留权限控制。
- [x] 应用凭据页面可以创建、列出、轮换和撤销凭据，secret 只在一次性弹窗出现，列表只显示 `secretPrefix`。
- [x] 没有 `AI_CONFIG_MANAGE` 权限时看不到该页面入口，写操作按钮不可用。
- [x] Admin 构建、类型、Lint、Format 和相关测试通过。
- [x] 代码中没有因删除页面产生的无用导入、路由、文案或 API 引用。
- [x] Admin 不成为产品运行协议的必需消费者；Web Chat 不依赖 Admin 私有模块。

## 验证记录

```
pnpm check-types      9/9 通过
pnpm lint             6/6 通过
pnpm format:check     6/6 通过
admin test            19 文件 / 105 用例通过
api test              38 文件 / 255 用例通过
pnpm build            5/5 通过
git diff --check      无空白错误
```

未验证：没有跑浏览器手工验收，`/ai/applications` 的真实接口连通、clipboard 复制和移动端布局只有 jsdom 层面的断言。

## Evidence

- `apps/admin/src/features/ai/routes.tsx`
- `apps/admin/src/features/ai/pages/AgentSessions.tsx`
- `apps/admin/src/features/ai/harness/`
- `apps/admin/src/api/ai/harness.api.ts`
- `apps/admin/src/api/ai/harness.query.ts`
- `apps/admin/src/i18n/locales/zh.ts`
- `apps/admin/src/i18n/locales/en.ts`
- `apps/api/src/modules/ai/application/application.openapi.ts`
- `packages/contracts/src/ai.ts`（`aiApplicationSchema`、`aiApplicationSecretSchema`、`createAiApplicationSchema`）
