# 执行计划

按 S1 -> S6 顺序做。每个 S 是一个独立可验证单元，做完就能跑验证命令，中途停下来仓库仍可用。

S1 和 S2 互不依赖，可以任意顺序。S3 依赖 S2（要复用同一个 reducer）。S4、S5 只依赖 contracts，和 S3 无关。

## S1 移除 Agent Run 单轮输出上限

改 1 处：

- `apps/api/src/infra/ai/pi-native-stream.ts:210`：`maxTokens: Math.min(model.maxTokens, 2048)` 改成 `maxTokens: model.maxTokens`。

不要改 `apps/api/src/infra/ai/ai-gateway.ts:94`。那一处服务 `POST /api/ai/test`，2048 对一次性模型测试是合理的。

三个测试的 model fixture 都是 `maxTokens: 1024`（`pi-native-stream.test.ts:24`、`pi-agent-executor.test.ts:40`、`ai-agent-runs.test.ts:58`），没有任何测试断言 2048，所以这一步对现有测试是中性的。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/pi-native-stream.test.ts --config vitest.config.ts
```

## S2 新增三个事件类型（contracts）

改 `packages/contracts/src/ai.ts`。

在 `harnessToolCompletedEventSchema` 之后、`harnessRunCompletedEventSchema` 之前加三个 schema，然后把它们加进 `harnessEventSchema` 的 `discriminatedUnion` 数组。

```ts
export const harnessTurnStartedEventSchema = z.strictObject({
  ...harnessEventEnvelopeShape,
  type: z.literal('turn.started'),
  data: z.strictObject({
    turn: z.number().int().min(1),
    maxTurns: z.number().int().min(1).max(32),
  }),
})

export const harnessTurnCompletedEventSchema = z.strictObject({
  ...harnessEventEnvelopeShape,
  type: z.literal('turn.completed'),
  data: z.strictObject({
    turn: z.number().int().min(1),
    maxTurns: z.number().int().min(1).max(32),
  }),
})

export const harnessContextCompactedEventSchema = z.strictObject({
  ...harnessEventEnvelopeShape,
  type: z.literal('context.compacted'),
  data: z.strictObject({
    entryId: uuidSchema,
    tokensBefore: z.number().int().min(0),
    summary: z.string(),
  }),
})
```

`maxTurns` 的 `.max(32)` 要和 `agentDefinitionConfigSchema.maxTurns`（`ai.ts:317`）保持一致。

同步改 `apps/api/src/test/ai-harness-contracts.test.ts` 的「解析所有 HarnessEvent 分支」用例（约 268 行起），往 `events` 数组补三个新分支。这个用例是全枚举的，不补会漏覆盖。

admin 侧此步不用改：`apps/admin/src/api/ai/harness.api.ts:107` 用 `harnessEventSchema.safeParse` 且失败静默丢弃，旧 reducer 收到不认识的事件只会忽略。

验证：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/api exec vitest run src/test/ai-harness-contracts.test.ts --config vitest.config.ts
```

## S3 发出三个事件 + 累积活跃快照

这一步最大，分两半做。

### S3a 发 turn 与 compaction 事件

`apps/api/src/infra/agent/pi-event-mapper.ts`：

- `map()` 的 switch 里，`turn_start` / `turn_end` 当前和 `agent_start` / `agent_end` 合并成一个 `return []`（约 118-123 行）。把 turn 两个 case 拆出来，各返回一个事件。
- mapper 要知道当前轮次。加一个自增计数器：`turn_start` 时 +1 并读取，`turn_end` 时读当前值。`maxTurns` 从 `PiEventMapperOptions` 新增字段传入。
- `agent_start` / `agent_end` 继续 `return []`，不要动。

`apps/api/src/infra/agent/agent-executor.ts`：

- 构造 `PiEventMapper` 时（约 300 行）补 `maxTurns: config.maxTurns`。
- `compactIfNeeded()`（约 505 行起）成功写入 compaction entry 后要发事件。它当前在 `transformContext` 回调里、拿不到 mapper 的 `event()`。最简做法：给 `compactIfNeeded` 的 input 加一个 `onCompacted: (entry, tokensBefore) => void` 回调，在 `agent` 构造处传入一个闭包，闭包内 push 一个 `context.compacted` 到 `events` 队列，sequence 用 `input.sequencer.next()`。

注意 sequence 单调性：executor 的 `events` 队列和 mapper 共用 `input.sequencer`，所以从闭包里取 sequence 是安全的。不要新建 sequencer。

### S3b 累积并返回活跃快照

`packages/contracts/src/ai.ts` 加 `agentRunLiveSnapshotSchema`，字段见 design.md 第 3 节。

`apps/api/src/modules/ai/run/run.service.ts`：

- `RunContext` 加一个 `live` 字段承载快照状态。
- 事件进入 `events` 队列的地方统一走一个 `publish(context, event)`：先累积到 `context.live`，再 `events.push(event)`。当前 push 点有四处（`run.started`、`pumpExecutorEvents` 里的转发、`finalizeRun` 的存储失败分支、`terminalEvent`），都要改成走 `publish`。
- 折叠规则和 `apps/admin/src/features/ai/harness/stream-reducer.ts` 保持同构：`message.delta` 累加文本、`tool.started` 置 running、`tool.completed` 写终态、terminal 只认第一个。
- `get()` 返回值加 `live`：`registry.get(runId)` 有 handle 时返回累积的快照，无 handle（终态）时返回 `null`。

`apps/api/src/modules/ai/run/run.presenter.ts`：`toAgentRun` 加第二个可选参数接 live 快照。

`apps/api/src/modules/ai/run/run.openapi.ts`：`getAgentRunRoute` 的 200 response schema 换成带 `live` 的版本。`abort` / `steer` / `follow-up` 三个路由复用原 `runResponse`，不要动。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-agent-runs.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/pi-agent-executor.test.ts --config vitest.config.ts
```

新增测试放 `ai-agent-runs.test.ts`，覆盖 design.md 第 6 节列的四条。用现有 `createTestApp({}, { agentSessionStore, piAgentExecutor })` 注入 fake executor 的方式，不要连真实模型。

## S4 投影 usage 与 toolCalls（transcript）

`packages/contracts/src/ai.ts`：`agentTranscriptAssistantMessageSchema` 加两个字段。

```ts
usage: aiUsageSchema.nullable(),
toolCalls: z.array(z.strictObject({
  toolCallId: z.string().min(1).max(240),
  name: z.string().min(1).max(240),
})).max(64),
```

`aiUsageSchema` 定义在 `packages/contracts/src/ai.ts:779`，位置在两个引用点之后：`agentTranscriptAssistantMessageSchema` 在 483 行，`harnessMessageCompletedEventSchema` 在 651 行。Zod schema 在模块加载时立即求值，直接引用会抛 `Cannot access 'aiUsageSchema' before initialization`。

先把 `aiUsageSchema`（连同它依赖的 `aiCostSchema`，如果也要用）整块移到 `agentTranscriptItemBaseShape` 之前，再改这两处。移动时只剪切粘贴，不改内容，避免混进语义改动。

`apps/api/src/modules/ai/session/session.presenter.ts`：

- `assistantContentToString` 保持原样（`content` 字段语义不变）。
- 新增两个 helper：一个从 `message.content` 里 filter `type === 'toolCall'` 取 `{ id, name }`，一个读 `message.usage` 并转成 `AiUsage` 形状。
- `projectMessage` 的 assistant 分支补这两个字段。`message.usage` 在 pi 的 `AssistantMessage` 里是必填 `Usage`，但历史 entry 可能缺，读不到时给 `null`。

`message.completed` 事件也加 `usage`：改 `packages/contracts/src/ai.ts` 的 `harnessMessageCompletedEventSchema`，以及 `pi-event-mapper.ts` 的 `mapMessageEnd` assistant 分支。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-agent-sessions.test.ts --config vitest.config.ts
```

## S5 投影 tokensBefore（transcript）

`packages/contracts/src/ai.ts`：`agentTranscriptSystemSchema` 加 `tokensBefore: z.number().int().min(0).nullable()`。

`apps/api/src/modules/ai/session/session.presenter.ts`：`projectEntry` 的 compaction 分支补 `tokensBefore: entry.tokensBefore`。pi 的 `CompactionEntry.tokensBefore` 是必填 number，但历史 entry 可能缺，读不到给 `null`。

验证同 S4。

## S6 更新 spec 并跑全量检查

`.trellis/spec/api/backend/ai-system-design.md`：

- 5.1 节的事件类型列表补 `turn.started` / `turn.completed` / `context.compacted`。
- 4.2 节说明 compaction 现在是可观测 operation。
- 新增一小节说明活跃 Run 快照：它是进程内视图，不是持久事实，终态后为 `null`。

`.trellis/spec/api/backend/agent-run-guidelines.md`：第 3 节补一条——Run Service 负责累积对外快照，Executor 不参与。

全量检查（AGENTS.md 的 JS/TS 质量门，按顺序）：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
| --- | --- | --- |
| `packages/contracts/src/ai.ts` | 所有端共用，schema 写错会同时打断 api 和 admin | 每个 S 单独提交，`git revert` 单个 commit |
| `run.service.ts` | Run 生命周期唯一所有者，改 push 路径可能破坏 sequence 单调性或 terminal 唯一性 | S3b 单独提交；回滚只丢快照，事件流不受影响 |
| `pi-event-mapper.ts` | 事件转换唯一位置，turn 计数错会导致轮次显示错 | S3a 单独提交 |
| `agent-executor.ts` | `compactIfNeeded` 在 `transformContext` 回调里，抛错会中断 agent loop | 新增回调必须包 try/catch，发事件失败不能影响 compaction 结果 |

## 完成前确认

- [x] `AsyncEventQueue` 单消费者问题**没有**被顺手改（不在本任务范围，只在 prd.md 记录）
- [x] `ai-gateway.ts:94` 的 2048 clamp **没有**被改
- [x] 没有引入 thinking 相关字段或事件
- [x] 没有改 `AiToolResult` 返回值结构（只给 `AiToolExecutionContext` 加了可选 `reportProgress`）
- [x] `tool.progress` 已按 R3 接通，有真实生产者和测试覆盖
- [x] 三个新事件都进了 `ai-harness-contracts.test.ts` 的全枚举用例
- [x] `GET /runs/{runId}` 终态时 `live` 返回 `null`

与原计划不同的两处实现选择（理由见 prd.md 的「完成情况」）：

- 快照判据用 Run row 状态，不用 `registry.get(runId)`。后者在 `finalizeRun` 的两步之间会产生「终态 status + 非空 live」的非法组合。
- 本节原先写的「`tool.progress` 仍是死事件」与 prd.md 的 R3 矛盾，以 prd.md 为准，已接通。
