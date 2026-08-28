# Web 刷新后恢复进行中的 Run 流式渲染

## 目标

Web 聊天页在模型仍在生成时刷新浏览器，重新加载后要继续显示这一轮的流式输出（思考过程、正文、工具活动），而不是停在静态历史、等 Run 自己结束才看见结果。

## 背景与已确认事实

后端不受页面刷新影响，事件已持久化，缺的是「前端刷新后怎么找回这条 Run 并接上流」。

已核对的现状：

- SSE 断开不会中止 Run：`apps/api/src/modules/ai/run/run.route.ts:85`、`apps/api/src/modules/ai/run/run.route.ts:150` 的 catch 注释和实现都只结束当前订阅。
- 断线恢复接口已存在：`GET /api/ai/sessions/{sessionId}/runs/{runId}/events/stream`，支持 `afterSequence` 查询参数与 `Last-Event-ID` 头（`apps/api/src/modules/ai/run/run.openapi.ts:130`、`apps/api/src/modules/ai/run/run.route.ts:93`）。`subscribe` 先回放持久事件再接实时队列（`apps/api/src/modules/ai/run/run.service.ts:527`）。
- 恢复能力已有测试覆盖：`apps/api/src/test/run-event-recovery.test.ts:255` 用 `Last-Event-ID` 恢复，`:223` 用 `afterSequence` 拉持久 Timeline。
- 缺口：没有任何接口能按 sessionId 找到进行中的 Run。run 路由全部要求路径里带 `runId`（`apps/api/src/modules/ai/run/run.openapi.ts` 全量路由），session 路由只有列表、详情、改名、归档、transcript（`apps/api/src/modules/ai/session/session.openapi.ts:27` 起）。
- Run 的 session 索引在进程内：`ActiveRunRegistry` 只维护内存 Map，注释已声明它不代表持久状态（`apps/api/src/infra/agent/active-run-registry.ts:48`）。持久侧可查的是 `ai_agent_runs` 的 `status`（`starting`/`running`）和 `sessionId`；repository 目前只有 `findById`、`findInScope`、`listNonTerminal`（`apps/api/src/modules/ai/run/run.repository.ts:37`）。
- 进程重启后不会留下僵尸 running：启动时 `recoverInterrupted()` 把非终态 Run 落成 `interrupted`（`apps/api/src/modules/ai/run/run.service.ts:657` 起，调用点在 `apps/api/src/modules/ai/ai.route.ts`）。
- 用户提问在 Run 开始时就已进 transcript：pi 的 agent loop 在进入循环前就 emit prompt 消息的 `message_start` / `message_end`（`@earendil-works/pi-agent-core@0.84.1` 的 `dist/agent-loop.js:52`），mapper 在 `message_end` 调 `session.appendMessage` 落盘（`apps/api/src/infra/agent/pi-event-mapper.ts:311`）。assistant 消息则要等 `message_end` 才落盘，所以刷新后 transcript 有用户气泡、没有半截的 assistant 消息，恢复渲染不会和历史重复。
- 前端挂载只拉 Agent 列表、Session 列表和 transcript，没有查活跃 Run 的动作（`apps/web/hooks/use-chat-run.ts:96`-`:130`）。
- 前端已有断流兜底：`beginRunPolling` 每 1.5s 查 `GET /runs/{runId}`，用返回的 `live` 快照覆盖 timeline（`apps/web/hooks/use-chat-run.ts:203`）。它依赖内存里的 `runIdRef`，刷新后 runId 丢失，这条路走不通。
- 事件折叠逻辑与首次发送共用：`applyRunEvent` / `createChatRunState`（`apps/web/lib/ai/chat-events.ts`），恢复流可以直接复用，不需要第二套渲染路径。

## 需求

- R1 API 提供按 session 查进行中 Run 的能力，返回的 Run 字段与 `GET /runs/{runId}` 一致，供前端刷新后定位 runId。
- R2 Web 读到当前会话有进行中的 Run 时，连 `events/stream?afterSequence=0` 全量回放并继续消费实时增量，界面进入运行中状态（含思考过程、正文、工具活动）。触发点两个：页面挂载、手动切回某个会话。
- R3 恢复出的 Run 与首次发送的 Run 行为一致：能停止（abort）、进终态后自动切回 transcript 静态历史、`run.failed` 的错误照常提示。
- R4 恢复过程中的竞态要收敛：查到 running 但连流时 Run 已进终态，按回放到的终态事件直接走 transcript；查询返回 null（含进程重启后被标 `interrupted` 的情况）不进运行中状态，保持静态历史。
- R5 契约类型放 `packages/contracts`，API 与 Web 共用，不各写一份。

## 验收标准

- [x] AC1 API smoke test：Run 仍在跑时按 session 查询能拿到该 Run 的 runId 和 `running` 状态；Run 进终态后同一查询不再返回它。
- [x] AC2 API smoke test：Run 仍在跑时读 transcript 已包含本轮用户消息、不包含未完成的 assistant 消息。
- [x] AC3 API smoke test：用查到的 runId 连 `events/stream?afterSequence=0`，能收到从 sequence 1 开始的全量事件并以终态事件结束。
- [x] AC4 Web 测试：`apps/web/test/run-event-stream.test.ts` 覆盖恢复流的帧解析，断言按 `afterSequence` 请求并产出全量事件。
- [x] AC5 手动验证：长文生成中刷新页面，重新加载后界面继续打字，生成完成后正文与思考过程完整，无重复气泡。（真实环境已验证：刷新后正文 607→706→3136 持续增长后正常 completed，正文关键词全命中，用户气泡仅 1 个；连续两轮在刷新后继续渲染。注：deepseek-v4-flash 未输出 thinking 块，思考过程的折叠规则由 isomorphism fixture 自动化测试覆盖）
- [x] AC6 恢复态点停止按钮能中止 Run，界面转入已中止提示。（真实环境已验证：刷新后恢复态点停止，DB 终态 aborted / AI.REQUEST_ABORTED，界面显示已取消、无「请求失败」报错，停止按钮消失、输入框恢复可用）
- [x] AC7 `pnpm check` 与 `pnpm test` 全部通过。

已验证的真实环境表现：起 `pnpm dev:api` + `pnpm dev:web` 后浏览器打开 `/chat`，API 日志里挂载时的 `GET /api/ai/sessions/{id}/active-run` 返回 200，SQL 条件是 `session_id = ? and lane = ? and status IN ('starting','running') order by created_at desc`。

## 不做的事

- 不做跨进程的 Run 接管：API 重启后 Run 已被标 `interrupted`，不尝试续跑。
- 不改 Run 终态提交时机，不提前把 assistant 半成品写进 transcript。
- 不为多标签页做互斥或去重，SSE 本身支持多订阅者。
- 不做「历史 Run 回放」入口（进终态的 Run 重新播一遍事件流）。
- 不给会话列表加「正在跑」标记，不改会话列表 UI。
- 不做 steer、follow-up、transcript 翻页、多 lane 视图，这些仍在既有边界外。
