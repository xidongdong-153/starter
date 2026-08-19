# Pi Agent 执行规范

## 1. Scope / Trigger

修改 `apps/api/src/infra/agent/`、Pi 原生 stream adapter、Agent Tool adapter、active Run registry 或 Run 用量审计 port 时，按本规范执行。S4 executor 不注册 HTTP Route、不写 `starter.run.v1`；Run Service 负责 registry 生命周期和 terminal event。

## 2. Signatures

内部 executor 使用两段式 port：

```ts
interface AgentExecutorInput {
  runId: string
  sessionId: string
  lane: string
  userId: string
  requestId: string
  input: string
  signal?: AbortSignal
  sequencer: EventSequencer
  config: ResolvedAgentExecutorConfig
}

interface PreparedAgentExecution {
  controls: AttachableActiveRunControls
  events: AsyncIterable<HarnessEvent>
  result: Promise<ExecutorTerminalResult>
  start: () => Promise<void>
}
```

`ResolvedAgentExecutorConfig.model` 使用项目自己的 `AiModelRef`。Pi `Model` 由 executor 的 infra 依赖在内部解析，不能出现在 Run Service 或公开 contracts 的输入中。

S1 Session adapter 的内部写入 port 必须支持调用方指定 message entry ID，并提供 Pi `CompactionEntry` 写入。原生 `StreamFn` 接收 Pi `Model`、`Context` 和 `SimpleStreamOptions`，返回 `AssistantMessageEventStream`。

## 3. Contracts

- Pi `Agent` 负责 prompt、Tool loop、并行/串行执行、steer、follow-up 和 abort；Starter 不复制这些循环。
- `PiEventMapper` 是 Pi `AgentEvent` 到 HarnessEvent 的唯一转换位置。assistant message 在 `message_start` 预生成 entry ID，Tool 在写入 result entry 后发布 `tool.completed`；sequence 只由 caller 提供的 `EventSequencer` 分配。
- 原生 stream adapter 只使用现有 `Models` 的模型、Provider auth、provider env、timeout 和 AbortSignal；失败编码为 Pi `error`/`aborted` event。旧 `AiGatewayEvent` 不能作为 `StreamFn` 输入 Agent。
- `ai_model_calls` 的新记录使用 `scenario='agent_run'`、`run_id=<runId>`。审计 begin/finalize 是 best-effort，不能把 secret、原始错误、prompt 或 response 写入日志或事件。
- Tool 的模型参数来自 `z.toJSONSchema`；`AgentTool.execute` 前仍执行原 Zod schema parse，并合并 Tool timeout、Run deadline 和 AbortSignal。公开事件和 transcript projection 只允许 `safeSummary`，最多 1000 字符。
- compaction 只能调用 Pi 的 `estimateContextTokens`、`shouldCompact`、`prepareCompaction` 和 `compact`；摘要或 entry 写入失败时 Run 失败且原 transcript 保留。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 未 attach 就调用 `start()` | 返回 executor `not_attached` 错误 |
| 重复调用 `start()` 或重复 attach | 返回 executor `already_started` 或 registry 冲突 |
| 同一 `sessionId + lane` 再次 reserve | 返回 active registry `busy`，不创建第二个 handle |
| Session 打开、transcript 读取或 entry 写入失败 | `AI.SESSION_STORAGE_FAILED` |
| Provider 认证失败、上游失败、timeout 或 abort | 原生 stream 返回安全 Pi error；模型审计终态分别为 `auth_failed`、`upstream_failed`、`timed_out`、`cancelled` |
| 模型不在当前 `Models` catalog | `AI.MODEL_NOT_FOUND`，不创建 Provider 请求审计 |
| Tool 未注册、参数无效或权限不足 | Tool result 使用 `not_found`、`invalid_arguments` 或 `forbidden`，继续由 Pi Agent 处理下一轮 |
| Tool timeout 或父 signal abort | Tool 审计 finalize 为 `timed_out` 或 `cancelled`，当前 Run 终止 |
| 审计 begin/finalize 写入失败 | 记录 operation、requestId 和审计 ID；不改变模型或 Tool 的安全结果 |

## 5. Good / Base / Bad Cases

- Good：Run Service 先 reserve/attach，再调用 prepared execution 的 `start()`；Executor 只返回 message/tool event 和 terminal result。
- Good：无效 Tool 参数即使被 Pi JSON Schema 在 `execute` 前拒绝，也在 Tool lifecycle 中创建并 finalize 一条审计，模型只收到固定安全文本。
- Base：没有 compaction 需要时直接使用 `buildSessionContext`；有 compaction 时写 Pi entry 后重建 retained context。
- Bad：把旧 `AiGatewayEvent` 重新拼成自定义 Agent loop，或在 `toolcall_end` 收到时直接调用 handler。
- Bad：把 Pi `details`、Tool arguments、modelText、Provider response 或原始 error 放入 HarnessEvent、公开 DTO、日志或主库审计表。

## 6. Tests Required

- `apps/api/src/test/pi-agent-executor.test.ts`：两段式 start gate、多轮 Tool、sequence、Session failure、pre-abort、模型不存在、compaction、无效参数和 Tool 审计。
- `apps/api/src/test/pi-native-stream.test.ts`：正常 done、认证/上游失败、timeout、abort、模型不存在、审计失败隔离和 first-cause 终态。
- `apps/api/src/test/pi-tool-adapter.test.ts`：Zod parse、permission、timeout、取消、安全 result 和一次性审计。
- `apps/api/src/test/active-run-registry.test.ts`：lane 冲突、runId/lane 双索引、controls 转发和幂等 release。
- `apps/api/src/test/pi-session-store.test.ts`：预置 message ID、compaction entry 与旧 transcript 回放兼容。
- 提交前依次运行 `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build` 和 `git diff --check`。

## 7. Wrong vs Correct

错误写法把项目自己的事件流当作 Pi `StreamFn`，并在模型发出完整 Tool call 时绕过 Agent 直接调用 handler：

```ts
const streamFn = async function* (input: AiGatewayInput) {
  yield* gateway.stream(input)
}
if (event.type === "tool_call_completed") await handler(event.arguments)
```

正确写法让原生 adapter 返回 `AssistantMessageEventStream`，把 Zod parse、权限、timeout 和取消放入 `AgentTool.execute`，由 Pi Agent 产生 Tool result 和后续模型轮次：

```ts
const streamFn = createPiNativeStreamFn({
  models,
  audit,
  runId,
  userId,
  requestId,
  timeoutMs,
})
const tool = createPiToolAdapter(
  [registeredTool],
  { userId, requestId, hasPermission, audit },
).tools[0]
const agent = new Agent({
  initialState: { model, tools: tool ? [tool] : [] },
  streamFn,
})
```
