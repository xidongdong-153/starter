# Admin 仅保留 AI 管理控制面

## Goal

让 `apps/admin` 只承担 AI 管理控制面职责，移除 Agent 聊天和 Run 运行消费页面。Admin 继续管理 Provider、模型、Prompt、Skill、Agent、Tool 和用量，不再作为产品 Chat 或 Agent 工作流的示例前端。

## Dependencies

- 前置任务：`08-21-ai-api-foundation-boundary`。
- 必须先确认公开运行协议和 Web 接入边界，再删除 `AgentSessions` 页面及其专用消费代码。

## Requirements

- 从 `apps/admin/src/features/ai/routes.tsx` 移除 `AgentSessions` 路由和菜单项。
- 保留管理页面：`Agents`、`SystemPrompts`、`PromptTemplates`、`Skills`、`AiProviders`、`AiSettings`、`AiUsageAudit`。
- 检查 AI 菜单、本地化文案、权限和路由测试，不留下指向已删除 Agent 会话页面的入口。
- 删除或迁移仅被 Agent 聊天页面使用的 API query、SSE 消费封装、timeline reducer 和页面组件；仍被管理功能使用的 contracts/API 保留。
- Admin 不新增产品 Chat，不把 Admin Harness reducer 变成公共运行协议。
- 管理页面继续通过 API 和 contracts 工作，不直接读取 AI 数据库或 Pi Session 数据。

## Acceptance Criteria

- [ ] Admin AI 菜单中不再出现 Agent Sessions/聊天入口。
- [ ] Provider、模型、Prompt、Skill、Agent、Settings 和用量管理页面仍可访问，并保留权限控制。
- [ ] Admin 构建、类型、Lint、Format 和相关测试通过。
- [ ] 代码中没有因删除页面产生的无用导入、路由、文案或 API 引用。
- [ ] Admin 不成为产品运行协议的必需消费者；Web Chat 不依赖 Admin 私有模块。

## Evidence

- `apps/admin/src/features/ai/routes.tsx`
- `apps/admin/src/features/ai/pages/AgentSessions.tsx`
- `apps/admin/src/features/ai/harness/`
- `apps/admin/src/api/ai/harness.api.ts`
- `apps/admin/src/api/ai/harness.query.ts`
- `apps/admin/src/i18n/locales/zh.ts`
- `apps/admin/src/i18n/locales/en.ts`
