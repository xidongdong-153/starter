# AgentRun API

本任务使用父任务共享契约：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。Run DTO、snapshot、事件顺序、`starter.run.v1` 和错误码不得在本任务中另行定义。

## Goal

组合 AgentDefinition、AgentExecutor 和 AgentSession，完成 AgentRun 的持久化生命周期、SSE、显式 abort、steer、follow-up、单 lane 并发控制和进程中断恢复。

本任务完成后，新 Harness 后端可以独立运行；旧 Conversation API 仍保留到 S8。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S6，前置任务是 S3 `08-18-agent-definition-management`、S4 `08-18-pi-agent-execution-core` 和 S5 `08-18-agent-session-api`。

## Requirements

### R1. Run 子域

- 在 `modules/ai/run/` 增加 openapi、presenter、repository、route 和 service。
- Run 保存 sessionId、agentId、lane、status、agentRevision、无 secret snapshot、requestId、时间、finalEntryId 和 errorCode。
- 内部状态为 `starting | running | completed | failed | aborted | interrupted`。
- 非终态只能条件更新到一个终态；重复 terminal 回调不覆盖第一次结果。

### R2. 启动

- 先验证 Session owner、未归档状态和 Agent enabled 状态。
- 解析 AgentDefinition 并冻结 revision 与 snapshot。
- registry 先预留 `sessionId + lane`；本进程冲突时返回 `AI_SESSION_BUSY`，不创建 Run row。
- Run Service 是 registry reserve、attach、release、Run row 和终态编排的唯一所有者；Executor 不创建或更新主库 Run。
- 创建 Run row 后启动 executor；后续失败必须写稳定终态并释放 registry。
- Pi writer lease 冲突发生在 Run row 创建后时，将该 Run 标记 failed。

### R3. API

- `POST /api/ai/sessions/{sessionId}/runs`：启动并返回 SSE。
- `GET /api/ai/sessions/{sessionId}/runs/{runId}`：读取状态。
- `POST .../{runId}/abort`
- `POST .../{runId}/steer`
- `POST .../{runId}/follow-ups`
- 所有 Route 使用 Session owner 校验，不能操作他人的 Run。

### R4. SSE

- SSE `id` 是 eventId，`event` 是 HarnessEvent.type，`data` 是完整 event JSON。
- heartbeat 使用 comment，不创建 HarnessEvent。
- 客户端断开只停止向该连接写数据，不调用 abort。
- 第一版不支持 `Last-Event-ID` delta replay；断线后通过 Run 状态和 transcript 恢复。

### R5. 持久化与恢复

- Executor 先写 user/assistant/Tool/compaction entries 并返回 terminal result；Run Service 再写 `starter.run.v1`，条件更新主库 Run，最后发布唯一 terminal HarnessEvent 并 release registry。
- API 启动时把没有 active handle 的遗留非终态 Run 标记为 interrupted。
- 若 Pi terminal entry 已存在但主库未更新，恢复逻辑投影该终态。
- 已提交的 transcript entry 在 failed、aborted 或 interrupted 后保留。

## Acceptance Criteria

- [ ] 文本 Run 从 starting/running 进入唯一 completed 终态，SSE 顺序正确。
- [ ] `run.started`、Executor message/tool events 和 terminal event 共用同一个 Run-local sequence，terminal event 只发布一次。
- [ ] Provider、Tool、compaction 和存储失败映射为稳定 failed 结果。
- [ ] 显式 abort 产生 aborted 终态；SSE 断开后 Run 继续并持久化完成。
- [ ] steer 和 follow-up 只对当前 active Run 生效，终态后返回稳定错误。
- [ ] 同一 Session lane 的并发请求返回 `AI_SESSION_BUSY` 且不创建多余 Run row。
- [ ] 不同 lane 或不同 Session 可以并发。
- [ ] 启动恢复覆盖 Pi terminal entry 和无 terminal entry 两种中断窗口。
- [ ] `starter.run.v1` 只接受共享契约中的唯一合法 entry；重复或解析失败时标记 `AI.RUN_INTERRUPTED`。
- [ ] 所有资源归属、404、401 和冲突路径有 smoke test。
- [ ] 旧 Conversation 和 Tool runtime 保持通过。
- [ ] 全仓质量门、测试、构建和数据库检查全部通过。

## 备注：S5 转录 runId 挂载约定（S5 已定稿，S6 需落实写入侧）

S5（`08-18-agent-session-api`）的 transcript item 中 `user_message`、`assistant_message`、`tool_activity` 的 `runId` 是 S2 契约必填 UUID，但 Pi 标准 message entry 没有 runId 槽位。已确认 Pi SQLite backend 对 message entry 做原样 JSON 持久化（`entryPayload` 剔除基础字段后全量 `stringify`，读回完整还原），因此 S6 在写入侧为 message 附加字段即可承载 runId，S5 不改 S2 契约。

写入侧约定（本任务 S6 落实）：

- assistant / user message：持久化时在 message 对象上附加 `runId` 字段（运行时多余字段，不影响 Pi 的 `buildSessionContext` / `convertToLlm`）。
- toolResult message：在 `details`（`PiToolResultDetails`）中附加可选 `runId`，或同时在 message 上附加；S5 读取规则对两路都兼容。

S5 读取规则（已实现，本任务不修改）：`message.runId`（UUID 校验）优先，其次 `message.details.runId`；两者都缺失时该 item 不投影并记录结构化日志（entry type + entry id + requestId）。因此 S6 写入的 message 不带可识别 runId 时，该 message 不会出现在 transcript 中。

## Out of Scope

- 多进程 queue、Event broker 和跨节点 active Run 控制。
- SSE delta replay 和断线续传。
- Run 重试 API；新的输入创建新的 Run。
- Admin 页面和旧 runtime 删除。
