# Pi Agent 执行核心

## Goal

实现无 HTTP 依赖的 Pi Agent 执行核心：根据已解析配置运行 Agent loop，把 Pi event 映射为 HarnessEvent，适配现有 Tool Registry，记录模型与 Tool 用量，并维护进程内 active Run 控制。

本任务通过直接测试验证 executor，不注册公开 Run Route。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S4，执行依赖已完成并归档的 S1 `08-18-pi-session-storage-foundation` 和 S2 `08-18-agent-harness-contracts-schema`。S3 `08-18-agent-definition-management` 也已完成并归档，但 S4 通过已解析配置 fixture 直接测试，AgentDefinition 与 Executor 的正式装配留给 S6。

旧 `tool-orchestrator.ts` 继续只服务 Conversation runtime。新 executor 不调用它，也不复制它的模型循环。

## Requirements

### R1. AgentExecutor

- 使用 Pi `Agent` 或 `agentLoop`，不得调用未完成的 `AgentHarness` 方法。
- 输入是已解析 Agent 配置、Session context、用户 input、runId、sessionId、lane 和 AbortSignal。
- `prepare(input)` 返回 controls、message/tool 事件流、terminal result promise 和 `start()`；caller attach controls 后再启动 Agent loop。
- Agent loop、Tool loop、steer、follow-up 和 abort 使用 Pi 原生能力。

### R2. 事件与运行控制

- `PiEventMapper` 是 Pi event 到 HarnessEvent 的唯一转换位置。
- 每个 Run 的 sequence 由 caller 提供的 `EventSequencer` 单调递增；Executor 不创建 terminal HarnessEvent。
- `ActiveRunRegistry` 同时按 runId 和 `sessionId + lane` 定位 active handle。
- registry 提供 abort、steer、follow-up 和清理；它不是持久化事实来源。
- Registry 的 reserve、attach 和 release 由后续 Run Service 调用；Executor 不自行占用或释放 registry。

### R3. Tool adapter

- 把现有 Zod Tool definition 适配为 Pi `AgentTool`。
- `z.toJSONSchema` 只生成模型可见 parameters；执行前仍用原 Zod schema parse。
- 保留 timeout、requiredPermission、safeSummary 和取消信号。
- Tool lifecycle 只写一次现有 Tool 审计，不由旧 Orchestrator 再写。

### R4. 模型与用量审计

- Pi stream function 继续通过现有 Gateway、模型白名单、Provider credential 和 timeout 逻辑。
- 每轮模型调用写一条 `ai_model_calls`，新调用只写 `runId`，旧关联列为空。
- 正常、Provider 失败、timeout 和 abort 都关闭审计记录。
- Provider secret 不进入 event、日志或 snapshot。

### R5. Session 与 compaction

- 从 S1 Session Store 读取 lane context 并写入 user/assistant/Tool/compaction entries；`starter.run.v1` 由 S6 Run Service 写入。
- 使用 Pi 的 compaction 判断和实现，不复制 token 估算或摘要状态机。
- compaction 失败时 Run 失败，原 transcript 保留。

## Acceptance Criteria

- [ ] Executor 产生有序 message/tool HarnessEvent 和明确 terminal result；Run Service 集成测试产生唯一 terminal event。
- [ ] 多轮 Tool 调用由 Pi Agent 完成，参数验证、权限、timeout 和取消生效。
- [ ] abort、steer 和 follow-up 由 registry 转发到 Pi 原生控制；Run Service 在终态持久化后清理 registry。
- [ ] 同一 `sessionId + lane` 的第二个 handle 被拒绝。
- [ ] 每轮模型调用和每次 Tool 执行只产生一条审计记录。
- [ ] 新审计只写 `runId`，旧 conversation/generation 字段为空。
- [ ] Pi event 和 Session 内部类型不离开 adapter。
- [ ] 旧 Tool Orchestrator 和 Conversation tests 保持通过。
- [ ] 全仓质量门、测试和构建全部通过。

## Out of Scope

- AgentDefinition CRUD 和权限。
- Session/Run Repository、Hono Route、SSE heartbeat 和资源归属。
- Admin 页面。
- 删除旧 Tool Orchestrator。
