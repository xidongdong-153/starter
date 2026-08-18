# Conversation 破坏性切换

## Goal

在新 Harness 已完整可用后，删除旧 Conversation runtime、API、contracts、Admin 页面和三张数据表，重建模型调用审计关联，并完成最终静态检查、迁移验证和全仓验收。

本任务不新增 Harness 功能，只完成最终不可逆切换。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S8，前置任务是 S1 至 S7 全部完成并归档。

用户已确认不迁移、不导出、不备份旧 Conversation 数据。实际执行开发库 migration 前仍必须输出数据库绝对路径和旧三表记录数，确保目标明确。

## Requirements

### R1. 删除旧 runtime

- 从根 AI Route 移除 Conversation Route 和装配。
- 删除 `modules/ai/conversation/`。
- 删除 `tool/tool-orchestrator.ts`，保留 Tool Registry、handler 和 Pi adapter。
- 删除 generation 恢复、旧 SSE helper 和 Conversation 专用 bootstrap dependency。
- 把仍带 Conversation 名称但服务于共享模型配置的函数改为 Agent/Run 中性名称。

### R2. 删除旧 contracts 与 API

- 删除全部 `AiConversation*`、generation input/DTO、旧 Conversation SSE event 和错误码。
- 删除 `/api/ai/conversations` OpenAPI、RPC probe 和 tests。
- 更新 Prompt 引用检查，只保留全局默认与 AgentDefinition 引用。
- 用量审计 DTO 和查询删除 conversationId/generationId，只保留 nullable runId 和 legacy scenario。

### R3. Admin 最终切换

- 删除 Conversation API、query keys、stream reducer、`AiConversations.tsx` 和测试。
- 删除 retry generation、stop generation 和旧文案。
- 移除旧 Route 和导航项，以 Agent、Session、Run 页面作为最终 AI 入口。
- Admin 不再引用任何 `AiConversation*` 类型或 `/api/ai/conversations`。

### R4. Destructive migration

- 重建 `ai_model_calls`，删除 `conversation_id` 和 `generation_id`，保留 nullable `run_id`。
- 已有旧模型调用审计保留，`run_id` 为 null，scenario 归一为 `legacy`。
- 删除顺序满足外键：generation 依赖和 message 依赖先解除，再删除 generation、message、conversation。
- 保留 Agent、Session、Run、Provider、模型、Prompt、Skill、Tool 和审计数据。
- Pi Session DB 不由该 migration 修改。

### R5. 数据执行

- 先在含新旧数据的临时数据库运行 migration fixture。
- 对开发库执行前输出绝对路径和旧三表记录数。
- 不创建备份、导出文件或 legacy 数据副本。
- 初始化或保留现有空/新 `agent-sessions.db`，不导入旧 message。

## Acceptance Criteria

- [ ] 产品代码不存在 Conversation Service、Repository、Route、Presenter 或 Tool Orchestrator。
- [ ] `/api/ai/conversations`、旧 contracts、generation DTO 和旧 SSE event 不再存在。
- [ ] Admin 不再引用 Conversation 类型、API、query key、reducer、页面或文案。
- [ ] 旧三表不存在，新三表及其数据保持完整。
- [ ] Provider、Prompt、Skill、Tool 和用量审计记录数与迁移前一致。
- [ ] 旧模型调用审计保留为 `runId=null` 和 legacy scenario，新 Run 审计保留 runId。
- [ ] Pi Session DB 没有被 Drizzle migration 修改。
- [ ] 静态搜索、外键检查、类型、Lint、Format、测试、构建和 db check 全部通过。
- [ ] 父任务所有跨子任务验收条件可以逐项核对。

## Out of Scope

- 修复 S1 至 S7 遗留的功能缺口；发现缺口时返回对应子任务处理。
- 旧数据迁移、备份、恢复或兼容 API。
- Web 聊天、群聊、Graph 和多进程扩容。
