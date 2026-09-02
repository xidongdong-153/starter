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
  activeRun(access: RuntimeAccessContext, sessionId: string, lane: string): AgentRun | null
  timeline(access: RuntimeAccessContext, sessionId: string, runId: string, afterSequence: number, pageSize: number): RunTimeline
  sequenceForEvent(access: RuntimeAccessContext, sessionId: string, runId: string, eventId: string): number
  subscribe(access: RuntimeAccessContext, sessionId: string, runId: string, afterSequence: number): AsyncIterable<RunEvent>
  structuredOutputs(access: RuntimeAccessContext, sessionId: string, runId: string): StructuredOutputList
  adminStructuredOutputs(runId: string): StructuredOutputList
  trace(access: RuntimeAccessContext, sessionId: string, runId: string): RunTrace
  abort(access: RuntimeAccessContext, sessionId: string, runId: string): AgentRun
  steer(access: RuntimeAccessContext, sessionId: string, runId: string, text: string): AgentRun
  followUp(access: RuntimeAccessContext, sessionId: string, runId: string, text: string): AgentRun
  recoverInterrupted(): Promise<RunRecoveryReport>
  describeResolvedManifest(runId: string): AiRunResolvedManifest | null
}
```

Repository 方法见 `apps/api/src/modules/ai/run/run.repository.ts`：`create`、`findOwned`（join session 校验 owner）、`findById`、`markRunning`、`updateTerminal`（条件更新）、`listNonTerminal`、`findActiveInScope`（按 session + lane 取 `starting`/`running` 的一条）。

Route 10 个 endpoint：

```text
POST   /api/ai/sessions/{sessionId}/runs                              # 创建 Run，按 Accept 分流返回 SSE 或 JSON
GET    /api/ai/sessions/{sessionId}/active-run                        # 该 lane 仍在跑的 Run，没有时 data 为 null
GET    /api/ai/sessions/{sessionId}/runs/{runId}
GET    /api/ai/sessions/{sessionId}/runs/{runId}/timeline              # 持久时间线
GET    /api/ai/sessions/{sessionId}/runs/{runId}/events                # 完整 RunEvent
GET    /api/ai/sessions/{sessionId}/runs/{runId}/events/stream         # 已有 Run 的 SSE 恢复
GET    /api/ai/sessions/{sessionId}/runs/{runId}/structured-outputs    # 结构化输出读取（运行面主体）
GET    /api/ai/sessions/{sessionId}/runs/{runId}/trace                 # 管理 Trace
POST   /api/ai/sessions/{sessionId}/runs/{runId}/abort
POST   /api/ai/sessions/{sessionId}/runs/{runId}/steer
POST   /api/ai/sessions/{sessionId}/runs/{runId}/follow-ups
GET    /api/ai/admin/runs/{runId}/structured-outputs                   # 结构化输出读取（admin，AI_CONFIG_READ）
```

所有运行面路由挂 `requireRuntimePrincipal`：cookie 用户与 Bearer product_app 都能访问；`/api/ai/admin/runs/{runId}/structured-outputs` 挂 `requireAuth` + `AI_CONFIG_READ`。

## 3. Contracts

- `ai_agent_runs` 存 Run 索引与无 secret snapshot：id、session_id、agent_id、lane、status、agent_revision、snapshot_json、request_id、idempotency_key、idempotency_scope、final_entry_id、error_code、created_at、started_at、finished_at。message 和事件不进主库。
- snapshot 用 `agentRunSnapshotSchema` 校验后 `JSON.stringify` 保存；读取时再次 parse，失败视为数据损坏（运行时不应发生）。
- startRun 幂等键：`idempotency_key + idempotency_scope` 的部分唯一索引（`WHERE idempotency_key IS NOT NULL`）是最终防线；scope 由 `RuntimeAccessContext` 七字段拼出（kind|tenantId|projectId|principalId|externalUserId|subjectType|subjectId），与 accessWhere 判据一致。预检查在 reserve 之前：命中同 Session 直接返回既有 Run 的 runId（SSE 走 subscribe 回放），异 Session 409；create 命中唯一约束时先释放原始 lease 再重查走同一分支。key 只在 Run 行创建成功后被消费（busy、校验失败、404 都不消费），终态 Run（含 failed）同 key 返回原 Run 不重跑。
- Run Service 是 lane lease（进程内 registry + 持久 lease）reserve/acquire/attach/release、Run row、RunEventPublisher、`run.started` 和 terminal event 的唯一所有者；Executor 不创建或更新主库 Run。
- Session lane 的执行排他以 `ai_agent_lane_leases` 持久 lease 为权威（`run/lane-lease.ts`；TTL 90s、续租 30s 是代码常量，不配环境变量）。`startRun` 先查进程内 registry（快速失败路径），再 acquire db lease：条件 INSERT / 过期接管（`fencing_token` +1）都不命中返回 busy，映射 `AI.SESSION_BUSY`；acquire、Run row 创建之间任何失败都要同时释放两层 lease。ownerId 用 `parseEnv` 的 `APP_INSTANCE_ID`。执行期间每 30s 续租一次，续租失败（被接管或过期）调用 registry handle 的 abort，走现有 aborted 收尾。
- 终态事务（`completeWithTerminalEvent`）在同一事务内做 fencing 校验：执行路径传入 `lease.ownerId`，lease 行的 owner、`fencing_token` 与 Run row 的 `execution_fencing_token` 一致且未过期才按实际结果提交；失配或过期时终态强制写 `interrupted`（`AI.RUN_INTERRUPTED`），丢弃实际执行结果。恢复扫描路径不传 lease，Run row token 为 NULL 的历史行也跳过校验。
- `startRun` 第一行 `await readiness`：`createAiServices` 把 `recoverInterrupted()` 的 Promise 存为 `AiServices.readiness`（恢复失败也 resolve，只记日志），恢复扫描（含扫描 lane 的过期 lease 清理）完成前新 Run 请求等待而不是拒绝或并行执行。诊断型 session 一致性检查保持 fire-and-forget。`/health` 语义不变，AI readiness 是内部门禁。
- `registry.reserve` 返回的原始 lease 必须保留到 Run 终态。`prepare`、`attach` 或 `markRunning` 失败时可能还没有 runId handle，清理路径必须直接释放原始 lease，不能只按 runId 释放。db lease 同理：`RunContext.laneLease` 存的是 acquire 拿到的 owner + token 对。
- 终态顺序固定：等待 executor result -> 写 `starter.run` -> 条件更新主库（含 fencing 校验）-> 发布唯一 terminal event -> 清续租定时器 -> db lease release -> registry release。
- 启动恢复读取 `starter.run` 时，必须同时核对 `runId`、`sessionId`、`lane`、`agentId` 和 `agentRevision`；任一字段与主库 Run 不一致都按损坏处理并标记 `AI.RUN_INTERRUPTED`。
- 事件队列是有界 `AsyncEventQueue`（`MAX_PENDING_EVENTS = 1024`），超限时关闭 transport，不阻塞 Agent loop、不 abort Run。客户端遇到这种提前结束不能报错，要转成轮询 `live` 快照。
- Run Service 同时负责累积对外的活跃 Run 快照（`GET /runs/{runId}` 的 `live` 字段），Executor 和 `ActiveRunRegistry` 都不参与。所有事件必须经过 `publish` 进入队列：它先折叠快照、再 push，绕过它会让快照漏掉首尾状态。
- 快照内容是一条 `timeline`（message / tool / compaction），折叠规则必须与 Admin `stream-reducer.ts` 同构，包括 `message.completed` 不重排块、timeline 128 / blocks 64 上限丢最旧、按 sequence 去重。改任一边都要同时改另一边，否则 SSE 视图和轮询视图会错位。
- `run.completed` 带必填 `reason`，值来自 executor 的 `completionReason`（只在 completed 时有值，缺失时当 `model_finished`）。failed / aborted 的事件形状不变。
- 活跃快照按 Run row 状态判定是否返回，不按 registry handle。`finalizeRun` 先更新主库终态、后 release registry，按 handle 判断会在这个窗口返回「终态 + 非空快照」的非法组合。快照只在内存，release 时随之删除。
- `activeRun` 的判据只有主库 Run 行的 `starting` / `running`，不查 `ActiveRunRegistry`：registry 是进程内索引，进程重启后 `recoverInterrupted` 已经把非终态 Run 落成 `interrupted`，此时应该返回 null，让客户端保持静态历史。查询参数 `lane` 默认 `main`，响应 data 与 `GET /runs/{runId}` 同源（`toAgentRun(record, readLiveSnapshot(record))`），没有在跑的 Run 时 data 是 null 而不是 404。
- SSE 的 `id` 是 eventId、`event` 是 `RunEvent.type`、`data` 是完整 RunEvent JSON；heartbeat 用 comment，不创建 RunEvent。两处 SSE handler（创建流与恢复流）的心跳写入必须都是真实换行 `": heartbeat\n\n"`——写字面量 `\\n` 会产出永不封帧的垃圾字节并粘连下一帧。
- `POST /runs` 按 Accept 分流：请求 Accept 含 `application/json` 且不含 `text/event-stream` 时返回 JSON `{ ok, data: { runId }, meta }`，不订阅事件流（Run 照常执行，客户端用 `GET /runs/{runId}` + timeline 轮询）；缺省、`*/*` 或仅 `text/event-stream` 时维持 SSE，向后兼容既有客户端。
- 结构化输出读取（运行面与 admin 两路）的可见性规则：contract `visibility=product` 时运行面返回 value、`visibility=admin` 时返回 `value: null`；admin 路由恒返回 value。contract ref 组装用 `toStructuredOutputContractRef`（`output/output-contract-registry.ts`）：`schemaHash` / `renderKind` / `visibility` / `mode` 都取表内记录（emit 时刻的事实）；存量行的 `visibility` / `mode` 为 NULL 时回退 registry 当前定义。该函数与 transcript 回放（session 模块）共用，改一处必须同步另一处。contract 已从代码注册表移除且行内无表内值的记录不返回，记 WARN；有表内值的仍可渲染。
- Run 启动在 run row 之后、executor 启动之前写入 `ai_run_resolved_manifests`（manifest 只含资源 revision、content hash、tool manifestHash、contract schemaHash，无 Prompt 正文无 secret）。写入失败按 starting 失败收尾：发布 run.failed、释放两层 lease，不存在无 manifest 的 starting/running Run。`describeResolvedManifest(runId)` 读回经 `aiRunResolvedManifestSchema` 校验的 DTO。
- Prompt/Skill 的 content、description、name（name 拼进 system prompt 的 available_skills 块且 read_skill 按 name 查找）变化都在单事务内追加 revision 行、刷新主表镜像、bump 引用 Agent 的 revision 与记录列；仅 enabled 变化不触发。resolve 按 Agent 行 pinned revision 读不可变 revision 行，行缺失时回退主表当前值（测试种子兼容）。不变量：Agent revision 变化当且仅当其执行输入可能变化。skill description 的历史 revision 行只存 content，description-only 变化产生的 revision 行与上一行内容相同，事后无法重建当时的 available_skills 块——这是已知边界。`read_skill` 执行期按 name 读主表当前内容，长 Run 中途更新 skill 会读到比 manifest 记录更新的内容，留阶段 C 处理。`ai_output_contract_snapshots` 表当前只写不读（define 时 upsert 全量元数据 + schema JSON），供阶段 D manifest presenter 使用，是预写存储。

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
| registry 或持久 lease 同 session+lane 冲突（Run row 创建前） | 409 | `AI.SESSION_BUSY`，不创建 Run |
| 同 scope 幂等键已绑定其他 Session 的 Run | 409 | `AI.IDEMPOTENCY_KEY_CONFLICT`，不影响既有 Run |
| lane 创建失败 | 500 | `AI.SESSION_STORAGE_FAILED` |
| 控制接口（abort/steer/follow-up）无 active handle | 409 | `AI.RUN_NOT_ACTIVE` |
| structured-outputs 运行面路由：session/run 不属于该 principal | 404 | `COMMON.NOT_FOUND` |
| structured-outputs admin 路由：runId 不存在 | 404 | `COMMON.NOT_FOUND` |
| structured-outputs admin 路由：无 AI_CONFIG_READ 权限 | 403 | 既有权限错误码 |
| `starter.run` 写入失败 | 持久化 failed | 主库 `AI.SESSION_STORAGE_FAILED`，发布 run.failed |
| `starter.run` 写入后主库终态更新失败 | 不发布 terminal event | 记录日志、关闭 transport、release，等恢复修复 |

## 5. Good / Base / Bad Cases

- Good：`registry.reserve` + db lease acquire 在 Run row 创建前检查，busy 直接 409 不产生 Run；Run row 创建后的失败窗口（prepare/attach/markRunning）持久化 failed 并发布 `run.failed` 作为 sequence 1 的唯一 SSE event，不发送 `run.started`，并直接释放原始 lane lease（registry + db 两层）。
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
- 刷新恢复链路（`run-event-recovery.test.ts`，用挂住的 streamFn 把 Run 停在 running）：`GET /active-run` 返回该 Run 且 `status` 为 `running`；同一时刻 transcript 已含本轮 `user_message`、不含 `assistant_message`；断掉原来那条 SSE 后 Run 继续跑；用查到的 runId 连 `events/stream?afterSequence=0` 能收到从 sequence 1 开始的连续事件并以终态事件收尾；Run 进终态后 `GET /active-run` 的 data 为 null；他人查同一 session 的 `active-run` 返回 404。
- 第三方接入链路（`apps/api/src/test/ai-third-party-access.test.ts`，Bearer product_app 视角）：CORS 预检覆盖 7 个运行面头；agent 公共列表只含 enabled、伪造 Bearer 401；`Accept: application/json` 启动返回 runId 后轮询到 completed 且 timeline 完整，显式 `text/event-stream` 仍走 SSE；structured-outputs 路由的 product/admin 可见性打码、admin 路由不打码、跨 scope 404；transcript 中 `emit_structured_output` 的 tool_activity 携带 structuredOutput。心跳修复无集成测试（15s 定时器不可观测），由两处写法一致性与既有 sse parser 测试覆盖。
- lane lease（`apps/api/src/test/ai-lane-lease.test.ts`）：store 级条件更新（插入 token=1、未过期 busy、过期接管 token+1、旧 owner renew/release 无效果、`releaseExpired` 只删过期行）；双 runtime（`runDualRuntimeApps`，共享 Starter db、不同 `APP_INSTANCE_ID`）同 lane 互斥（一成功一 `AI.SESSION_BUSY`、主库单条非终态 Run、终态后可再启动）、不同 lane 不互斥；lease 被接管后旧 owner 终态落成 `interrupted` 且不删新 owner 的 lease 行；短 TTL / 续租间隔注入（`RuntimeDeps.laneLeaseOptions`）验证续租失败后 executor 中止；readiness 未 resolve 时 startRun 等待且不建 Run、不领 lease。双 runtime 底座共享同一个 Pi Session store 实例：Pi SQLite backend 对同一 session 只允许一个写者，两个 repository 打开同一文件会互相拒绝，与本组用例验证的 Starter lease 粒度无关。
- resolved manifest（`apps/api/src/test/ai-resolved-manifest.test.ts`）：相同 Agent revision 两次 Run 相同 manifestHash；Prompt/Skill 的 content、description、name 更新都传播（资源 revision+1、引用 Agent revision+1、未引用不变、旧 Run manifest 不变）；内联配置 manifest（inline=true、contentHash 为内联文本 SHA-256、全文不落库）；manifest 写入失败 Run 落 failed 且两层 lease 释放；Tool manifestHash 稳定；contract 移除后历史输出按表内值渲染。

## 7. Wrong vs Correct

错误写法把 busy 检查放在 Run row 创建之后，导致并发请求产生多余 Run row 且错误码不稳定：

```ts
repository.create({ ... })                    // 先建 Run
try { registry.reserve(sessionId, lane) } catch { throw busy() }  // 后检查
```

正确写法先 reserve 再创建 Run row，Run row 创建前的冲突直接 409 且不产生 Run；创建后的失败窗口统一走终态持久化：

```ts
const lease = registry.reserve(sessionId, lane)   // 进程内快速失败，busy -> 409，无 Run
const laneLease = laneLeaseStore.acquire({ ... })  // 排他权威；busy -> 409 并释放 registry lease
await ensureLane(sessionStore, sessionId, lane)   // 非 main lane 显式创建
repository.create({ ..., executionFencingToken }) // 之后失败走 failed 终态
```

> **Warning**: Pi 只自动创建 `main` lane。非 main lane 必须由 Run Service 显式 `createLane`（已存在会抛 `already_exists`，需幂等忽略），否则 executor 打开 session 时 `Lane not found`。
