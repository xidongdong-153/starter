# AI Harness 运行时可观测性修复

## Goal

让前端在 Agent Run 执行期间能看清正在发生什么：刷新页面后能恢复正在生成的内容，能看到轮次边界和 compaction，能拿到 token 成本，能知道哪次回答触发了哪些工具。同时移除 Agent Run 单轮 2048 输出上限这个遗留调试值。

本任务只做已确认可快速落地的部分。thinking 上公开协议、工具结构化 details 两项不在范围内。

## Background

当前 API 的展示能力不足，缺口不在数据，在投影层。绝大部分数据已经持久化在 Pi Session SQLite 里，只是没有进公开协议。

### 当前实现的事实

事件契约：`packages/contracts/src/ai.ts:619-738` 定义 10 种 `HarnessEvent`。transcript item 只有 4 种（`user_message` / `assistant_message` / `tool_activity` / `system`），定义在同文件 `477-510`。

事件只存在进程内。`apps/api/src/modules/ai/run/run.service.ts:29` 的 `MAX_PENDING_EVENTS = 1024` 是有界队列上限，`AsyncEventQueue` 定义在 `apps/api/src/infra/agent/pi-event-mapper.ts:245-310`。设计文档 `.trellis/spec/api/backend/ai-system-design.md` 第 5 节明确把 `HarnessEvent` 归为「进程内有界事件队列」，不持久化。

assistant message 要等 `message_end` 才写入 Pi DB，见 `pi-event-mapper.ts:163-186` 的 `mapMessageEnd`。所以生成过程中的部分内容既不在事件队列的历史里，也不在 transcript 里。

`ActiveRunRegistry`（`apps/api/src/infra/agent/active-run-registry.ts`）的 `ActiveRunHandle` 只有 `runId` / `sessionId` / `lane` / `controls`，不持有任何运行时状态。

`GET /api/ai/sessions/{sessionId}/runs/{runId}` 返回 `agentRunSchema`，只有 status、finalEntryId、errorCode、snapshot 和时间戳，没有运行时进度。

### 已确认的缺陷清单

| 编号 | 问题 | 位置 | 影响 |
| --- | --- | --- | --- |
| D1 | 活跃 Run 无快照接口 | `run.service.ts`、`run.openapi.ts` | 刷新页面后正在生成的回答完全消失，直到 Run 结束 |
| D2 | Agent Run 单轮输出被 clamp 到 2048 tokens | `apps/api/src/infra/ai/pi-native-stream.ts:210` | 稍长回答就 `stopReason: 'length'` 被截断 |
| D3 | `tool.progress` 事件永远不会触发 | `apps/api/src/infra/agent/pi-tool-adapter.ts` | 契约、mapper、admin reducer 三处死代码 |
| D4 | `turn_start` / `turn_end` 被丢弃 | `pi-event-mapper.ts:115-120` | 多轮工具调用时前端看不出轮次边界 |
| D5 | compaction 完全静默 | `apps/api/src/infra/agent/agent-executor.ts:505-560` | 用户只看到卡顿，不知道发生了上下文压缩 |
| D6 | usage / cost 未投影 | `session.presenter.ts`、`ai.ts` 事件定义 | 无法做 token 和成本展示 |
| D7 | compaction 的 `tokensBefore` 未投影 | `session.presenter.ts:78-90` | system item 只有 summary |
| D8 | assistant 与 toolCall 的关联丢失 | `session.presenter.ts:216-224` | transcript 里 assistant message 和 tool_activity 是孤立 item |

D2 的补充事实：这个 clamp 在两处。`apps/api/src/infra/ai/ai-gateway.ts:94` 服务 `POST /api/ai/test`（一次性模型测试，2048 合理，本任务不动）；`pi-native-stream.ts:210` 服务 Agent Run，这里才是缺陷。两处都来自最初的 `b8eba89 feat: add ai configuration foundation`，spec 里没有任何地方把它记为成本约束，因此判定为遗留调试值。

D3 的补充事实：`harnessToolProgressEventSchema` 定义在 `ai.ts:673-682`，`pi-event-mapper.ts:96-104` 有映射，admin 的 `withToolProgress` 在 `apps/admin/src/features/ai/harness/stream-reducer.ts` 里也写了。但 `RegisteredAiTool.execute(context, input)` 的签名（`apps/api/src/modules/ai/tool/tool-registry.ts`）没有进度回调通道，`pi-tool-adapter.ts` 的 `execute` 拿到 pi 传入的第四个参数 `onUpdate` 后没有往下传给业务工具。

D6 的补充事实：数据是现成的。`pi-ai` 的 `AssistantMessage.usage` 是必填字段（`packages/ai/src/types.ts:436`），`apps/api/src/infra/ai/pi-native-stream.ts` 的 `sanitizeAssistantMessage` 保留了 `usage: message.usage`。

D8 的补充事实：`assistantContentToString` 只 filter `type === "text"`，把 `toolCall` block 全部丢掉。加 `toolCalls: [{ toolCallId, name }]` 只暴露调用标识，不涉及入参脱敏。

### 明确不做的两件事及原因

不迁移 Pi 的 `AgentHarness`。本地 `~/Code/pi` 的 `packages/agent/src/harness/agent-harness.ts` 共 508 行，其中 28 处抛 `HarnessNotImplemented`；`hooks` 和 `events` 被赋值为 `UnavailableRegistry`，调用即抛错；`create()` 拒绝任何已有 record 的 session。测试文件名为 `agent-harness-scaffold.test.ts`，describe 块写的是 `AgentHarness v2 scaffold`。Pi 自己的 `coding-agent`（`packages/coding-agent/src/core/agent-session.ts`）用的是低层 `Agent`，和本项目 `agent-executor.ts` 相同。本地 pi 版本 0.84.2，项目依赖 0.84.1。

不做事件持久化。D1 用活跃 Run 快照解决，成本远低于持久化事件流，且不需要推翻现有设计约束。

## Key Decisions

**KD1：活跃 Run 快照的数据来源用「Run Service 内累积」。**

在 `run.service.ts` 的 `RunContext` 上挂一个快照对象，push 事件的同时用与 `apps/admin/src/features/ai/harness/stream-reducer.ts` 同构的折叠规则累积。改动集中在 `run.service.ts`，不碰 executor 和 registry。

选它的理由：`stream-reducer.ts` 的折叠逻辑已有测试覆盖（`apps/admin/src/test/harness-stream-reducer.test.ts`），后端复用同一套规则能保证快照与流式视图一致；Run Service 本来就是设计文档里定义的「对外事件唯一所有者」，累积对外快照落在它既有职责内，不需要修改任何边界约束。

被否决的方案：给 `PiEventMapper` 加 getter 并由 registry handle 转发。它要同时改 `pi-event-mapper.ts`、`agent-executor.ts`、`active-run-registry.ts` 三处，且让 executor 承担对外展示职责，与 `ai-system-design.md` 第 3.4 节「Executor 不发布 Run terminal event」的边界冲突，需要连带改设计文档。

**KD2：D2 直接移除 clamp，改用 `model.maxTokens`。**

成本由既有的 `maxTurns`（`agentDefinitionConfigSchema` 里限定 1-32，见 `ai.ts:310-320`）兜住，零契约改动。不新增 Agent 级 maxTokens 配置字段。

## Requirements

### R1 活跃 Run 运行时快照（对应 D1）

- `packages/contracts/src/ai.ts` 新增活跃 Run 快照 schema，字段至少包含：当前进行中的 assistant 部分文本、已完成的 assistant message 列表、tool 调用列表及状态、已见最大 sequence、当前轮次、model 引用。
- `run.service.ts` 在事件 push 路径上累积该快照，折叠规则与 `stream-reducer.ts` 一致。
- `GET /api/ai/sessions/{sessionId}/runs/{runId}` 的响应带上该快照；Run 已进入终态时快照为 null（终态数据从 transcript 读）。
- 归属校验沿用 `requireOwnedRun`，他人 Run 仍返回 404。

### R2 移除 Agent Run 输出上限（对应 D2）

- `pi-native-stream.ts:210` 改为 `maxTokens: model.maxTokens`。
- `ai-gateway.ts:94` 保持不变。

### R3 打通工具进度通道（对应 D3）

- `AiToolExecutionContext`（`tool-registry.ts`）新增可选进度回调。
- `pi-tool-adapter.ts` 把 pi 的 `onUpdate` 接到该回调，让 `tool.progress` 能真实触发。
- 至少一个测试工具（`apps/api/src/modules/ai/tool/test-tools.ts`）产出进度，用于验证链路。`slow_tool` 是自然选择。

### R4 轮次事件（对应 D4）

- 新增 `turn.started` 和 `turn.completed` 两个 `HarnessEvent`，携带轮次序号和 `maxTurns`。
- `pi-event-mapper.ts` 映射 pi 的 `turn_start` / `turn_end`，不再返回空数组。

### R5 compaction 事件（对应 D5）

- 新增 `context.compacted` 事件，携带 `tokensBefore` 和 summary。
- `agent-executor.ts` 的 `compactIfNeeded` 成功写入 compaction entry 后发布该事件。

### R6 usage 投影（对应 D6）

- `message.completed` 事件带上该次 assistant message 的 usage。
- transcript 的 `assistant_message` item 带上 usage。
- 两处都用 `aiUsageSchema`（`ai.ts` 已定义）；字段为 optional，向后兼容。

### R7 compaction tokensBefore 投影（对应 D7）

- transcript 的 `system` item 补 `tokensBefore` 字段。

### R8 assistant 与 toolCall 关联（对应 D8）

- transcript 的 `assistant_message` item 新增 `toolCalls: Array<{ toolCallId, name }>`。
- 只暴露调用标识，不暴露 arguments。

### R9 兼容性约束（横切）

- 所有 contracts 改动只能新增事件类型或新增 optional 字段，不删除、不改现有字段类型。
- `content: string` 保持不变，不改成 blocks 结构。
- 不引入 secret 到事件、快照或 transcript。

## Acceptance Criteria

- [x] AC1 Run 执行中调用 `GET /runs/{runId}`，响应含非 null 快照，快照里的部分 assistant 文本与同一时刻 SSE 已推送的 delta 累积结果一致。
- [x] AC2 Run 进入终态后调用同一端点，快照为 null，且 status 为终态值。
- [x] AC3 他人 Run 调用该端点仍返回 404，不泄露存在性。
- [x] AC4 `pi-native-stream.ts` 中 Agent Run 路径的 `maxTokens` 等于 `model.maxTokens`；`ai-gateway.ts` 的 2048 clamp 未被改动。
- [x] AC5 调用会产出进度的测试工具时，SSE 流中出现至少一个 `tool.progress` 事件，且 `safeSummary` 非 null。
- [x] AC6 多轮工具调用的 Run，SSE 流中 `turn.started` / `turn.completed` 成对出现，轮次序号从 1 递增。
- [x] AC7 触发 compaction 的 Run，SSE 流中出现 `context.compacted` 事件，`tokensBefore` 为正整数。
- [x] AC8 `message.completed` 事件和 transcript 的 `assistant_message` 都能读到 usage 字段。
- [x] AC9 transcript 的 `system` item 含 `tokensBefore`。
- [x] AC10 触发工具调用的 assistant message，其 transcript item 的 `toolCalls` 数组非空，且 `toolCallId` 与对应 `tool_activity` item 的 `toolCallId` 一致。
- [x] AC11 所有新增事件通过 `harnessEventSchema` 校验，sequence 在同一 Run 内单调递增，terminal event 仍只发布一次。
- [x] AC12 `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test` 全部通过。
- [x] AC13 既有测试不因本次改动失败，特别是 `apps/api/src/test/ai-agent-runs.test.ts` 中断言 SSE 事件序列的用例（该文件 245 行起的用例断言了精确的事件类型数组和 sequence 数组，新增事件会影响它，需同步更新预期）。

## 完成情况

9 项需求已全部实现，13 条验收标准全部通过。

验证命令与结果：

```
pnpm check-types   9 successful
pnpm lint          6 successful
pnpm format:check  6 successful
pnpm test          api 235 passed / admin 107 passed
pnpm build         5 successful
db:check           Everything's fine
git diff --check   OK
```

改动文件：

| 文件 | 内容 |
| --- | --- |
| `packages/contracts/src/ai.ts` | 新增 3 个事件 + `agentRunLiveSnapshotSchema`；`aiUsageSchema` / `aiCostSchema` 上移避 TDZ；4 处 optional 字段 |
| `apps/api/src/modules/ai/run/run.live-snapshot.ts` | 新文件，快照折叠器 |
| `apps/api/src/modules/ai/run/run.service.ts` | `publish` 统一事件出口 + 快照生命周期 |
| `apps/api/src/modules/ai/run/run.presenter.ts` | `toAgentRun` 接 live 参数 |
| `apps/api/src/infra/agent/pi-event-mapper.ts` | turn 事件 + `contextCompactedEvent` + usage |
| `apps/api/src/infra/agent/agent-executor.ts` | 传 `maxTurns` + `onCompacted` 回调 |
| `apps/api/src/infra/agent/pi-tool-adapter.ts` | 接通 Pi 的 `onUpdate`；工具超时不再终止 Run（R10） |
| `apps/api/src/modules/ai/tool/tool-registry.ts` | `reportProgress` 可选回调 |
| `apps/api/src/modules/ai/tool/test-tools.ts` | `slow_tool` 每秒上报进度 |
| `apps/api/src/infra/ai/pi-native-stream.ts` | 移除 2048 clamp |
| 4 份 spec | 同步事件表、快照说明、进度通道、测试清单 |

实现中修正的两处计划偏差：

1. **快照判据换成 Run row 状态**。design.md 原计划用 `registry.get(runId)` 判断。但 `finalizeRun` 先 `repository.updateTerminal`、后 `release(registry)`，两步之间存在窗口，按 handle 判断会返回「终态 status + 非空 live」，被 `agentRunSchema` 的 superRefine 拒绝。改成读 `record.status`。
2. **`tool.progress` 选择接通**。R3 已写明接通，implement.md 的完成前确认段落误写成「仍是死事件」。以 prd.md 为准。

### R10 工具超时不再护断 Run（验收阶段追加）

接通 `tool.progress` 后在 admin 里验证时发现的既有缺陷，不由本次改动引入。

`slow_tool` 超时后 Agent 直接停在错误框上，没有任何后续回复。根因在 `pi-tool-adapter.ts`：`toolResultDetails` 把 `timed_out` 和 `cancelled` 一起设 `terminate: true`，`failWithoutAudit` 又对这两个 status 无条件调 `onTerminalFailure`，`agent-executor.ts` 收到后立刻 `agent.abort()`。结果是模型根本没机会看到工具失败。

行为对照 `fail_tool`（`terminate: false`）：模型能拿到 `The tool failed.` 并继续回复。工具超时属于同一类可恢复失败，应该走同一条路。

改动（`apps/api/src/infra/agent/pi-tool-adapter.ts`）：

- `toolResultDetails` 的 `terminate` 判据收窄为 `status === "cancelled"`。
- `failWithoutAudit` 只在 `terminate` 为 true 时调 `onTerminalFailure`。
- 工具自身超时的 `modelText` 从 `The tool timed out.` 改成 `The tool timed out after ${timeoutMs}ms.`，模型才知道重试要换参数。
- Run 总时长耗尽仍 `terminate: true`，`modelText` 区分成 `The run ran out of time before the tool could start.`。

验收：Run 终态为 `completed`、`errorCode` 为 `null`；超时事实保留在 `tool.completed` 事件、transcript 的 toolResult 和 `ai_tool_executions` 审计里。相关 spec 已同步（`pi-agent-execution-guidelines.md` 第 3/4/6 节、`ai-system-design.md` 第 4.3/9 节）。

## Out of Scope

- thinking 内容上公开协议。它需要改 `ai-system-design.md` 第 4.2 节的约束、把 transcript 的 `content: string` 换成 blocks 结构、给 `AgentDefinition` 加 `exposeThinking` 开关（`agentDefinitionConfigSchema` 是 `strictObject` + `schemaVersion: 1`，加字段要处理已存库 config 的反序列化）。单独评估。
- 工具结构化 details。需要给 `defineAiTool` 加 `detailsSchema` 并定义脱敏边界。单独评估。
- 迁移 Pi 的 `AgentHarness`。理由见 Background。
- 事件持久化。
- `AsyncEventQueue` 的单消费者限制。当前被 `AI.SESSION_BUSY` 掩盖，本任务的快照方案不依赖多订阅，不在此处改。
- Admin 前端消费新字段的 UI 实现。本任务只保证 API 侧提供数据，前端展示单独排。
