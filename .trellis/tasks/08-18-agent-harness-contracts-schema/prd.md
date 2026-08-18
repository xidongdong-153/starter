# Harness 契约与增量数据库结构

## Goal

在保留旧 Conversation 契约、API 和数据表的前提下，新增 AgentDefinition、AgentSession、AgentRun、transcript 和 HarnessEvent contracts，并通过增量 migration 创建对应业务索引表。

本任务结束时新旧契约与表并存，所有现有调用方继续通过类型检查和测试。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S2，没有代码级前置依赖；实施顺序排在 S1 后。

本任务必须逐字段实现父任务共享契约：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。

原任务失败的主要原因之一是先删除旧 contracts 和旧表，导致尚未改造的 API、Admin 和测试同时失效。本任务改为只增加新协议和 schema，把删除动作留给 S8。

## Requirements

### R1. 公开 contracts

- 在 `packages/contracts/src/ai.ts` 新增 AgentDefinition、AgentSession、AgentRun、transcript 和 HarnessEvent schema 与 DTO。
- Agent 配置使用严格 object，只包含模型引用、Prompt/Skill/Tool 引用、thinking level 和执行限制。
- Session 不绑定单个 Agent，可以保存 nullable `defaultAgentId`。
- Run 显式包含 `agentId`、`agentRevision`、lane、状态和无 secret snapshot。
- HarnessEvent 使用版本、eventId、sequence、sessionId、runId、lane、createdAt、type 和与 type 对应的 data。
- 新增稳定错误码，但保留全部旧 Conversation/generation contracts 和错误码。
- Agent、Session、Run、transcript、Event 和 `starter.run.v1` schema 的字段、限制和 union 分支必须与共享契约一致。
- contracts 不导出 Pi、Drizzle、Hono 或 Node.js 类型。

### R2. 增量主库结构

- 新增 `ai_agent_definitions`、`ai_agent_sessions` 和 `ai_agent_runs`。
- 给 `ai_model_calls` 增加 nullable `run_id` 和索引，同时保留 `conversation_id`、`generation_id` 及其旧外键。
- 用量审计 DTO 增加 nullable `runId`，scenario 增加 `agent_run`，并保留共存阶段的 `model_test | conversation`。
- 不删除或改写旧 Conversation、message、generation、Provider、Prompt、Skill、Tool 和审计数据。
- config snapshot 和 JSON 字段带 `schemaVersion`，Service 入口后续使用 Zod 校验。
- 列、check、索引和外键删除行为逐项使用共享契约中的定义，不留实现期选择项。

### R3. 共存约束

- 旧模型调用继续只写 conversation/generation 关联。
- 新 Run 调用在后续任务中只写 `runId`。
- 本任务不改 Conversation Service、Route、Presenter、Admin API 或页面。
- 增量 migration 可以在含旧数据的数据库上执行，执行后记录数不变。

## Acceptance Criteria

- [ ] 新 schema 对合法 Agent、Session、Run 和所有 HarnessEvent 类型解析成功。
- [ ] 含 secret、未知字段、非法 lane、非法状态和越界执行参数的输入被拒绝。
- [ ] 旧 Conversation contracts 和测试保持可用。
- [ ] migration 后三张新表为空，旧三表和已有记录完整保留。
- [ ] `ai_model_calls` 同时具有旧关联列和 nullable `run_id`。
- [ ] 用量审计 DTO 可以区分 model test、旧 Conversation 和新 Agent Run，且关联字段满足互斥规则。
- [ ] `PRAGMA foreign_key_check` 没有结果。
- [ ] OpenAPI 与 RPC 类型测试可以继续使用旧协议，并能导入新 DTO。
- [ ] 全仓类型、Lint、Format、测试、构建和 `db:check` 全部通过。

## Out of Scope

- AgentDefinition、Session 或 Run Route 和 Service。
- Pi Session adapter 或 Agent executor。
- Admin 页面。
- 旧 contracts、旧列、旧表或旧数据删除。
