# AI 会话渲染与 Agent 收尾完善

## Goal

让 Admin 的 Agent 会话页按真实顺序完整显示一次 Run 的过程（文字、思考、工具、上下文压缩），并且让 Run 无论走成功、工具失败还是轮次上限，都以一段模型给用户的话收尾。

## Background

`.trellis/tasks/archive/2026-08/08-20-ai-harness-runtime-visibility` 加了 turn 事件、compaction 事件、message usage 和 Run live 快照，但只做到 API 层，Admin 没有消费。现在流式视图和历史视图不同构，思考内容在协议里没有出口，撞到 `maxTurns` 时模型没有机会给出总结。

## Requirements

### R1 流式与历史统一成一条时间线

现状：流式视图把 assistant 文本堆在一个气泡里、工具固定挂在气泡底部（`apps/admin/src/features/ai/pages/AgentSessions.tsx:822-834`，工具区是 `AgentSessions.tsx:164-224` 的横向 chip 列表），历史视图按 `sequence` 交错（`AgentSessions.tsx:47-116`）。Run 一进终态就 `setStreamState(createEmptyHarnessStreamState())` 并重新拉 transcript（`AgentSessions.tsx:466-486`），画面从「文字 + 底部工具 chips」跳成「文字块 / 工具行 / 文字块」。原因是流式 reducer 把消息和工具存成两个平行数组（`apps/admin/src/features/ai/harness/stream-reducer.ts:38-39`）。

要做：

- `stream-reducer.ts` 的 `messages` / `tools` 合并成一条 timeline，元素类型覆盖 assistant 文本段、思考块、工具卡、compaction 提示，排序直接用 HarnessEvent 的 `sequence`。
- `agentRunLiveSnapshotSchema` 同步改成 timeline 结构，服务端 `apps/api/src/modules/ai/run/run.live-snapshot.ts` 的折叠规则跟着改，保持与前端 reducer 同构。
- 流式视图和 transcript 视图共用同一组元素渲染组件，Run 进终态时布局不变。
- 历史侧不改投影顺序，transcript 已按 `sequence` 返回。

### R2 思考内容在流式和历史都能看

现状：`PiEventMapper` 只映射 `text_delta`（`apps/api/src/infra/agent/pi-event-mapper.ts:171`），`assistantText` 只取 text block（`pi-event-mapper.ts:458`）；transcript 投影的 `assistantContentToString` 同样只取 text block（`apps/api/src/modules/ai/session/session.presenter.ts:215`）。数据本身已经落库：pi-ai 的 `AssistantMessage.content` 是 `(TextContent | ThinkingContent | ToolCall)[]`，executor 原样 `appendMessage`（`pi-event-mapper.ts:190`）。

要做：

- contracts 新增 thinking 事件，`PiEventMapper` 补 `thinking_start` / `thinking_delta` / `thinking_end` 映射。
- transcript 的 assistant item 补 thinking 字段，投影时保留 `ThinkingContent`。
- live 快照的 timeline 元素包含思考块。
- UI 上思考块默认折叠。
- 同步修正两处 spec 约束：`.trellis/spec/api/backend/ai-system-design.md:205`、`.trellis/spec/api/backend/ai-integration-guidelines.md:113` 现在写的是 thinking 必须在 infra 内丢弃。

前提：Agent 配置的 `thinkingLevel` 默认 `off`（`apps/admin/src/features/ai/pages/Agents.tsx:419`），不开就没有思考内容，验收时要用非 off 的 Agent。

### R3 撞到 maxTurns 时追加一轮无工具收尾

现状：`shouldStopAfterTurn` 在 `turns >= maxTurns` 时返回 true（`apps/api/src/infra/agent/agent-executor.ts:327-330`），Pi 的 agent loop 收到 true 直接发 `agent_end` 退出，不再发起模型请求。这一轮的工具已经执行完，最后一条 assistant message 的 stopReason 是 `toolUse`，`resolveTerminalResult` 没有对应分支，Run 记为 `completed`（`agent-executor.ts:590-632`）。UI 结果是最后只有工具调用、没有总结文字，状态却显示已完成。默认 `maxTurns` 是 8（`packages/contracts/src/ai.ts:321-330`）。

要做：

- 撞顶且这一轮还在调工具时不直接退出，再跑一轮、且这一轮不给工具，逼模型基于已有结果给出文字回答。
- 终态事件加停止原因字段，UI 区分「模型自己说完了」和「撞上轮次上限后收尾」。
- `maxTurns` 语义变成「最多 N 轮工具轮 + 1 轮收尾」，撞顶时多一次模型请求。

工具本身失败的路径不动：`failWithoutAudit` 生成带 `modelText` 的 error toolResult 让模型继续，只有 Run 总时长耗尽和显式取消才 `onTerminalFailure` → `agent.abort()`（`apps/api/src/infra/agent/pi-tool-adapter.ts:519-542`）。

### R4 SSE 中断不丢内容

现状：SSE 只挂在 `POST /api/ai/sessions/{sessionId}/runs` 的响应上（`apps/api/src/modules/ai/run/run.route.ts:25-72`）。对外事件队列上限 1024，超限直接 `end()`（`apps/api/src/modules/ai/run/run.service.ts:42`、`run.service.ts:173`），前端把提前结束当成流中断抛错（`apps/admin/src/api/ai/harness.api.ts:133`），而 Run 还在后台跑。Run 失败时最后一段还没 `message_end` 的流式文字会随 `setStreamState(empty)` 消失，transcript 里也没有它。Run live 快照做好了但前端没接：`useAgentRunQuery` 只用来显示状态 Tag，没有轮询（`AgentSessions.tsx:372`、`apps/admin/src/api/ai/harness.query.ts:60-66`）。

要做：

- SSE 提前结束不报错、不清空已有流式视图，转成轮询 `GET /api/ai/sessions/{sessionId}/runs/{runId}`，用 `live` 刷新视图，到终态再换 transcript。
- 队列 1024 超限的表现问题由同一条覆盖。

### R5 transcript 首屏取最新

现状：前端固定 `limit: 100`、不传 cursor、不消费 `nextCursor`（`apps/admin/src/api/ai/harness.query.ts:51`、`AgentSessions.tsx:580`），而 store 用的是升序 + `afterSeq` 游标（`apps/api/src/infra/agent/pi-session-store.ts:201-212`）。超过 100 条 entry 的会话只显示最早 100 条，新消息不出现。

要做：

- `agentTranscriptQuerySchema` 加分页方向字段，首屏用 `newestFirst` 取最新 50 条，服务端反转成时间正序返回。
- 向上加载更多用 `cursor.afterSeq`，前端消费 `nextCursor`。

### R6 运行过程可解释

现状：`turn.started`、`turn.completed`、`context.compacted` 在前端 reducer 落到 default 被忽略（`stream-reducer.ts:202`），transcript 的 `usage` 字段没有渲染。

要做：

- reducer 记录当前轮次和 `maxTurns`，UI 显示轮次进度。
- compaction 作为时间线元素显示。
- assistant 消息显示 token 用量，来源是 `message.completed` 的 `usage` 和 transcript item 的 `usage`。

## Technical Notes

已验证的 Pi 能力，实现时按这些事实来：

- `prepareNextTurnWithContext` 能替换下一轮 `context`，`AgentContext.tools` 是可选字段，agent loop 每轮从 `currentContext.tools` 取工具。executor 目前没用这个回调，R3 的收尾轮靠它实现。
- `shouldStopAfterTurn` 在当前轮工具执行完之后调用，返回 true 就 `agent_end`，不再发起模型请求。
- `findEntriesOnBranch` 支持 `order: 'newestFirst'`，该方向下 `cursor.afterSeq` 的判据是 `entry.seq < afterSeq`（取更早的）；`oldestFirst` 会先遍历整条 branch 再反转，长会话更慢。
- pi-ai 的 `AssistantMessageEvent` 提供 `thinking_start` / `thinking_delta` / `thinking_end`。

边界变更只有一条：thinking 正文进入公开协议。工具入参保持不进协议，工具卡继续只显示工具名、状态和 `safeSummary`（`session.presenter.ts:229`）。

停止原因只出现在终态事件和 live 快照，不落主库、不进 transcript。这与轮次信息现在的处理一致，代价是刷新页面后看不到「撞上轮次上限」这个标记。

## Acceptance Criteria

- [x] 一次含工具调用的 Run，流式过程中元素顺序是文字段、工具卡、文字段交错；Run 进终态后同一段内容的顺序和位置不变。验证方式：`test-fixtures/harness-timeline-isomorphism.json` 同一串事件分别喂服务端折叠和前端 reducer，两侧断言 kind 序列、顺序和 blocks 序列等价（`apps/api/src/test/run-live-snapshot.test.ts`、`apps/admin/src/test/harness-timeline.test.ts`），加上 `agent-sessions.test.tsx` 的顺序断言。
- [x] `thinkingLevel` 非 `off` 的 Agent 跑 Run 时出现默认折叠的思考块；刷新页面后思考块仍在（数据来自 transcript）。验证方式：`pi-agent-executor.test.ts` 的 thinking 事件顺序、`ai-agent-sessions.test.ts` 的 transcript blocks、`agent-sessions.test.tsx` 的折叠与展开。
- [x] `maxTurns` 设小（例如 2）且模型会连续调工具时，Run 最后一条是文字总结，终态事件的停止原因是轮次上限，UI 显示对应提示。验证方式：`pi-agent-executor.test.ts` 的收尾轮用例（收尾轮 tools 为空、收尾提示不进 transcript）、`ai-agent-runs.test.ts` 的 `reason=max_turns`、`agent-sessions.test.tsx` 的 UI 提示。
- [x] 手动断开 SSE 连接后，已显示的流式内容不消失、不弹错误，视图切到轮询继续更新，Run 终态后显示完整 transcript。验证方式：`ai-api.test.ts` 的三条断流用例（中途断流按未终态返回、零事件断流抛错、主动取消照旧抛错）、`agent-sessions.test.tsx` 的转轮询与停轮询。
- [x] entry 超过 100 条的会话，首屏显示最新消息，向上加载能取到更早的内容。验证方式：`pi-session-store.test.ts` 的 `newestFirst` + cursor、`ai-agent-sessions.test.ts` 的 backward 首屏与翻页、`agent-sessions.test.tsx` 的加载更早。
- [x] UI 显示当前轮次和 `maxTurns`、compaction 提示行、assistant 消息的 token 用量。验证方式：`agent-sessions.test.tsx`、`harness-stream-reducer.test.ts`。
- [x] `pnpm check` 和 `pnpm test` 通过；新增 API 行为有对应 vitest 用例。

真实模型下的端到端表现（断线转轮询、思考块、收尾轮）没有手工跑过，以上全部靠单元和集成测试覆盖。

## Out of Scope

- 工具入参进协议。
- 按 sequence 续订的 SSE 重连端点。现在事件队列是单消费者 `AsyncEventQueue`（`run.service.ts:173`），route 独占迭代，要续订必须改成多订阅加环形重放缓冲，另开任务。
- 会话标题自动命名（`AgentSessions.tsx:504` 现在写死默认标题）。
- `MarkdownRenderer` 换成成熟库。
- 多 lane 的 UI。
