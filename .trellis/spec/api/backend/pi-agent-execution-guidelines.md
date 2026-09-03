# Pi Agent 执行规范

## 1. Scope / Trigger

修改 `apps/api/src/infra/agent/`、Pi 原生 stream adapter、Agent Tool adapter、active Run registry 或 Run 用量审计 port 时，按本规范执行。S4 executor 不注册 HTTP Route、不写 `starter.run`；Run Service 负责 registry 生命周期和 terminal event。

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
  execution: RunExecutionContext
  config: ResolvedAgentExecutorConfig
}

interface PreparedAgentExecution {
  controls: AttachableActiveRunControls
  events: AsyncIterable<RunEventDraft>
  result: Promise<ExecutorTerminalResult>
  start: () => Promise<void>
}
```

`ResolvedAgentExecutorConfig.model` 使用项目自己的 `AiModelRef`。Pi `Model` 由 executor 的 infra 依赖在内部解析，不能出现在 Run Service 或公开 contracts 的输入中。

S1 Session adapter 的内部写入 port 必须支持调用方指定 message entry ID，并提供 Pi `CompactionEntry` 写入。原生 `StreamFn` 接收 Pi `Model`、`Context` 和 `SimpleStreamOptions`，返回 `AssistantMessageEventStream`。

## 3. Contracts

- Pi `Agent` 负责 prompt、Tool loop、并行/串行执行、steer、follow-up 和 abort；Starter 不复制这些循环。
- 每次 executor 启动（含 auto retry 的 Attempt 2+）创建一条 `kind='agent'` 顶层 Step（`turn_id` NULL、`attempt_no` 为当前尝试号），在 finally 收尾自身终态，终态事务内按最终 status 强制改写（fenced→interrupted、存储重写）；agent Step 只走 lifecycle begin/complete，不发布公开 `step.*` 事件，也不开 telemetry span。turn 序号跨 attempt 连续（不重置 turnIndex），attempt 归属由 `attempt_no` 列表达。`ai_run_steps.attempt` 与 `attempt_no` 双列同值（前者是事件/公开面字段，后者是 DB 关联列）。
- Tool 幂等 token 在 adapter 创建审计行时生成：`sha256Hex(canonicalJson({ runId, attemptNo, toolExecutionId }))`，lifecycle 阶段与 execute 阶段两处计算输入一致；token 经 `AiToolExecutionContext.idempotencyToken` 传给 handler，由 handler 或下游做幂等去重，平台不维护 token→结果映射。
- 超时 modelText 按 Tool 副作用分类：`non_idempotent_write` 声明「操作可能已在外部执行，结果未知」；`read_only` / `idempotent_write` 维持现有带 timeout 毫秒数的措辞。Tool 定义必填 `sideEffect`（`read_only` / `idempotent_write` / `non_idempotent_write`，类型与运行时双重强制，无默认值），进 `AiToolSummary`、resolved manifest tools 与 manifestHash 输入。
- auto retry 重建 executor 时用 `registry.replace(runId, controls)` 只替换控制面，不动 lease；旧 controls 引用由闭包变量与 `registry.get` 同步指向新实例，prepare→replace 同步执行无异步交错窗口。已知边界：attempt 重建后 prepare 抛错时，新 attempt 行以原上游错误码收尾而非重建失败原因（终态一致、无悬挂）；structured output 跨 attempt 可能产生两行记录（stepId 不同，只增事实语义）；`read_skill` 执行期仍读主表当前内容而非 pinned revision（后续阶段处理）。
- `PiEventMapper` 是 Pi `AgentEvent` 到内部 `RunEventDraft` 的唯一转换位置。assistant message 在 `message_start` 预生成 entry ID，Tool 在写入 result entry 后发布 `tool.completed`；sequence 由 `RunEventPublisher` 在持久化时分配。
- 原生 stream adapter 只使用现有 `Models` 的模型、Provider auth、provider env、timeout 和 AbortSignal；失败编码为 Pi `error`/`aborted` event。旧 `AiGatewayEvent` 不能作为 `StreamFn` 输入 Agent。
- `ai_model_calls` 的新记录使用 `scenario='agent_run'`、`run_id=<runId>`。审计 begin/finalize 是 best-effort，不能把 secret、原始错误、prompt 或 response 写入日志或事件。
- Tool 的模型参数来自 `z.toJSONSchema`；`AgentTool.execute` 前仍执行原 Zod schema parse，并合并 Tool timeout、Run deadline 和 AbortSignal。公开事件和 transcript projection 只允许 `safeSummary`，最多 1000 字符。
- 工具失败不等于 Run 失败。只有用户取消和 Run 总时长耗尽会设 `terminate: true` 并调 `onTerminalFailure`；工具自身超时、抛错、参数无效、未注册和权限不足一律 `terminate: false`，把失败原因作为 tool result 交回模型，让它自己决定下一步。超时的 `modelText` 带上实际 timeout 毫秒数，模型才知道重试时要换参数。
- Tool 进度通道：`AiToolExecutionContext.reportProgress(safeSummary)` 由 adapter 注入，内部转成 Pi 的 `onUpdate`，`PiEventMapper` 再把 `tool_execution_update` 映射成 `tool.progress`。上报内容只能是脱敏摘要，`modelText` 留空，空字符串忽略，不产生额外审计。`reportProgress` 是可选字段，工具内部用 `?.` 调用，单元测试可以不提供。
- 轮次与 compaction 可观测：`PiEventMapper` 把 Pi 的 `turn_start` / `turn_end` 映射成 `turn.started` / `turn.completed`（带 `maxTurns`，从 `PiEventMapperOptions` 传入）；`compactIfNeeded` 写入 entry 成功后通过 `onCompacted` 回调发 `context.compacted`，事件由 `PiEventMapper.contextCompactedEvent()` 构造并交给 RunEventPublisher。回调必须包 try/catch，发事件失败不能影响已写入的 compaction 结果。
- 思考内容有公开出口：`mapMessageUpdate` 除了 `text_delta` 还要映射 `thinking_start` / `thinking_delta` / `thinking_end`，`blockIndex` 用 pi-ai 的 `contentIndex`。`assistantText` 和 `message.completed.content` 仍然只拼 text block，不把思考正文混进正文字段。
- 撞到 `maxTurns` 要给模型一次收尾机会：Pi 的回调顺序是 `turn_end` → `prepareNextTurn` → `shouldStopAfterTurn`，所以清空工具只能在 `prepareNextTurnWithContext` 里做，停或不停由 `shouldStopAfterTurn` 决定。撞顶那一轮如果还有 toolCall，就返回 `tools: []` 的 context 并追加一条只进内存的收尾提示，再放一轮。`maxTurns` 语义是「最多 N 轮工具轮 + 1 轮收尾」，`ExecutorTerminalResult.completionReason` 只在 completed 时有值。
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
| Tool timeout | Tool 审计 finalize 为 `timed_out`，`terminate: false`，tool result 交回模型继续下一轮 |
| 父 signal abort 或 Run deadline 耗尽 | Tool 审计 finalize 为 `cancelled` 或 `timed_out`，`terminate: true`，当前 Run 终止 |
| 撞到 `maxTurns` 且当轮 assistant message 还带 toolCall | 追加一轮 `tools: []` 的收尾轮，`completionReason` 为 `max_turns` |
| 撞到 `maxTurns` 但当轮已经给出文字回答 | 不追加收尾轮，`completionReason` 为 `model_finished` |
| 审计 begin/finalize 写入失败 | 记录 operation、requestId 和审计 ID；不改变模型或 Tool 的安全结果 |

## 5. Good / Base / Bad Cases

- Good：Run Service 先 reserve/attach，再调用 prepared execution 的 `start()`；Executor 只返回 message/tool event 和 terminal result。
- Good：无效 Tool 参数即使被 Pi JSON Schema 在 `execute` 前拒绝，也在 Tool lifecycle 中创建并 finalize 一条审计，模型只收到固定安全文本。
- Base：没有 compaction 需要时直接使用 `buildSessionContext`；有 compaction 时写 Pi entry 后重建 retained context。
- Bad：把旧 `AiGatewayEvent` 重新拼成自定义 Agent loop，或在 `toolcall_end` 收到时直接调用 handler。
- Bad：把 Pi `details`、Tool arguments、modelText、Provider response 或原始 error 放入 RunEvent、公开 DTO、日志或主库审计表。

## 6. Tests Required

- `apps/api/src/test/pi-agent-executor.test.ts`：两段式 start gate、多轮 Tool、sequence、Session failure、pre-abort、模型不存在、compaction（含 `context.compacted` 事件的 entryId 与 tokensBefore）、轮次事件成对、`tool.progress` 只带脱敏摘要、工具超时后模型继续回复且 Run 为 completed、无效参数和 Tool 审计。另外要盖：thinking 事件按流顺序发布且 messageId / blockIndex 一致；`maxTurns` 撞顶时收尾轮拿到的 tools 为空、`completionReason` 为 `max_turns`、收尾提示只出现在模型 context 里而不在 Pi transcript；撞顶那一轮已给文字时不追加收尾轮。
- `apps/api/src/test/pi-native-stream.test.ts`：正常 done、认证/上游失败、timeout、abort、模型不存在、审计失败隔离和 first-cause 终态。
- `apps/api/src/test/pi-tool-adapter.test.ts`：Zod parse、permission、timeout、取消、安全 result、一次性审计，`reportProgress` 经 `onUpdate` 上报且空摘要被忽略，以及工具超时 `terminate: false` 不调 `onTerminalFailure`、用户取消 `terminate: true` 仍终止 Run。
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
  { principal, scope, requestId, hasPermission, audit },
).tools[0]
const agent = new Agent({
  initialState: { model, tools: tool ? [tool] : [] },
  streamFn,
})
```
