# API AgentRun 子域规范

改 `apps/api/src/modules/ai/run/` 或 Run 生命周期相关代码时按本规范。S6 完成 Run 的持久化生命周期、SSE、abort/steer/follow-up、单 lane 并发控制和进程中断恢复；公开 DTO、事件、`starter.run` 和错误码以共享契约为准：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md` 第 4-8 节。

## 1. Scope / Trigger

- 新增或改动 Run 的 repository、service、route、presenter、OpenAPI 或测试。
- 改动 `ai_agent_runs` 表、Run 启动恢复扫描或 SSE 事件流。
- 不需要本规范：只读改动 AgentDefinition、Admin 页面或 executor 内部逻辑（executor 见 `pi-agent-execution-guidelines.md`）。

## 2. Signatures

```ts
interface AiAgentRunService {
  startRun(input: {
    access: RuntimeAccessContext
    sessionId: string
    input: StartAgentRunInput
    requestId: string
  }): Promise<{ runId: string; events: AsyncIterable<RunEvent> }>
  get(access: RuntimeAccessContext, sessionId: string, runId: string): AgentRun
  timeline(access: RuntimeAccessContext, sessionId: string, runId: string, afterSequence: number, pageSize: number): RunTimeline
  sequenceForEvent(access: RuntimeAccessContext, sessionId: string, runId: string, eventId: string): number
  subscribe(access: RuntimeAccessContext, sessionId: string, runId: string, afterSequence: number): AsyncIterable<RunEvent>
  trace(access: RuntimeAccessContext, sessionId: string, runId: string): RunTrace
  abort(access: RuntimeAccessContext, sessionId: string, runId: string): AgentRun
  steer(access: RuntimeAccessContext, sessionId: string, runId: string, text: string): AgentRun
  followUp(access: RuntimeAccessContext, sessionId: string, runId: string, text: string): AgentRun
  recoverInterrupted(): Promise<RunRecoveryReport>
}
```

Repository 方法见 `apps/api/src/modules/ai/run/run.repository.ts`：`create`、`findOwned`（join session 校验 owner）、`findById`、`markRunning`、`updateTerminal`（条件更新）、`listNonTerminal`。

Route 9 个 endpoint：

```text
POST   /api/ai/sessions/{sessionId}/runs                              # 创建 Run + SSE
GET    /api/ai/sessions/{sessionId}/runs/{runId}
GET    /api/ai/sessions/{sessionId}/runs/{runId}/timeline              # 持久时间线
GET    /api/ai/sessions/{sessionId}/runs/{runId}/events                # 完整 RunEvent
GET    /api/ai/sessions/{sessionId}/runs/{runId}/events/stream         # 已有 Run 的 SSE 恢复
GET    /api/ai/sessions/{sessionId}/runs/{runId}/trace                 # 管理 Trace
POST   /api/ai/sessions/{sessionId}/runs/{runId}/abort
POST   /api/ai/sessions/{sessionId}/runs/{runId}/steer
POST   /api/ai/sessions/{sessionId}/runs/{runId}/follow-ups
```

## 3. Contracts

- `ai_agent_runs` 存 Run 索引与无 secret snapshot：id、session_id、agent_id、lane、status、agent_revision、snapshot_json、request_id、final_entry_id、error_code、created_at、started_at、finished_at。message 和事件不进主库。
- snapshot 用 `agentRunSnapshotSchema` 校验后 `JSON.stringify` 保存；读取时再次 parse，失败视为数据损坏（运行时不应发生）。
- Run Service 是 registry reserve/attach/release、Run row、RunEventPublisher、`run.started` 和 terminal event 的唯一所有者；Executor 不创建或更新主库 Run。
- `registry.reserve` 返回的原始 lease 必须保留到 Run 终态。`prepare`、`attach` 或 `markRunning` 失败时可能还没有 runId handle，清理路径必须直接释放原始 lease，不能只按 runId 释放。
- 终态顺序固定：等待 executor result -> 写 `starter.run` -> 条件更新主库 -> 发布唯一 terminal event -> release registry。
- 启动恢复读取 `starter.run` 时，必须同时核对 `runId`、`sessionId`、`lane`、`agentId` 和 `agentRevision`；任一字段与主库 Run 不一致都按损坏处理并标记 `AI.RUN_INTERRUPTED`。
- 事件队列是有界 `AsyncEventQueue`（`MAX_PENDING_EVENTS = 1024`），超限时关闭 transport，不阻塞 Agent loop、不 abort Run。客户端遇到这种提前结束不能报错，要转成轮询 `live` 快照。
- Run Service 同时负责累积对外的活跃 Run 快照（`GET /runs/{runId}` 的 `live` 字段），Executor 和 `ActiveRunRegistry` 都不参与。所有事件必须经过 `publish` 进入队列：它先折叠快照、再 push，绕过它会让快照漏掉首尾状态。
- 快照内容是一条 `timeline`（message / tool / compaction），折叠规则必须与 Admin `stream-reducer.ts` 同构，包括 `message.completed` 不重排块、timeline 128 / blocks 64 上限丢最旧、按 sequence 去重。改任一边都要同时改另一边，否则 SSE 视图和轮询视图会错位。
- `run.completed` 带必填 `reason`，值来自 executor 的 `completionReason`（只在 completed 时有值，缺失时当 `model_finished`）。failed / aborted 的事件形状不变。
- 活跃快照按 Run row 状态判定是否返回，不按 registry handle。`finalizeRun` 先更新主库终态、后 release registry，按 handle 判断会在这个窗口返回「终态 + 非空快照」的非法组合。快照只在内存，release 时随之删除。
- SSE 的 `id` 是 eventId、`event` 是 `RunEvent.type`、`data` 是完整 RunEvent JSON；heartbeat 用 comment，不创建 RunEvent。

## 4. Validation & Error Matrix

| 条件 | HTTP | Error code |
| --- | --- | --- |
| 未登录 | 401 | 既有 `AUTH.UNAUTHENTICATED` |
| Session 不存在、属他人或已归档 | 404 | `COMMON.NOT_FOUND` |
| Run 不存在或不属于该 Session owner | 404 | `COMMON.NOT_FOUND` |
| 没有 agentId 且 Session 没有 defaultAgentId | 400 | `COMMON.INVALID_REQUEST` |
| Agent 不存在 | 404 | `COMMON.NOT_FOUND`（resolve 抛出） |
| Agent 非 enabled | 409 | `AI.AGENT_NOT_ENABLED`（resolve 抛出） |
| Agent 配置引用无效 | 400 | `AI.AGENT_CONFIG_INVALID`（resolve 抛出） |
| registry 同 session+lane 冲突（Run row 创建前） | 409 | `AI.SESSION_BUSY`，不创建 Run |
| lane 创建失败 | 500 | `AI.SESSION_STORAGE_FAILED` |
| 控制接口（abort/steer/follow-up）无 active handle | 409 | `AI.RUN_NOT_ACTIVE` |
| `starter.run` 写入失败 | 持久化 failed | 主库 `AI.SESSION_STORAGE_FAILED`，发布 run.failed |
| `starter.run` 写入后主库终态更新失败 | 不发布 terminal event | 记录日志、关闭 transport、release，等恢复修复 |

## 5. Good / Base / Bad Cases

- Good：`registry.reserve` 在 Run row 创建前检查，busy 直接 409 不产生 Run；Run row 创建后的失败窗口（prepare/attach/markRunning）持久化 failed 并发布 `run.failed` 作为 sequence 1 的唯一 SSE event，不发送 `run.started`，并直接释放原始 lane lease。
- Good：正常路径只在 prepare、attach 和 starting -> running 更新成功后才发布 sequence 1 的 `run.started`；message/tool 事件与 terminal event 的 sequence 均由 RunEventPublisher 分配。
- Good：客户端断开只停止向该连接写数据（transport 移除），不调用 abort；Run 继续执行并持久化终态。
- Base：abort 幂等，正在取消时重复调用返回当前 Run 状态；终态后没有 handle 返回 `AI.RUN_NOT_ACTIVE`。
- Base：启动恢复扫描非终态 Run；有 active handle 的跳过；Pi 侧唯一合法 terminal entry 投影主库终态；无 entry、重复 entry、schema 解析失败都标记 `AI.RUN_INTERRUPTED`。
- `recoverInterrupted()` 是 API 启动时的批量修复扫描，不创建单次 Run 的 `starter.ai.run` span；其结果通过 `RunRecoveryReport` 返回。
- POST 创建流固定从 sequence 0 开始；已有 Run 的恢复使用 GET `/events/stream` 的 `afterSequence` 或 `Last-Event-ID`，未知 eventId 返回 `COMMON.INVALID_REQUEST`。
- Bad：把 registry 或 executor 状态直接暴露给 Route；Route 不迭代 executor 事件，只订阅 Run Service 的对外队列。
- Bad：在 `starter.run` 写入前发布 terminal event，或在主库更新失败后仍发布第二个 terminal event。

## 6. Tests Required

`apps/api/src/test/ai-agent-runs.test.ts` 覆盖：

- 文本 Run 从 starting/running 进入唯一 completed 终态，SSE 顺序正确（`run.started` sequence 1，terminal 事件只发布一次），Pi 侧只有一条 `starter.run`，主库终态完整。
- 同一 Session lane 并发返回 409 `AI.SESSION_BUSY` 且只创建一条 Run row；不同 lane 可并发。
- provider 失败映射为稳定 failed 终态；prepare 失败后原始 lane lease 已释放，下一次同 lane Run 可以启动；abort 产生 aborted 终态，终态后 steer/follow-up 返回 `AI.RUN_NOT_ACTIVE`。
- 他人 Session 或 Run 一律 404（读、abort、steer、follow-up、启动都不暴露存在性）。
- 启动恢复：无 terminal entry -> interrupted；唯一合法且 `runId`、`sessionId`、`lane`、`agentId`、`agentRevision` 全部匹配的 entry -> 投影终态；重复 entry、身份字段不匹配 -> corrupted/interrupted；schema 解析失败 -> corrupted/interrupted。
- transcript 写入侧挂载 runId（message 顶层字段，S5 读取规则兼容）。
- 活跃快照：Run 执行中 `GET /runs/{runId}` 的 `live` 非空且部分 assistant 文本与已推送 delta 一致；终态后 `live` 为 null；他人 Run 仍 404。用挂住的 streamFn 让 Run 停在生成中间态来断言。
- 终态原因：撞 `maxTurns` 的 Run 的 `run.completed.data.reason` 为 `max_turns`，正常结束为 `model_finished`。
- 同构回归：`apps/api/src/test/run-live-snapshot.test.ts` 读取 `test-fixtures/run-event-timeline-isomorphism.json`，断言 `applyRunEvent` 折叠结果与 fixture 里的快照完全相等；产品前端自己折叠事件时使用同一份 fixture 校验。任一边漂移都会红。
- `run-event-recovery.test.ts` 覆盖回放窗口竞态、delta/progress 游标、进程重启后的持久 Timeline 和 GET `/events/stream` 的 `Last-Event-ID`；测试通过 `createTestApp` 注入测试 Provider，不依赖真实模型。

## 7. Wrong vs Correct

错误写法把 busy 检查放在 Run row 创建之后，导致并发请求产生多余 Run row 且错误码不稳定：

```ts
repository.create({ ... })                    // 先建 Run
try { registry.reserve(sessionId, lane) } catch { throw busy() }  // 后检查
```

正确写法先 reserve 再创建 Run row，Run row 创建前的冲突直接 409 且不产生 Run；创建后的失败窗口统一走终态持久化：

```ts
const lease = registry.reserve(sessionId, lane)   // busy -> 409，无 Run
await ensureLane(sessionStore, sessionId, lane)   // 非 main lane 显式创建
repository.create({ ... })                       // 之后失败走 failed 终态
```

> **Warning**: Pi 只自动创建 `main` lane。非 main lane 必须由 Run Service 显式 `createLane`（已存在会抛 `already_exists`，需幂等忽略），否则 executor 打开 session 时 `Lane not found`。
