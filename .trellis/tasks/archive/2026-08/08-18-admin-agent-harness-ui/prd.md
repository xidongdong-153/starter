# Admin Harness 调试界面

## Goal

在 Admin 新增 Agent Session 与 Run 调试界面。管理员可以创建 Session、选择 Agent、启动或停止 Run、查看实时事件、transcript、Tool 活动和终态错误。

旧 `AiConversations` 页面在本任务中继续保留，直到 S8 统一删除。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S7，前置任务是 S3 `08-18-agent-definition-management`、S5 `08-18-agent-session-api` 和 S6 `08-18-agent-run-api`。

本任务只消费父任务共享契约和 S2 导出的 DTO/Event：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。

S3 已提供 Agent 管理页面。本任务只补 Session/Run 调试流程，并沿用现有 Ant Design、TanStack Query、TanStack Router、i18n 和测试方式。

## Requirements

### R1. API client 与 query

- 在 `apps/admin/src/api/ai/` 增加 Session 和 Run 请求函数。
- query key 分为 agents、sessions、session detail、transcript 和 runs，不复用 Conversation key。
- SSE parser 只接受 contracts 的 HarnessEvent，不依赖 Pi event。
- TanStack Query 保存服务端状态；页面局部 state 只保存输入、选择和当前展示状态。

### R2. 页面流程

- 新增 Agent Sessions 页面和独立路由、导航项。
- 支持创建 Session、修改标题、选择 default Agent 和归档。
- 支持选择 enabled Agent、输入消息、启动 Run 和显式 abort。
- 显示 message delta、完成消息、Tool started/progress/completed 和 Run 终态。
- 页面刷新或 SSE 断开后，通过 Run 状态和 transcript 恢复，不依赖 delta replay。

### R3. 状态与错误

- 同一 Session lane 正在运行时禁用重复启动，并正确显示服务端 `AI_SESSION_BUSY`。
- SSE 断开不自动调用 abort。
- 401、403、404、Provider 失败、Tool 失败、aborted 和 interrupted 使用现有错误组件或页面模式。
- 不在 localStorage、Zustand 或组件 state 保存完整 transcript 业务副本。

### R4. 共存

- `AiConversations` 页面、Conversation API、query、reducer、路由和导航继续存在。
- 新旧页面不共享 mutation、query key 或运行控制状态。
- 本任务不删除旧文案；只新增 Harness 所需中英文文案。

## Acceptance Criteria

- [ ] Admin 可以创建 Session、选择 enabled Agent 并启动文本 Run。
- [ ] 页面按 sequence 处理 HarnessEvent，重复或乱序事件不会重复追加终态内容。
- [ ] Tool 活动和 completed/failed/aborted/interrupted 状态可见。
- [ ] 点击停止调用 abort endpoint；页面卸载或 SSE 断开不调用 abort。
- [ ] 刷新后能从 Run 状态和 transcript 恢复已完成内容。
- [ ] busy、权限、网络和终态错误有明确页面状态。
- [ ] Agent Sessions 页面和旧 Conversation 页面测试同时通过。
- [ ] Admin 不导入 Pi 类型，不直接读取 Session DB。
- [ ] 全仓质量门、测试和构建全部通过。

## Out of Scope

- 视觉重设计、Web 聊天页、群聊和 React Flow。
- AgentDefinition 管理功能变更。
- Session fork、search、lane 管理器和 delta replay。
- 删除旧 Conversation 页面或文案。
