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

AgentRuntimePort 是产品运行面窄依赖：

```ts
interface AgentRuntimePort {
  start(input: AgentRuntimeStartInput): Promise<{ runId: string; events: AsyncIterable<RunEvent> }>
  get(access: RuntimeAccessContext, sessionId: string, runId: string): AgentRun
  active(access: RuntimeAccessContext, sessionId: string, lane: string): AgentRun | null
  subscribe(
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    cursor: { afterSequence: number } | { lastEventId: string },
  ): AsyncIterable<RunEvent>
  abort(access: RuntimeAccessContext, sessionId: string, runId: string): AgentRun
  steer(access: RuntimeAccessContext, sessionId: string, runId: string, input: SteerAgentRunInput): Promise<AgentRun>
  followUp(access: RuntimeAccessContext, sessionId: string, runId: string, input: FollowUpAgentRunInput): Promise<AgentRun>
  transcript(
    access: RuntimeAccessContext,
    sessionId: string,
    query: AgentTranscriptQuery,
    requestId?: string,
  ): Promise<AgentTranscript>
  outputs(access: RuntimeAccessContext, sessionId: string, runId: string): StructuredOutputList
}
```

port 文件只能依赖 contracts DTO 和 `RuntimeAccessContext`，不得依赖 Hono、repository、Pi 包或 concrete service `ReturnType`。adapter 接收结构化 Run/Session backend；`sequenceForEvent` 只在 adapter 内部把 `{ lastEventId }` 转成 service 的数字游标。

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
- product_app capability policy：`runtime/app-policy.ts` 是唯一判定模块（`strongestSideEffect` / `enforceStartPolicy` / `enforceControlPolicy` / `manifestAllowedByPolicy`），policy 判断不得写进 route、transport 或产品模块。guard 把 `ai_app_credentials.policy_json` parse 成 `RuntimeAccessContext.policy`，null（存量行）或 parse 失败一律 fail closed（等价拒绝一切），starter_user 恒 pass-through。`startRun` 的 `enforceStartPolicy` 位于 expectedAgentRevision 检查之后、幂等键预检查 / registry reserve / db lease / Run row 之前，403 全程无副作用（不建 Run、不占 lease、不消费 idempotencyKey）；abort/steer/followUp 在查到 scoped Run（404 判据在前）之后、操作 active handle 之前只查 controls，不重查 executables（已在跑的 Run 不追溯）。Agent revision 变化后旧 policy 拒绝，不执行旧版本也不自动升级。discovery（`listExecutableManifests` / `getExecutableManifest`）按 policy 过滤，不允许的详情返回 404。policy 经 `PATCH /api/ai/admin/applications/{appId}/policy` 更新，写 `policy_updated` 审计；rotate 保留 policy，revoke 仍 401。
- Run Service 是 lane lease（进程内 registry + 持久 lease）reserve/acquire/attach/release、Run row、RunEventPublisher、`run.started` 和 terminal event 的唯一所有者；Executor 不创建或更新主库 Run。
- Session lane 的执行排他以 `ai_agent_lane_leases` 持久 lease 为权威（`run/lane-lease.ts`；TTL 90s、续租 30s 是代码常量，不配环境变量）。`startRun` 先查进程内 registry（快速失败路径），再 acquire db lease：条件 INSERT / 过期接管（`fencing_token` +1）都不命中返回 busy，映射 `AI.SESSION_BUSY`；acquire、Run row 创建之间任何失败都要同时释放两层 lease。ownerId 用 `parseEnv` 的 `APP_INSTANCE_ID`。执行期间每 30s 续租一次，续租失败（被接管或过期）调用 registry handle 的 abort，走现有 aborted 收尾。
- 终态事务（`completeWithTerminalEvent`）在同一事务内做 fencing 校验：执行路径传入 `lease.ownerId`，lease 行的 owner、`fencing_token` 与 Run row 的 `execution_fencing_token` 一致且未过期才按实际结果提交；失配或过期时终态强制写 `interrupted`（`AI.RUN_INTERRUPTED`），丢弃实际执行结果。恢复扫描路径不传 lease，Run row token 为 NULL 的历史行也跳过校验。
- `startRun` 第一行 `await readiness`：`createAiServices` 把 `recoverInterrupted()` 的 Promise 存为 `AiServices.readiness`（恢复失败也 resolve，只记日志），恢复扫描（含扫描 lane 的过期 lease 清理）完成前新 Run 请求等待而不是拒绝或并行执行。诊断型 session 一致性检查保持 fire-and-forget。`/health` 语义不变，AI readiness 是内部门禁。
- `registry.reserve` 返回的原始 lease 必须保留到 Run 终态。`prepare`、`attach` 或 `markRunning` 失败时可能还没有 runId handle，清理路径必须直接释放原始 lease，不能只按 runId 释放。db lease 同理：`RunContext.laneLease` 存的是 acquire 拿到的 owner + token 对。
- 终态顺序固定：等待 executor result -> 写 `starter.run` -> 条件更新主库（含 fencing 校验）-> 发布唯一 terminal event -> 清续租定时器 -> db lease release -> registry release。
- Run 是 logical Run：`ai_agent_runs.current_attempt_no` 指向当前尝试，`ai_run_attempts` 一行一次执行（attempt_no、trigger initial/auto_retry、retry_reason、owner_id、fencing_token、status、error_code、起止时间）。Attempt 1 在 run row 后创建；auto retry 在原始请求内同步链式：旧 attempt 落 failed（记 retry_reason）、INSERT 新 attempt、更新 current_attempt_no、重建 executor，不释放不重取 lease（续租持续），不发布中间 terminal event，SSE 不断流。
- auto retry 判定三条件缺一不可：executor 错误码在白名单（`AI_UPSTREAM_ERROR`、`AI_UPSTREAM_TIMEOUT`，代码常量不开放配置）且 currentAttemptNo < retryPolicy.maxAttempts（`agentDefinitionConfigSchema.retryPolicy`，缺省 1 不重试）且 resolved manifest 无 `non_idempotent_write` Tool（副作用门禁：无法证明重跑不重复外部写）。abort、参数错误、存储失败均不重试。
- fencing 对 Attempt 提交生效：重试期间 lease 被接管时，旧 owner 终态事务校验失配，强制落 `interrupted` 并扫尾全部 running attempt 行与 agent Step。恢复扫描（markInterrupted / recoveredFromEntry）按 run.currentAttemptNo 收尾当前 attempt；旧数据无 attempt 行时条件更新 no-op 安全。
- Tool 执行幂等 token：adapter 生成 `sha256Hex(canonicalJson({ runId, attemptNo, toolExecutionId }))`，持久到 `ai_tool_executions.idempotency_token` 并经 `AiToolExecutionContext.idempotencyToken` 传给 handler；平台不维护 token→结果映射，去重由 handler 或下游按 token 实现。Attempt 边界在 Pi transcript 中表现为重复的用户输入 entry，不做清理。
- 启动恢复读取 `starter.run` 时，必须同时核对 `runId`、`sessionId`、`lane`、`agentId` 和 `agentRevision`；任一字段与主库 Run 不一致都按损坏处理并标记 `AI.RUN_INTERRUPTED`。
- 事件队列是有界 `AsyncEventQueue`（`MAX_PENDING_EVENTS = 1024`），超限时关闭 transport，不阻塞 Agent loop、不 abort Run。客户端遇到这种提前结束不能报错，要转成轮询 `live` 快照。
- Run Service 同时负责累积对外的活跃 Run 快照（`GET /runs/{runId}` 的 `live` 字段），Executor 和 `ActiveRunRegistry` 都不参与。所有事件必须经过 `publish` 进入队列：它先折叠快照、再 push，绕过它会让快照漏掉首尾状态。
- 快照内容是一条 `timeline`（message / tool / compaction），折叠规则必须与 Admin `stream-reducer.ts` 同构，包括 `message.completed` 不重排块、timeline 128 / blocks 64 上限丢最旧、按 sequence 去重。改任一边都要同时改另一边，否则 SSE 视图和轮询视图会错位。
- `run.completed` 带必填 `reason`，值来自 executor 的 `completionReason`（只在 completed 时有值，缺失时当 `model_finished`）。failed / aborted 的事件形状不变。
- 活跃快照按 Run row 状态判定是否返回，不按 registry handle。`finalizeRun` 先更新主库终态、后 release registry，按 handle 判断会在这个窗口返回「终态 + 非空快照」的非法组合。快照只在内存，release 时随之删除。
- `activeRun` 的判据只有主库 Run 行的 `starting` / `running`，不查 `ActiveRunRegistry`：registry 是进程内索引，进程重启后 `recoverInterrupted` 已经把非终态 Run 落成 `interrupted`，此时应该返回 null，让客户端保持静态历史。查询参数 `lane` 默认 `main`，响应 data 与 `GET /runs/{runId}` 同源（`toAgentRun(record, readLiveSnapshot(record))`），没有在跑的 Run 时 data 是 null 而不是 404。
- SSE 的 `id` 是 eventId、`event` 是 `RunEvent.type`、`data` 是完整 RunEvent JSON；heartbeat 用 comment，不创建 RunEvent。两处 SSE handler（创建流与恢复流）的心跳写入必须都是真实换行 `": heartbeat\n\n"`——写字面量 `\\n` 会产出永不封帧的垃圾字节并粘连下一帧。
- SSE writer 未观察到终态事件就结束（iterator 提前 EOF 或抛错、事件队列超限关闭）时，发送版本化 transport frame `event: stream.resume_required`（`streamResumeRequiredFrameSchema`：type、eventProtocolVersion、lastSequence、reason `transport_closed`），不带 SSE id；客户端按 lastSequence 重连 `/events/stream`。frame 是纯 transport 信号：不写 `ai_run_events`、不走 RunEventPublisher、不进 Timeline/transcript。正常终态流和客户端主动断开（onAbort 置位后）都不发。AI、chat、flow 三个入口共用 `writeRunEventStream`，一次实现全部生效。
- `AgentRuntimePort` 是 chat、flow 和 AI 运行路由的唯一运行面窄依赖。port 文件只能依赖 contracts DTO 和 `RuntimeAccessContext`，不得依赖 Hono、repository、Pi 包或 concrete service `ReturnType`。adapter 接收结构化 Run/Session backend；`sequenceForEvent` 只在 adapter 内部把 `{ lastEventId }` 转成 service 的数字游标。
- `startRunTransport` 必须把 `start()` 返回的 `events` iterable 直接交给 SSE writer，不能再调用 `subscribe(0)`。`resumeRunTransport` 在 `afterSequence > 0` 时传 `{ afterSequence }`；只有为 0 且存在 `Last-Event-ID` 时才传 `{ lastEventId }`；否则传 `{ afterSequence: 0 }`。
- RunEvent publisher 成功持久化事件时同时推入 start queue 和已有恢复 subscribers。终态提交成功、终态未提交或终态事务抛错后都必须关闭 start queue；SSE iterator 提前 `return()` 只关闭当前 queue，不 abort Run。
- 恢复订阅返回的 iterable 必须是显式 iterator：`return()` 同步移除 subscriber 并结束 queue。不能退回 async generator——它的 `return()` 会排在挂起的 `next()` 之后，客户端断开时 subscriber 要等下一个事件才被清理。`AsyncEventQueue` 的 iterator `return()` 结束整个 queue，一个 queue 只有一个消费者，需要扇出时为每个消费者建独立 queue。
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
| product_app 启动未授权：executable 不在 policy、revision 不精确匹配或聚合 side effect 超过 maxSideEffect | 403 | `AI.APP_POLICY_FORBIDDEN`，不建 Run、不占 lease、不消费幂等键 |
| product_app 调用未授权 control（policy.controls 缺 abort/steer/follow_up） | 403 | `AI.APP_POLICY_FORBIDDEN`，不影响该 Run |
| product_app 调用 `/api/ai/completions` | 403 | `AI.COMPLETION_FORBIDDEN`（Agent-only 承诺；内联 config 另有 `AI.RUN_INLINE_CONFIG_FORBIDDEN`） |
| registry 或持久 lease 同 session+lane 冲突（Run row 创建前） | 409 | `AI.SESSION_BUSY`，不创建 Run |
| 同 scope 幂等键已绑定其他 Session 的 Run | 409 | `AI.IDEMPOTENCY_KEY_CONFLICT`，不影响既有 Run |
| lane 创建失败 | 500 | `AI.SESSION_STORAGE_FAILED` |
| 控制接口（abort/steer/follow-up）无 active handle | 409 | `AI.RUN_NOT_ACTIVE` |
| structured-outputs 运行面路由：session/run 不属于该 principal | 404 | `COMMON.NOT_FOUND` |
| structured-outputs admin 路由：runId 不存在 | 404 | `COMMON.NOT_FOUND` |
| structured-outputs admin 路由：无 AI_CONFIG_READ 权限 | 403 | 既有权限错误码 |
| `starter.run` 写入失败 | 持久化 failed | 主库 `AI.SESSION_STORAGE_FAILED`，发布 run.failed |
| `starter.run` 写入后主库终态更新失败 | 不发布 terminal event | 记录日志、关闭 transport、release，等恢复修复 |
| 恢复 `afterSequence > 0` | 忽略 `Last-Event-ID`，按数字游标订阅 | 不调用 `sequenceForEvent` |
| 恢复 `afterSequence = 0` 且有 `Last-Event-ID` | adapter 解析 eventId；未知 ID 返回 400 | `COMMON.INVALID_REQUEST` |

## 5. Good / Base / Bad Cases

- Good：`registry.reserve` + db lease acquire 在 Run row 创建前检查，busy 直接 409 不产生 Run；Run row 创建后的失败窗口（prepare/attach/markRunning）持久化 failed 并发布 `run.failed` 作为 sequence 1 的唯一 SSE event，不发送 `run.started`，并直接释放原始 lane lease（registry + db 两层）。
- Good：正常路径只在 prepare、attach 和 starting -> running 更新成功后才发布 sequence 1 的 `run.started`；message/tool 事件与 terminal event 的 sequence 均由 RunEventPublisher 分配。
- Good：客户端断开只停止向该连接写数据（transport 移除），不调用 abort；Run 继续执行并持久化终态。
- Good：正常 start SSE 消费 `start()` 返回的初始 iterable，首个持久事件从 `run.started` 开始；终态后 queue 和 publisher 都关闭，writer 调用 iterator cleanup。
- Good：恢复流的数字游标优先于 `Last-Event-ID`；数字游标为 0 时才把 eventId 交给 adapter 解析。
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
- `apps/api/src/test/agent-runtime-port.test.ts`：验证每个 port 方法映射、数字游标透传、`lastEventId` 转换、transcript/outputs 映射和 port 源文件依赖边界。
- `apps/api/src/test/run-transport.test.ts`：覆盖缺省、`*/*`、仅 SSE、仅 JSON、JSON/SSE 同时出现；断言 start iterable 直接消费、`subscribe(0)` 不调用、终态停止和 iterator cleanup，并断言恢复游标优先级。
- `apps/api/src/test/product-modules.smoke.test.ts`：chat JSON start、active、transcript 与 flow SSE start、outputs 同构。
- `run-event-recovery.test.ts`：恢复流未知 `Last-Event-ID` 仍为 400；断线不 abort，恢复从持久 sequence 连续收尾。
- `run-event-recovery.test.ts` subscriber 生命周期回归三条：恢复 SSE 断开后 queue 立即 end（不等下一个事件）；终态事务返回 false 与终态事务抛错都不发布 terminal event，但初始 start queue 必须关闭，SSE 以非终态 EOF 结束不悬挂。
- 刷新恢复链路（`run-event-recovery.test.ts`，用挂住的 streamFn 把 Run 停在 running）：`GET /active-run` 返回该 Run 且 `status` 为 `running`；同一时刻 transcript 已含本轮 `user_message`、不含 `assistant_message`；断掉原来那条 SSE 后 Run 继续跑；用查到的 runId 连 `events/stream?afterSequence=0` 能收到从 sequence 1 开始的连续事件并以终态事件收尾；Run 进终态后 `GET /active-run` 的 data 为 null；他人查同一 session 的 `active-run` 返回 404。
- 第三方接入链路（`apps/api/src/test/ai-third-party-access.test.ts`，Bearer product_app 视角）：CORS 预检覆盖 7 个运行面头；agent 公共列表只含 enabled、伪造 Bearer 401；`Accept: application/json` 启动返回 runId 后轮询到 completed 且 timeline 完整，显式 `text/event-stream` 仍走 SSE；structured-outputs 路由的 product/admin 可见性打码、admin 路由不打码、跨 scope 404；transcript 中 `emit_structured_output` 的 tool_activity 携带 structuredOutput。心跳修复无集成测试（15s 定时器不可观测），由两处写法一致性与既有 sse parser 测试覆盖。
- lane lease（`apps/api/src/test/ai-lane-lease.test.ts`）：store 级条件更新（插入 token=1、未过期 busy、过期接管 token+1、旧 owner renew/release 无效果、`releaseExpired` 只删过期行）；双 runtime（`runDualRuntimeApps`，共享 Starter db、不同 `APP_INSTANCE_ID`）同 lane 互斥（一成功一 `AI.SESSION_BUSY`、主库单条非终态 Run、终态后可再启动）、不同 lane 不互斥；lease 被接管后旧 owner 终态落成 `interrupted` 且不删新 owner 的 lease 行；短 TTL / 续租间隔注入（`RuntimeDeps.laneLeaseOptions`）验证续租失败后 executor 中止；readiness 未 resolve 时 startRun 等待且不建 Run、不领 lease。双 runtime 底座共享同一个 Pi Session store 实例：Pi SQLite backend 对同一 session 只允许一个写者，两个 repository 打开同一文件会互相拒绝，与本组用例验证的 Starter lease 粒度无关。
- resolved manifest（`apps/api/src/test/ai-resolved-manifest.test.ts`）：相同 Agent revision 两次 Run 相同 manifestHash；Prompt/Skill 的 content、description、name 更新都传播（资源 revision+1、引用 Agent revision+1、未引用不变、旧 Run manifest 不变）；内联配置 manifest（inline=true、contentHash 为内联文本 SHA-256、全文不落库）；manifest 写入失败 Run 落 failed 且两层 lease 释放；Tool manifestHash 稳定；contract 移除后历史输出按表内值渲染。
- run attempt（`apps/api/src/test/ai-run-attempts.test.ts`）：幂等重放不建新 Run/Attempt；模型失败 + maxAttempts=2 创建 Attempt 2（trigger=auto_retry、retry_reason、事件 attemptNo 切换、单一 terminal、两 attempt 与 agent Step 终态）；abort 不重试；non_idempotent_write 门禁；上限耗尽全 attempt 落 failed；重试期 lease 接管落 interrupted；tool 审计行 token 持久且纯函数重算相同、handler 上下文拿到同一 token；超时措辞按 sideEffect 分类。trace 的 attempts 列表与 RunEvent 可选 attemptNo 字段（缺省视为 1）已进契约测试。
- 应用能力策略（`apps/api/src/test/ai-application-policy.test.ts`）：policy strict 校验 400 矩阵（未知字段、重复 executable、重复 control）；create 缺 policy 400；PATCH policy 生效 + `policy_updated` 审计 + revoked 409；discovery 只见 policy 内且 revision 精确匹配的 manifest（revision 升级后列表清空、详情 404）；start 三类 403（未授权 Agent / revision 不匹配 / maxSideEffect 超限）且无副作用（0 Run 行、同 lane 立即可启动、幂等键未被消费可复用）；controls 403 三例（挂住 streamFn 停在 running 再操作）；null policy（直插 `policy_json` NULL 模拟存量）fail closed（discovery 空 + start 403）；product_app completion 403；starter_user 对照不受 policy 影响。
- SSE 恢复 frame（`run-event-recovery.test.ts`）：正常终态流无 `stream.resume_required`；非终态 EOF 发 frame 且 lastSequence 等于最后事件 sequence（空流为 0）；恢复流以终态收尾且无 frame；flow 恢复端点从 sequence 1 连续收到终态（`product-modules.smoke.test.ts`）。
- webhook 事件交付（`ai-webhook.test.ts`）：payload 的 eventId/sequence 与 `ai_run_events` terminal 行一致；interrupted Run（无 terminal 事件行）两列 null；同 `finished_at` 201 条不漏（`(finishedAt, runId)` 复合游标）；双 dispatcher claim 互斥与过期重领；请求头带 `X-Starter-Delivery-Id`。

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

### Wrong：产品路由接收完整 AiServices

```ts
createChatRoute(runtime, aiServices)
// route 可以意外依赖管理 service、repository 形状或 sequenceForEvent
```

### Correct：产品路由只接收 port 和本产品所需的窄服务

```ts
createChatRoute(runtime, {
  agentDefinitionService: aiServices.agentDefinitionService,
  sessionService: aiServices.sessionService,
  runtimePort: aiServices.runtimePort,
  attachmentService: aiServices.attachmentService,
})
```

### Wrong：start SSE 再从 service subscribe(0)

```ts
const result = await runtimePort.start(input)
return writeRunEventStream(c, runtimePort.subscribe(access, sessionId, result.runId, { afterSequence: 0 }))
```

### Correct：直接消费 start 返回的 iterable

```ts
const result = await runtimePort.start(input)
return writeRunEventStream(c, result.events)
```

### Wrong：在 route / transport 各写一份 policy 判断

```ts
// run.route.ts、chat.route.ts、flow.route.ts 各自检查
if (access.principal.kind === 'product_app' && !policyAllows(agentId)) {
  throw new AppError(ApiErrorCodes.AI_APP_POLICY_FORBIDDEN, '...', 403)
}
```

三个入口必然漂移，且容易把检查放在幂等预检查或 lease 之后，产生带副作用的 403。

### Correct：单一检查模块在 service 入口调用

```ts
// runtime/app-policy.ts 是唯一判定点
// run.service.ts 在幂等键预检查、reserve 之前调用
enforceStartPolicy(access, { agentId, agentRevision, sideEffect }) // 403 无副作用
// agent.service.ts discovery 用 manifestAllowedByPolicy 过滤
```

policy 随 `RuntimeAccessContext` 进入 port，AI/chat/flow 三个入口自动统一生效；新增运行面动作时只扩展 `app-policy.ts` 和对应 service 调用点。

> **Warning**: Pi 只自动创建 `main` lane。非 main lane 必须由 Run Service 显式 `createLane`（已存在会抛 `already_exists`，需幂等忽略），否则 executor 打开 session 时 `Lane not found`。
