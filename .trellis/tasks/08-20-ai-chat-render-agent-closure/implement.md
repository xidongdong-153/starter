# 执行计划

按阶段推进，每个阶段跑完自己的验证命令再进下一个。契约先改，API 后改，Admin 最后改。

## 阶段 1：协议

- [x] `packages/contracts/src/ai.ts` 加 `agentMessageBlockSchema`。
- [x] `agentTranscriptAssistantMessageSchema` 加可选 `blocks`。
- [x] 加 `thinking.started` / `thinking.delta` / `thinking.completed` 三个事件 schema，并入 `harnessEventSchema` 的 discriminated union。
- [x] `harnessRunCompletedEventSchema.data` 加 `reason: 'model_finished' | 'max_turns'`。
- [x] `agentRunLiveSnapshotSchema` 的 `messages` / `tools` 换成 `timeline`，上限 128。
- [x] `agentTranscriptQuerySchema` 加 `direction`，`limit` 默认改 50、上限 200。

验证：

```bash
pnpm --filter @starter/contracts build
pnpm --filter @starter/api exec vitest run src/test/ai-harness-contracts.test.ts --config vitest.config.ts
```

此时 API 和 Admin 会有类型错误，属于预期，阶段 2 起逐个消掉。

## 阶段 2：API 事件映射与投影

- [x] `apps/api/src/infra/agent/pi-event-mapper.ts`：`mapMessageUpdate` 增加 thinking 分支，映射 `thinking_start` / `thinking_delta` / `thinking_end`。
- [x] `apps/api/src/modules/ai/session/session.presenter.ts`：assistant 分支补 `blocks`，按 `message.content` 原顺序投影 text 与 thinking。
- [x] `apps/api/src/modules/ai/run/run.live-snapshot.ts`：折叠规则改成单条 timeline，覆盖 message、thinking、tool、compaction。
- [x] `apps/api/src/modules/ai/run/run.service.ts`：终态发布带上 `reason`。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/pi-agent-executor.test.ts src/test/ai-agent-sessions.test.ts src/test/ai-agent-runs.test.ts --config vitest.config.ts
```

新增用例：thinking 事件按顺序发布、transcript `blocks` 顺序正确、live 快照 timeline 折叠结果与事件顺序一致。

## 阶段 3：API 收尾轮

- [x] `apps/api/src/infra/agent/agent-executor.ts`：加 `prepareNextTurnWithContext`，撞顶且本轮有 toolCall 时清空 `context.tools` 并注入只进内存的收尾提示。
- [x] 调整 `shouldStopAfterTurn`，放收尾轮跑一次。
- [x] `ExecutorTerminalResult` 加 `completionReason`，`resolveTerminalResult` 透传。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/pi-agent-executor.test.ts src/test/ai-agent-runs.test.ts --config vitest.config.ts
```

新增用例（用 stub streamFn 造场景）：

- `maxTurns=2`，第 2 轮仍调工具：收尾轮无工具、Run `completed`、`reason=max_turns`、最后一条 assistant message 有文字。
- `maxTurns=2`，第 2 轮直接给文字：不追加收尾轮，`reason=model_finished`。
- 收尾提示不出现在 transcript 里。

## 阶段 4：API transcript 反向分页

- [x] `apps/api/src/infra/agent/pi-session-store.ts`：`readTranscript` 加 `order` 参数并透传 `findEntriesOnBranch`。
- [x] `apps/api/src/modules/ai/session/session.service.ts`：按 `direction` 选 `order`，`backward` 读 `limit + 1` 判 `hasMore`，反转成时间正序，`nextCursor` 取本页最早 `seq`。
- [x] `session.openapi.ts` 更新查询参数和 `nextCursor` 说明。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/pi-session-store.test.ts src/test/ai-agent-sessions.test.ts --config vitest.config.ts
```

新增用例：entry 数超过 limit 时首屏返回最新一页且为正序；带 cursor 的 backward 请求返回更早一页；`forward` 行为不变。

## 阶段 5：Admin 时间线渲染

- [x] `apps/admin/src/features/ai/harness/stream-reducer.ts`：状态改成单条 timeline，加 `turn` / `maxTurns`，消费 thinking、turn、compaction，`terminal` 带 `reason`。
- [x] 新增 `apps/admin/src/features/ai/harness/timeline.ts`：`fromLiveSnapshot` 与 `fromTranscript`。
- [x] 从 `AgentSessions.tsx` 抽出时间线组件：消息（文字 + 默认折叠思考块 + token 用量）、工具卡、compaction 提示。
- [x] `AgentSessions.tsx` 流式与历史都改用这组组件。
- [x] 删掉 `StreamingToolList` 和旧的分支渲染。

验证：

```bash
pnpm --filter @starter/admin exec vitest run src/test/harness-stream-reducer.test.ts src/test/agent-sessions.test.tsx --config vitest.config.ts
```

`harness-stream-reducer.test.ts` 和 `agent-sessions.test.tsx` 都要跟着改，现有断言是按 messages/tools 两个数组写的。

## 阶段 6：Admin 断线轮询与交互补齐

- [x] `apps/admin/src/api/ai/harness.api.ts`：`startAgentRun` 返回 `{ terminal: boolean }`，不再抛「流意外中断」。
- [x] `apps/admin/src/api/ai/harness.query.ts`：`useAgentRunQuery` 支持轮询间隔；transcript query 支持 `direction` 和 `cursor`。
- [x] `AgentSessions.tsx`：SSE 提前结束时保留时间线并开轮询，轮询用 `live.timeline` 覆盖，Run 终态后换 transcript 并停轮询。
- [x] 补轮次进度、停止原因提示、向上「加载更多」。
- [x] 补 i18n 文案（`ai.sessions.*`）：思考块、轮次、压缩、用量、加载更多、轮次上限收尾。

验证：

```bash
pnpm --filter @starter/admin exec vitest run src/test/agent-sessions.test.tsx src/test/ai-query.test.tsx src/test/i18n.test.ts --config vitest.config.ts
```

## 阶段 7：spec 与全量检查

- [x] `.trellis/spec/api/backend/ai-system-design.md`：改 205 行附近的 thinking 约束，补事件清单、live 快照 timeline、收尾轮和 transcript 分页方向。
- [x] `.trellis/spec/api/backend/ai-integration-guidelines.md`：改 113 行附近的 thinking 丢弃约束（加范围限定：只适用于模型测试 Gateway）。
- [x] `.trellis/spec/api/backend/agent-run-guidelines.md` 与 `pi-agent-execution-guidelines.md`：补收尾轮和停止原因。
- [x] `.trellis/spec/api/backend/agent-session-guidelines.md`：补 transcript `blocks` 和分页方向。
- [x] `.trellis/spec/admin/frontend/component-guidelines.md` 与 `state-management.md`：补时间线组件和轮询兼顾的约定。
- [x] `AGENTS.md`：补 `test-fixtures/` 目录和跨包 fixture 的约定。

验证：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

## 风险文件

- `apps/api/src/infra/agent/agent-executor.ts`：Pi 的回调顺序是 `prepareNextTurn` 先、`shouldStopAfterTurn` 后。状态机写反会出现「收尾轮不跑」或「无限追加收尾轮」。改完必须用 `maxTurns=2` 的用例验证。
- `apps/api/src/modules/ai/run/run.service.ts`：终态事件只能发一次，加 `reason` 不能改变发布路径。
- `apps/admin/src/features/ai/pages/AgentSessions.tsx`：939 行，抽组件时容易漏掉 abort、切会话、归档这些清理分支，`agent-sessions.test.tsx` 是主要防线。

## 实现后补记

两个计划外的修正，都是 check 阶段发现的：

- `run.live-snapshot.ts` 的 `completeMessage` 原本把 thinking 块提前、text 折叠成一个，interleaved thinking 下会和 transcript 顺序不一致。改成单 text 块才用事件 `content` 覆盖、多 text 块保留原顺序，Admin reducer 同步。
- 只带 toolCall 的 assistant message 投影出 `blocks: []`，`TimelineAssistantMessage` 原本无条件渲染「正在思考」占位，每个工具轮都会留一个假加载气泡。改成 `completed` 且空 blocks 时整条不渲染。

另外 `apps/admin/vitest.config.ts` 加了 `testTimeout: 15_000`：新增测试把 `pnpm test` 的并发负载拉高，把一个既有的慢用例（`ai-management-pages.test.tsx` 的技能页面，单独跑 1.3 秒）挤过了默认 5 秒上限。已用 stash 验证 baseline 下 `pnpm test` 是绿的。

## 回滚点

每个阶段独立成一次提交。回滚顺序是 Admin → API → contracts，反了会留下类型错误。
