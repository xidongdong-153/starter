# Pi 原生 Agent 适配核对

## 结论

S4 使用 `@earendil-works/pi-agent-core` 的 `Agent` 和 `AgentTool`，不实例化未完成的 `AgentHarness`。

`Agent` 的 `AgentOptions.streamFn` 必须返回 Pi `AssistantMessageEventStream`。当前 `apps/api/src/infra/ai/ai-gateway.ts` 的 `AiGateway.stream` 返回项目自己的 `AiGatewayEvent`，其中只有文本增量、完整 Tool call 和 completed，不能直接作为 Pi `streamFn`。因此 S4 需要在 `infra/ai` 或 `infra/agent` 增加原生 Pi stream adapter：

- Provider、模型白名单、credential、provider env、timeout 和 abort 继续由现有 `Models`/Gateway 负责。
- Adapter 返回 Pi 原生 `start`、增量、Tool call、done/error 事件，让 Agent 自己运行多轮 Tool loop。
- Conversation 继续使用现有 `AiGateway.stream` 和 `AiInvocationRunner`；新 executor 不调用旧 `tool-orchestrator`。
- 新 adapter 的每次原生模型请求通过 S4 的审计 port begin/finalize；Provider secret、原始错误和完整 payload 不进入事件或日志。

依据：

- `/Users/wuwanzhu/Code/pi/packages/agent/src/agent.ts` 的 `AgentOptions`、`prompt`、`steer`、`followUp` 和 `abort`。
- `/Users/wuwanzhu/Code/pi/packages/agent/src/types.ts` 的 `StreamFn`、`AgentTool` 和 `AgentEvent`。
- `/Users/wuwanzhu/Code/pi/packages/ai/src/utils/event-stream.ts` 的 `AssistantMessageEventStream`。
- `apps/api/src/infra/ai/ai-gateway.ts` 的现有 Provider auth、stream、timeout 和错误分类。

## Session entry 边界

共享 Harness 契约要求 `message.started` 的 `messageId` 等于最终 Pi message entry id，`tool.completed.entryId` 等于 Tool result entry id。Pi `SessionTree.appendMessage` 默认在写入时生成 entry id，当前 S1 adapter 也没有 compaction 写入口。

S4 需要对 S1 adapter 增加内部能力：

- `appendMessage` 接受可选的调用方 entry id，使 executor 可以先发 started/delta，再用同一个 id 写最终 message entry。
- 增加 append Pi `CompactionEntry` 的方法，字段使用 Pi 的 `summary`、`tokensBefore`、`retainedTail`、`usage` 和 `details`。
- 保持业务层只能使用 `AgentSessionStore` port，不把 Pi Session 对象或 entry 类型带到 contracts、route 或公开 DTO。

## Context 与 compaction

S4 读取 S1 的 lane branch entries，使用 Pi `buildSessionContext` 生成 Agent messages。每次 Provider 请求前用 Pi `estimateContextTokens`、`shouldCompact`、`prepareCompaction` 和 `compact` 判断并执行 compaction；不复制 token 估算、cut point 或摘要状态机。成功生成并写入 compaction entry 后，下一次请求从 Pi 的 compaction context 继续；摘要生成或 entry 写入失败时 Run 失败，原有 transcript 不删除。

## Tool adapter

现有 `RegisteredAiTool` 的 Zod schema 通过 `z.toJSONSchema` 生成 Pi `AgentTool.parameters`。Pi 的 TypeBox 校验只负责模型可见 JSON schema；`AgentTool.execute` 内再次调用原 Zod schema parse，然后执行权限检查、timeout 和合并后的 AbortSignal。工具结果只把 `modelText` 放入 Pi Tool result content，把 `safeSummary` 放入受控 details，实时事件和 Session projection 不包含 arguments 或模型结果。
