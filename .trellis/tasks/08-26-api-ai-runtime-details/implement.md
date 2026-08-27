# API AI 运行时重构实施计划

## 完成条件

实现后，Run 的所有产品事件、Step、Model Call、Tool Execution 和 Structured Output 都能通过统一关联字段查询；客户端可以从持久时间线恢复 SSE；管理员可以读取安全 Trace；Telemetry 能形成完整父子 span；Pi Agent loop、Pi Session 和现有 Tool 安全边界仍由对应模块负责。

## 阶段 0：规划确认与基线

- [x] 阅读本任务的 `prd.md`、`design.md` 和本文件。
- [x] 运行 `trellis-before-dev`，读取 API backend、contracts backend、database 和 cross-layer guide。
- [x] 检查工作区状态，只处理当前任务文件和后续明确列出的代码路径；保留用户已有的 `.pi/agents/*` 修改。
- [x] 确认 `@earendil-works/pi-telemetry` 在 lockfile 中为 `0.84.1`，并确认使用 `TelemetryContext.startSpan(options, callback)`；API package 已显式声明依赖。
- [x] 确认当前 Drizzle schema、migration 基线和测试数据库初始化路径；新增 migration 为 `0018`、`0019`、`0020`，测试使用临时 SQLite。
- [x] 确认 Pi 源码中的 Agent loop、Tool `terminate`、Session custom entry 和 `TelemetryContext.startSpan` 与设计一致；只读 `/Users/wuwanzhu/Code/pi`，未修改 Pi 源码。

验证：

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
pnpm --filter @starter/api db:check
git status --short
pnpm exec prettier --check .trellis/tasks/08-26-api-ai-runtime-details
```

停点：只完成规划和基线确认，不修改产品代码。

## 阶段 1：共享契约与执行 fixture

### 1.1 RunEvent 契约

- [x] 定义 `RunEvent` 作为唯一的外部运行事件协议，包含统一 envelope 和安全事件 discriminated union。
- [x] 定义 Timeline 分页 DTO、事件恢复游标 DTO 和 Trace 树 DTO。
- [x] 定义 Output Contract 引用、semver、schema hash、渲染类型、可见范围和输出模式 schema。
- [x] 重写 `packages/contracts/src/ai.ts` 的运行事件部分，删除旧 HarnessEvent 协议并完成所有生产者/消费者迁移。
- [x] 在 Agent config 和 Run snapshot 中接入 Output Contract 字段，并完成 API 运行链路投影。

### 1.2 Agent 与 Run snapshot

- [x] 在 Agent config 中加入 `outputContract`、`outputMode` 和结构化输出引用。
- [x] 在 Run snapshot 中保存 Contract name、semver、schema hash、render kind 和 mode。
- [x] snapshot schema 不保存 secret、prompt 正文、Tool handler、原始 provider settings 或不受控 JSON schema。

### 1.3 Fixture 与契约测试

- [x] 测试 RunEvent 的统一 envelope、事件分支、非法关联字段、协议外敏感字段、Timeline 分页和 Trace 父子关系。
- [x] 在 `test-fixtures/` 增加完整 Run fixture：`run-event-timeline-isomorphism.json` 覆盖两轮模型调用、一个 Tool、一个 Structured Output、一次经过 Publisher 合并的 message delta。
- [x] 测试完整执行 fixture、事件顺序、Timeline 投影和禁止字段扫描；`run-live-snapshot.test.ts` 逐条解析 RunEvent、断言 live snapshot 同构，并扫描禁止字段。

验证：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
```

停点：契约和 fixture 未通过前不进入数据库实现。

## 阶段 2：数据库模型与 repository

### 2.1 Schema 与 replacement migration

- [x] 在 `apps/api/src/modules/ai/ai.schema.ts` 新增 `ai_run_turns`。
- [x] 新增 `ai_run_steps`，约束 Run、Turn、kind、attempt 和 outcome。
- [x] 新增 `ai_run_events`，主键 `event_id`，唯一键 `(run_id, sequence)`，索引 `(run_id, type, sequence)`。
- [x] 新增 `ai_structured_outputs`，保存 Contract ref、schema hash、render kind、validated value 和关联 ID。
- [x] `ai_agent_runs` 已经等于 design.md §5 的目标形态，无需重建。核对依据：列集合为 id / session_id / agent_id / lane / status / agent_revision / snapshot_json / request_id / final_entry_id / error_code / created_at / started_at / finished_at；只有 `final_entry_id`、`error_code`、`started_at`、`finished_at` 四个终态关系字段可空；CHECK 覆盖 status、agent_revision 和 `json_valid(snapshot_json)`；外键为 `ai_agent_sessions` CASCADE 和 `ai_agent_definitions` RESTRICT；五个查询索引齐备。断言在 `src/test/ai-runtime-schema.test.ts`。
- [x] 扩展 `ai_model_calls`：`turn_id`、`step_id`、`api`、`ttft_ms`、`chunk_count`、`response_model`、`response_id`、`http_status`。
- [x] 扩展 `ai_tool_executions`：`run_id`、`step_id`、`tool_call_id`、`tool_execution_id`，并删除旧的 `ai_call_id` 双列设计；`model_call_id` 为必填并使用 CASCADE，migration `0020` 用旧值回填，相关 repository、projection 和迁移测试已更新。
- [x] 旧 custom entry 事实入口已删除：Pi custom entry 类型统一为 `starter.run`，写入、读取过滤、transcript 投影、恢复扫描和测试都不再引用 `starter.run.v1`，没有兼容读取分支。`ai_agent_runs` 没有不属于目标模型的运行字段。
- [x] migration 只新增文件并人工检查：`0018` 建四张新表和关联列，`0019` 为 `ai_model_calls` 追加 6 个可空审计列。两者都是 `CREATE TABLE` / `ALTER TABLE ADD COLUMN`，没有 SQLite 表重建，新列不带 CHECK（避开 drizzle-kit 0.31.10 的坏重建脚本），索引、外键和 `json_valid` 校验已在 `src/test/ai-runtime-schema.test.ts` 断言，`PRAGMA foreign_key_check` 为空。

## 2.1 迁移补充

- [x] migration `0020_amusing_plazm.sql` 重建 `ai_tool_executions`，删除 `ai_call_id`，保留 `model_call_id NOT NULL` 和 `ON DELETE CASCADE`；使用 `COALESCE(model_call_id, ai_call_id)` 保留历史 Tool 审计关联，并由迁移测试检查旧行、列集合和 `PRAGMA foreign_key_check`。

### 2.2 Repository

- [x] Run Turn / Run Step 收敛成一个 `run-lifecycle.repository.ts`：`beginTurn`、`completeTurn(id, outcome, finishedAt)`、`beginStep`、`completeStep(id, outcome, errorCode, finishedAt)`、`listRunning`、`listTurns`、`listSteps`。fail / retry / abort / deferred / overflow 都由 `outcome` 参数表达，不再额外加同义方法；两个 complete 都带 `WHERE outcome = 'running'`，重复关闭是幂等的。
- [x] Run 终态前由 `agent-executor.ts` 的 `finally` 调用 `listRunning` 兜底关闭遗留 Turn / Step，回归见 `src/test/pi-agent-executor.test.ts` 的「run 结束前用 listRunning 兜底关闭遗留的 Turn / Step」。
- [x] 新建 Run Event repository：allocate sequence、append、list after sequence、find sequence by eventId、find watermark。
- [x] 新建 Structured Output repository：create、find by Run、find by ID。
- [x] 扩展 Model Call/Tool Execution audit repository 的关联字段和安全 projection：begin/finalize 带 `run_id`、`turn_id`、`step_id`、`model_call_id`、`tool_call_id`、`tool_execution_id`、`api`、TTFT、chunk count、response model/id、HTTP status 和 stop reason；projection 额外给出由 errorCode 推导的 `errorCategory`，字段白名单断言在 `src/test/ai-usage-audit.test.ts`。
- [x] 增加 `completeWithTerminalEvent` 事务方法，保证 Run 终态和 terminal event 同时提交。
- [x] 所有 JSON 读取再次经过共享 Zod schema parse：`parseStoredJson`（`src/shared/stored-json.ts`）统一处理 `ai_agent_definitions.config_json`、`ai_agent_runs.snapshot_json`、`ai_run_events.payload_json` 和 `ai_structured_outputs.value_json`，失败抛 `StoredJsonError`（`SYSTEM.INTERNAL_ERROR` / 500），只把列名、原因分类和字段路径写安全日志。

### 2.3 数据层测试

- [x] 空数据库执行 migration 后，所有新表、索引和外键存在。
- [x] `PRAGMA foreign_key_check` 无结果。
- [x] Run、Turn、Step、Model Call、Tool Execution、Event、Output 可以写入完整关系。
- [x] 重复 `(run_id, sequence)` 写入失败，不产生第二条事件。
- [x] 同一 Run 并发 append 时 sequence 仍连续（`src/test/ai-run-data-layer.test.ts`，64 次并发 append 后 sequence 为 1..64，无重复无空洞）。
- [x] terminal transaction 失败时 Run 和 terminal event 都不产生半提交状态。
- [x] 删除 Run 时按目标 cascade 规则删除事件、Step、Turn 和 Structured Output。

验证：

```bash
pnpm --filter @starter/api db:generate
pnpm --filter @starter/api db:check
pnpm --filter @starter/api exec vitest run src/test/ai-runtime-schema.test.ts src/test/ai-run-data-layer.test.ts --config vitest.config.ts
```

停点：migration、外键和 sequence repository 未通过前不接入异步 Runtime。

## 阶段 3：RunExecutionContext 与事件生产

### 3.1 关联上下文

- [x] 在 `apps/api/src/infra/agent/` 定义内部 `RunExecutionContext`（`run-execution-context.ts`）。字段集合按 design.md §4.1：`runId`/`sessionId`/`lane`/`requestId`/`principal`/`scope`/`agentId`/`agentRevision`/`outputContract`/`turnIndex`/`turnId`/`step{id,kind,attempt}`/`modelCallId`/`tool{callId,executionId}`，另加由 principal 推导的只读 `userId`。
- [x] Run、Turn、Step、Model Call、Tool Execution、message 的 ID 只在各自生命周期开始时生成一次：`runId` 在 `run.service.ts` 建 Run row 前；`turnId`/`stepId` 由 `beginTurn`/`beginStep` 生成；`modelCallId` 在 `pi-native-stream.ts` 的 Provider 请求前生成并作为 `id` 传给审计；`toolExecutionId` 在 `pi-tool-adapter.ts` 的 `onToolExecutionStart` 里生成并传给审计 begin；`messageId` 在 `pi-event-mapper.ts` 的 `message_start` 生成。presenter 和事件映射都不再重新拼造 ID：envelope 只从 `execution.associations()` 取。
- [x] context 从 Run Service 传入 Executor（`AgentExecutorInput.execution`）、PiEventMapper（`PiEventMapperOptions.execution`）、native stream（`PiNativeStreamOptions.execution`）和 Tool adapter（`PiToolAdapterOptions.execution`）；这四处不再各自接 runId / sessionId / lane / requestId / principal / scope。
- [x] Executor 只产生内部事件事实（`RunEventDraft`）和终态结果：`EventSequencer` 已从 executor、mapper 和 Run Service 全部删除，产品 sequence 只由 `RunEventPublisher` 经 `ai_run_events` 分配；executor 不接触 SSE。

### 3.2 Event Publisher

- [x] 在 `apps/api/src/modules/ai/run/` 增加最小 Run Event Publisher，持久化成功后才进入实时队列，并覆盖连续 sequence 与恢复读取测试。
- [x] 将 `run.service.ts` 中现有 publish 逻辑收敛到 Publisher。
- [x] 为 message delta 和 Tool progress 增加 250ms/1KB 合并器（`RUN_EVENT_MERGE_WINDOW_MS = 250`、`RUN_EVENT_MERGE_MAX_BYTES = 1024`）。合并键是 `message.delta` 的 partId 和 `tool.progress` 的 toolCallId；文本按字节累加，Tool 进度取最新状态。强制 flush 点：任何非合并事件、换合并键、攒满 1KB、250ms 定时器、`finalizeRun` 终态事务前。`commitTerminal` 调 `publisher.close()` 清定时器。
- [x] 所有对外事件均经过持久化后才进入实时队列。
- [x] Publisher 写失败时停止当前 transport：`persist` 失败设 `storageFailed`、丢弃合并缓冲、回调 `onStorageFailure`，Run Service 标记 `context.storageFailed` 并 abort，终态强制为 `AI.SESSION_STORAGE_FAILED`；失败事件既不落库也不入队，后续事件不再发布，sequence 无空洞。
- [x] live snapshot 只折叠已发布的持久事实：`applyRunEvent` 只在 `persist()` 成功后由 `onPersisted` 调用；历史恢复走 `ai_run_events`。合并只改变 delta 粒度，不改变折叠结果（`run-live-snapshot.test.ts`「publisher 合并 delta 前后的折叠结果同构」）。

### 3.3 PiEventMapper

- [x] 将 `message_start/end/update` 映射为 message part 事实。
- [x] 将 thinking start/delta/end 映射为带 block index 的 thinking 事实，并应用 display policy。判据是 Run 启动时已解析的 `thinkingLevel`（`ResolvedAgentExecutorConfig.thinkingLevel` -> `PiEventMapperOptions.thinkingLevel`）：`off` 时 Pi 不发 thinking 事件，产品侧也不会有；非 `off` 时视为调用方显式要求思考可见，`display` 为 `true`，事件保留边界和正文，`thinking.completed.summary` 用 Pi 的 `content` 截断到 1000 字符。正文只允许出现在产品 thinking 事件和 `ai_run_events.payload_json`；telemetry span 和 `ai_model_calls` / `ai_tool_executions` 仍然不得出现 reasoning 正文。
- [x] 将 turn start/end 映射为 Turn 事实，并在 Turn 边界发布 `step.started` / `step.completed`：`turn_start` 后紧跟本轮 assistant Step 的 `step.started`，`turn_end` 前发它的 `step.completed`，`stepId` 直接用 `beginStep` 生成的那一个，与 `ai_run_steps` 行和 Step span 同 ID。compaction Step 走 `compactIfNeeded` 的 `onStepStarted` / `onStepCompleted`，同样复用 `ai_run_steps` 的 `stepId`。
- [x] Tool 侧新增 source 上报通道：`AiToolExecutionContext.reportSource` 与 `reportProgress` 同构（可选字段，工具内用 `?.` 调用）。adapter 先用 contracts 的 `aiSourceSchema` parse，再用 `isSafeAiReferenceUrl`（`ai-url-guard.ts`，与出站守卫同级规则）校验 URL，通过后交 executor 发 `source.available`，envelope 带当前 Tool 的 `toolCallId` / `toolExecutionId` / `stepId`。非法 source 丢弃并写安全日志（只记 reason、toolName、执行 ID），不进 `modelText`、不产生审计记录、不影响 Tool 结果。
- [x] 将 Tool start/update/end 映射为安全 Tool 事实，Tool 参数和原始结果不进入 mapper 输出。
- [x] compaction 成功写入 Pi Session 后生成 `context.compacted` 事实，并带上 compaction Step 的 `stepId`。`runCompaction` 只在 `session.appendCompaction` 返回 entry 之后才调 `onCompacted`，`entryId` 用 entry 的真实 ID、`tokensBefore` 用 `compact()` 的返回值；executor 侧的 `onCompacted` 包了 try/catch，发事件失败不影响已写入的 compaction。entry 写入失败时没有 `context.compacted` 事实（`pi-agent-executor.test.ts`「pi compaction entry 写入失败…」）。
- [x] terminal 事件只由 Run Service 终态事务发布。

### 3.4 关联测试

- [x] 两轮模型调用和一次 Tool 的事件全部拥有正确 Run、Turn、Step、Model Call 和 Tool Execution 关联（`src/test/run-event-correlation.test.ts`，事件关联字段与 `ai_run_turns`/`ai_run_steps`/`ai_model_calls`/`ai_tool_executions` 逐行比对）。
- [x] 首个模型输出事件只发布一次，支持 text、thinking、tool-call 三类首输出。本批补齐 `model_call.started` / `first_output` / `completed` / `failed` 四个事件的生产：`pi-native-stream.ts` 产出 `PiModelCallFact`，executor 转成产品事件草稿。
- [x] message delta 合并后 sequence 连续，SQLite 行数不随 token 数线性增长（200 个 10 字节增量只落 `ceil(总字节/1KB)+1` 条以内，且合并后文本无损）。
- [x] Tool 失败、Tool timeout、模型失败、abort、max turns 和 compaction 结束后，`ai_run_turns`/`ai_run_steps`/`ai_model_calls`/`ai_tool_executions` 都没有 running 记录。
- [x] message part 顺序和文本/思考边界稳定。
- [x] 产品事件字段扫描不包含 arguments、raw result、system prompt、secret、raw provider error。

- [x] `step.started` / `step.completed` 成对出现，数量与 `ai_run_steps` 行数一致，`stepId`、kind、attempt 和 outcome 与库里逐行相等（`run-event-correlation.test.ts`「两轮模型调用加一次 compaction…」）；模型上游失败的 Run 的 `step.completed` 带 `outcome: failed` 和 `AI.UPSTREAM_ERROR`，与 `ai_run_steps.errorCode` 一致。
- [x] `source.available`：合法 source 发事件并落 `ai_run_events`，关联字段与 `ai_tool_executions` 行一致；`file:`、`http://127.0.0.1`、`http://169.254.169.254`、带 credential 的 URL 和缺字段的 source 全部被拒且 Tool 仍 `succeeded`、Run 仍 `completed`；工具不上报时没有该事件（`run-event-correlation.test.ts` 三个 source 用例）。
- [x] thinking display policy：`thinkingLevel: medium` 的 Run 的 thinking 事件 `display` 为 `true`、`summary` 完整、`ai_run_events` 里有正文，同时 telemetry span 和 `ai_model_calls` 都不含正文；`thinkingLevel: off` 的 Run 没有 thinking 事件，`message.completed.content` 只有正文文本。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/pi-agent-executor.test.ts src/test/pi-native-stream.test.ts src/test/pi-tool-adapter.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/run-event-publisher.test.ts src/test/run-event-correlation.test.ts --config vitest.config.ts
```

停点：关联测试和安全字段扫描通过后，才实现 SSE 恢复。

## 阶段 4：Timeline API 与 SSE 恢复

### 4.1 API 与 presenter

- [x] Timeline、Events 和 Trace 已分别由 `run-event.repository.ts`、`run-trace.repository.ts`、`run.service.ts` 和 `run.presenter.ts` 提供；对应 route、权限校验、OpenAPI 和下方各项测试均已完成。
- [x] 新增 `GET /runs/{runId}/timeline`，支持 `afterSequence`、pageSize 和 next cursor。
- [x] 新增 `GET /runs/{runId}/events`，返回安全的完整 RunEvent。
- [x] 新增 `GET /runs/{runId}/events/stream`，支持 `afterSequence` 和 `Last-Event-ID` 恢复已有 Run；POST Run SSE 只负责创建 Run，不因重连创建第二个 Run。
- [x] 新增 `GET /runs/{runId}/trace`，按 AI usage/admin 权限返回 Run Trace。
- [x] OpenAPI schema 直接引用 contracts DTO，不在 route 文件复制事件 union。
- [x] 所有读取先用 `RuntimeAccessContext` 查询 Session/Run scope，再读取事件。

### 4.2 恢复实现

- [x] 实现 `subscribeAndReplay`，订阅先于回放。
- [x] 记录持久 watermark，回放 `afterSequence < sequence <= watermark`。
- [x] 丢弃 live queue 中已经回放的 sequence，再发送后续事件。
- [x] terminal Run 回放 terminal event 后关闭连接。
- [x] heartbeat 使用 SSE comment，不生成产品事件。
- [x] 客户端断开只移除 subscriber，不调用 abort。
- [x] `Last-Event-ID` 查询不到时返回稳定请求错误，不猜测 sequence；恢复入口为已有 Run 的 GET SSE。

### 4.3 恢复测试

- [x] 中途断线后可以收到连续历史事件，再收到实时事件。
- [x] 查询与订阅之间发生新事件时不丢失、不重复；`run-event-recovery.test.ts` 在回放窗口注入事件并检查 sequence 连续、无重复。
- [x] 重连从最后一个 message delta、Tool progress 和 terminal event 正确继续；`run-event-recovery.test.ts` 分别使用对应 sequence 作为游标验证后续事件。
- [x] 进程重启后可以查询完整持久 Timeline；测试重建 runtime 后检查 Timeline、Run 终态和 `live: null`。
- [x] 非终态 Run 的恢复扫描可以根据 Pi `starter.run` 事实完成或标记失败；已有 `ai-agent-runs.test.ts` 覆盖合法 entry、无 entry、重复 entry、身份不匹配和 schema 失败。
- [x] 跨 Session、tenant、project、application、external user 和 subject 查询统一拒绝。
- [x] 长 Run 的 Timeline pageSize 受上限约束。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-agent-runs.test.ts src/test/run-event-recovery.test.ts src/test/run-trace.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/run-live-snapshot.test.ts --config vitest.config.ts
```

停点：断线恢复测试未通过时，不进入 Structured Output 和 Trace 细节优化。

## 阶段 5：Structured Output

### 5.1 Registry 与 Agent resolve

- [x] 新建 `apps/api/src/modules/ai/output/output-contract-registry.ts`。
- [x] 实现 `defineAiOutputContract`，检查 name、semver、Zod object schema、render kind、visibility、mode。
- [x] Agent resolve 通过 `{name, version}` 精确解析 Contract，不自动取最新版本。
- [x] Run snapshot 保存 resolved Contract 的 semver、schema hash、render kind 和 mode。
- [x] `Tool Registry` 拒绝业务 Tool 使用 `emit_structured_output`。

### 5.2 终止型 Tool

- [x] 新建 Structured Output Tool adapter。
- [x] 将 Zod schema 转为 Pi Tool parameters。
- [x] 执行时再次 `safeParse`，只把校验后的 value 写入 `ai_structured_outputs`。
- [x] 返回安全文本、结果引用和 `terminate: true`。
- [x] 发布 `structured_output.available`，产品端只收到允许的 value 或安全 reference。
- [x] 输出表写入失败时不发布成功事件，Run 进入存储失败。
- [x] `required` 没有成功输出时以稳定错误终止，`optional` 允许文本完成。

### 5.3 Structured Output 测试

- [x] 合法 Contract 输出的表记录、Pi custom entry、事件和 Trace 引用一致。
- [x] 非法参数不能写成功输出，也不能发布 available 事件，模型可以继续修正。
- [x] `terminate: true` 后没有多余 Model Call。
- [x] 产品可见和 admin 可见 Contract 的 value 投影符合权限。
- [x] Contract semver 和 schema hash 固定在 Run snapshot，不受 registry 后续注册影响。
- [x] unknown Contract、冲突 Tool 名、schema parse failure 和 persistence failure 都有稳定 Run 结果。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/structured-output.test.ts src/test/output-contract-registry.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/ai-agent-runs.test.ts --config vitest.config.ts
```

停点：合法、非法、required、optional 和 no-extra-model-call 测试全部通过后进入 Telemetry。

## 阶段 6：Telemetry

### 6.1 Schema 与 adapter

- [x] 在 `apps/api/src/infra/telemetry/` 定义 Starter span schema、attributes 和 `startAiSpan`。
- [x] 显式引入 Pi `TelemetryContext` 和 no-op context（catalog 和 `apps/api` 依赖声明 `@earendil-works/pi-telemetry@0.84.1`）。
- [x] 为测试提供 InMemory context，保存 span name、parent、start/end attributes、status 和错误（直接用 Pi 的 `InMemoryTelemetryContext`，不自建一套）。
- [x] 为异常的 telemetry 方法提供隔离 wrapper。
- [x] 不实现 exporter，不把 exporter 配置混入 Run snapshot 或业务 contract。

### 6.2 生命周期接入

- [x] Run Service 用 `starter.ai.run` 包住整个异步 Run 执行。
- [x] Executor 用 `starter.ai.turn` 包住 Turn。
- [x] 每次模型 attempt 用 `starter.ai.step`（assistant step 和 compaction step）。
- [x] Native stream 用 `starter.ai.model_call`，写入 modelCallId、provider、model、api、TTFT、chunk count、usage、cost 和 stop reason。
- [x] Tool adapter 用 `starter.ai.tool_execution`，写入 toolExecutionId、toolCallId、tool name/version、status、duration 和 retry/recovery 状态。
- [x] span parent 通过 callback 显式向下传递，不使用全局 ambient parent。
- [x] span failure 不改变 audit finalize、Tool result 或 Run terminal result。

### 6.3 Telemetry 测试

- [x] InMemory span 树为 Run -> Turn -> Step -> Model Call/Tool Execution。
- [x] span ID 与 SQLite 关联字段一致（Turn、Step、Model Call、Tool Execution 和 RunEvent）。
- [x] 正常完成、Tool 失败、模型 timeout、abort、storage failure 的 status/outcome 正确。
- [x] TTFT 只记录首个输出时刻，chunk count 与 stream update 数量一致。
- [x] attributes 不包含 prompt、message、reasoning、Tool args/result、secret 或 raw provider error。
- [x] 故障 TelemetryContext 不改变业务结果。

恢复扫描边界：

- `recoverInterrupted` 是 API 启动时的批量修复扫描，不属于某一次 Run 的 Agent 执行，因此不创建 `starter.ai.run` span；扫描结果通过 `RunRecoveryReport` 返回，恢复失败按既有 Run 状态和错误码记录。

已补齐：

- compaction 摘要请求的 model_call span 与审计注入解耦：`createInstrumentedModels` 现在无条件代理 `completeSimple`，`modelCallId` 在请求前生成，`audit` 只决定是否写 `ai_model_calls`。回归见 `ai-telemetry.test.ts`「compaction 摘要请求没有 audit 时仍产生 model_call span，parent 是 compaction step」。
- compaction 现在会写 `kind='compaction'` 的 `ai_run_steps` 记录，同一个 `stepId` 同时进 telemetry span、主库和 `context.compacted` 事件；成功、deferred 和失败都关闭该 Step。
- `PiEventMapper` 的 `turn_end` 不再硬编码 `succeeded`：先按 Pi `turn_end` 带的 assistant `stopReason` 判 succeeded / failed / aborted，再由 executor 用已记录的失败信号（Run deadline、Tool 终止失败、存储失败）覆盖，`turn.completed` 事件、`ai_run_turns`、`ai_run_steps` 和 span 用同一个值。Tool 失败不会把 Turn 记成 failed。

验证：

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-telemetry.test.ts src/test/pi-native-stream.test.ts src/test/pi-agent-executor.test.ts src/test/pi-tool-adapter.test.ts --config vitest.config.ts
```

停点：Telemetry span 树和故障隔离测试通过后进入最终检查。

## 阶段 7：最终检查与规格更新

### 7.1 定向检查

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
pnpm --filter @starter/api db:check
```

### 7.2 全仓检查，严格按顺序

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

前一项失败时只修当前任务引入的问题，再继续下一项。原有无关错误单独记录。

### 7.3 Trellis 检查

- [x] 运行 `trellis-check`，核对 PRD、design、implement、contracts、migration、事件恢复、Structured Output、Trace 和 Telemetry；初次复核发现 POST SSE 的 `Last-Event-ID` 会创建新 Run，已改为独立 GET `/events/stream` 恢复入口并补回归测试。最终复核代理因上游服务不可用未返回，代码和门禁已由主会话复核。
- [x] 用 `trellis-update-spec` 更新实际落地的 AI 系统、Run、Pi Executor、数据库、contracts 和 Web 消费规范：统一 RunEvent、Publisher sequence、持久 Timeline、GET `/events/stream` 恢复入口、0020 单列迁移和启动恢复边界。
- [x] 检查任务文档不包含过渡协议、协议选择参数或双路径实现；当前只保留 RunEvent、RunEventPublisher 和 `starter.run`，POST 创建流与 GET 恢复流的职责已明确。
- [x] 已展示改动摘要，等待用户明确确认后再执行 `git commit`；当前未提交。

## 风险文件

- `packages/contracts/src/ai.ts`：事件和 snapshot schema 是跨层唯一入口。
- `apps/api/src/modules/ai/ai.schema.ts`：新表、外键和 replacement migration。
- `apps/api/src/modules/ai/run/run.service.ts`：Run 终态、Publisher、恢复和事务顺序。
- `apps/api/src/modules/ai/run/run.repository.ts`：scope 查询和 terminal transaction。
- `apps/api/src/infra/agent/pi-event-mapper.ts`：Pi 事件到安全事实的唯一映射。
- `apps/api/src/infra/agent/agent-executor.ts`：Turn、Step、Structured Output 和 compaction 生命周期。
- `apps/api/src/infra/agent/pi-tool-adapter.ts`：Tool 参数校验、安全结果、审计和终止型 Tool。
- `apps/api/src/infra/ai/pi-native-stream.ts`：Model Call、TTFT、chunk、usage、cost 和错误首因。
- `apps/api/src/infra/telemetry/`：span schema、显式 parent 和故障隔离。
- `apps/api/src/modules/ai/run/run.route.ts`：SSE replay、Last-Event-ID、heartbeat 和权限边界。

## Review Gates

每阶段完成后检查：

1. contracts 是唯一公共 payload 定义位置。
2. 每个关联 ID 都在生命周期创建处生成，并一路传到事件、数据库和 span。
3. Publisher 是唯一的产品事件入口，所有 sequence 都能在数据库中恢复。
4. Run Timeline 是历史事实，live snapshot 只服务于运行中展示。
5. Structured Output 的值只来自服务端 Zod parse。
6. 产品事件、Timeline、Trace、audit 和 telemetry 都没有敏感数据。
7. 所有 running 的 Turn、Step、Model Call 和 Tool Execution 都有明确终态。
8. Telemetry 失败不改变 Agent、审计和 Run 终态。
9. 终态事务、SSE replay 和进程恢复测试覆盖同一套 fixture。
10. 文档与代码只保留新协议和新数据模型。
