# API AI 运行时细节重构

## 目标

把 `apps/api` 的 Agent Run 重构成一个可查询、可恢复、可安全渲染的 AI Runtime。一次 Run 的外部事件、模型调用、工具执行、结构化输出和遥测都使用同一组运行 ID，客户端和管理侧读取同一条执行事实。

本任务直接替换当前 Run 事件协议、Run 事件发布路径、AI Run 相关数据库结构和执行关联方式。最终只保留本文定义的协议与数据模型。

## 用户价值

产品客户端可以按消息片段、推理片段、工具状态、来源、结构化结果和终态渲染一次 Agent 执行。连接中断后，客户端从持久时间线继续接收，不需要猜测缺失状态。

管理侧可以从一个 Run 进入 Turn、Step、Model Call 和 Tool Execution，查看每个执行单元的状态、耗时、用量、成本和错误类别。

## 技术基线

- Agent loop 使用 `@earendil-works/pi-agent-core`，模型流使用 `@earendil-works/pi-ai`。
- Pi Agent 已提供 `turn_start`、`turn_end`、消息流、Tool 生命周期、`prepareNextTurn`、`shouldStopAfterTurn` 和 `terminate` Tool result。
- Pi Session Store 保存 Session branch、message、Tool result、compaction 和 custom entry；Starter SQLite 保存业务索引与审计记录。
- `PiEventMapper` 是当前 Pi AgentEvent 到产品事件的集中转换点。
- 当前 `run.service.ts` 通过进程内有界队列和 live snapshot 发布事件，事件没有持久时间线。
- 当前 `ai_agent_runs`、`ai_model_calls`、`ai_tool_executions` 已存在，但 Run、Step、Model Call、Tool Execution 没有统一的生命周期关联。
- Pi telemetry 提供 `TelemetryContext.startSpan(options, callback)`、类型化 span schema、`pi.harness.run/turn/step/tool` 和 `pi.ai.request` 的设计。
- 课程文章明确区分 UI 消息和模型消息，使用事件流表达文本、reasoning、Tool、source 和 step；结构化输出使用 Zod schema；多步 Agent 使用 step 生命周期；Telemetry 记录模型、用量、延迟、工具和错误分类。

## 产品要求

### R1：单一 RunEvent 协议

定义 `RunEvent` 作为唯一的外部运行事件协议。每个事件都带统一 envelope：

- `eventId`
- `sequence`
- `occurredAt`
- `runId`
- `sessionId`
- `lane`
- `turnIndex`
- `stepId`
- `modelCallId`
- `messageId`
- `toolCallId`
- `toolExecutionId`

不把 Pi AgentEvent、Provider payload、system prompt、Tool 参数、原始 Tool 结果、Provider secret 或未脱敏错误放进产品事件。

事件至少覆盖：

- `run.started`、`run.completed`、`run.failed`、`run.aborted`
- `turn.started`、`turn.completed`
- `step.started`、`step.completed`
- `model_call.started`、`model_call.first_output`、`model_call.completed`、`model_call.failed`
- `message.started`、`message.delta`、`message.completed`
- `thinking.started`、`thinking.delta`、`thinking.completed`
- `tool.started`、`tool.progress`、`tool.completed`
- `context.compacted`
- `structured_output.available`
- `source.available`

事件的 data 只放展示和查询所需的安全字段。文本增量按时间或字节合并后发布，持久化事件不会按 Provider token 数量无限增长。

### R2：持久时间线与 SSE 恢复

Run Event Publisher 是所有产品事件的唯一入口。事件经过 schema 校验、分配 sequence、写入时间线、更新 live snapshot 后进入 SSE 队列。

API 提供：

- 创建 Run 并打开实时 SSE。
- 查询 Run 状态与 live snapshot。
- 按 `afterSequence` 查询 Run 时间线。
- 通过 `Last-Event-ID` 或 `afterSequence` 打开 Run SSE 恢复流。
- 恢复时先建立实时订阅，再回放持久事件，按 sequence 丢弃重复事件，随后继续发送新事件。
- 进程重启后可以查询已写入的时间线；非终态 Run 按 Pi Session 的运行事实执行恢复扫描。

持久化失败时不得把事件继续发送给客户端。终态事件和 Run 终态更新必须在同一数据库事务中完成；实时 delta 的合并写入也必须保留连续 sequence。

### R3：Step、Model Call、Tool Execution 关联

一次 Run 的执行结构为：

```text
Run -> Turn -> Step -> Model Call
                    -> Tool Execution
```

- Run 创建 `runId`，并创建 Run telemetry span。
- 每个 Agent loop 轮次创建 `turnIndex` 和 Turn span。
- 每个模型执行尝试创建 `stepId`、`attempt` 和 Step span。
- 每次 Provider 请求创建 `modelCallId`，该 ID 同时写入模型审计和模型事件。
- 每次 Tool 调用使用 Pi 的 `toolCallId`，并创建 `toolExecutionId`，该 ID 同时写入 Tool 审计、Tool 事件和 Tool span。
- 重试、超时、取消、Tool 失败、模型失败、compaction 和 Run 终态都必须关闭对应的执行记录。

### R4：Structured Output

服务端注册 Output Contract，Contract 具备：

- 稳定名称。
- semver 版本。
- Zod object schema。
- 安全可见范围。
- `plan`、`table`、`scorecard`、`decision`、`form` 或 `json` 渲染类型。
- `optional` 或 `required` 输出模式。

Agent 配置可以声明 Output Contract 引用。Run 启动时解析 Contract，并把名称、semver、schema hash 和渲染类型写入 Run snapshot。

Runtime 注入内部 `emit_structured_output` Tool：

1. 模型按 Contract schema 发起 Tool call。
2. Server adapter 用同一个 Zod schema重新校验参数。
3. 校验成功后写入结构化结果表。
4. 生成安全 Tool result，设置 `terminate: true`。
5. 发布 `structured_output.available`。
6. Run 不再触发多余的模型调用。

非法结构化参数只能产生稳定的 Tool 错误，不能发布成功事件。`required` 模式没有成功结构化结果时，Run 失败；`optional` 模式可以使用普通文本完成。

### R5：Telemetry

提供 API 自己的 `TelemetryContext` 注入边界，底层使用 Pi telemetry 的 callback span 模型。

Telemetry 必须记录：

- Run、Session、lane、request、tenant、project、application 和 external user 的非敏感 ID。
- Turn index。
- Step kind、attempt、outcome。
- Provider、model、API、response model、response ID、HTTP status、stop reason。
- TTFT、总耗时、chunk count、token usage、reasoning usage、cost。
- Tool name、精确版本、toolCallId、toolExecutionId、耗时、结果状态、重试或恢复状态。

Telemetry 不得记录 prompt、message content、reasoning 正文、Tool 参数、Tool 原始结果、secret 或 Provider 原始错误。Telemetry span 创建、属性写入、状态结束和 exporter 上报失败，都不能改变 Agent 执行、SQLite 审计和 Run 终态。

## 范围

包含：

- `packages/contracts/src/ai.ts` 的 RunEvent、Run Timeline、Run Trace、Output Contract 和 Agent snapshot schema。
- `apps/api` 的 Run Event Publisher、持久时间线、SSE 恢复、Step 生命周期、Structured Output registry/Tool、Run Trace API 和 telemetry port。
- AI Run、Model Call、Tool Execution、Structured Output 的新 Drizzle schema 和 migration。
- Repository、service、presenter、OpenAPI 和 smoke tests。
- `test-fixtures/` 中的两轮模型调用、一次 Tool、一次 Structured Output 的完整执行样本。
- `/Users/wuwanzhu/Code/pi` 的源码阅读结果转成 Starter 应用层实现，不修改 Pi 源码。

## 不包含

- Vercel AI SDK、LangGraph、MCP 或其他新的 Agent 编排框架。
- 把 Vercel AI SDK 的 `UIMessage`、`ModelMessage` 或 `toUIMessageStreamResponse` 直接引入 API Runtime。
- 任意调用方上传并执行 JSON Schema。
- 向产品端返回完整 system prompt、原始 Tool 参数、原始 Tool 结果、Provider payload 或敏感 reasoning。
- 每个 Provider token 直接写一条 SQLite 记录。
- OpenTelemetry、Langfuse 等 exporter 的生产部署。
- Admin Run Trace 的图形化页面。

## 验收标准

- [ ] `RunEvent` 的每个事件都能通过 Zod 解析，统一 envelope 和关联 ID 完整。
- [ ] 一次至少两轮模型调用和一次 Tool 的 Run，可以按 sequence 回放，并通过 `runId`、`turnIndex`、`stepId`、`modelCallId`、`toolCallId`、`toolExecutionId` 串成完整关系。
- [ ] SSE 中途断开后，以 `afterSequence` 或 `Last-Event-ID` 恢复时，事件连续、不重复、不跳号，并能继续接收实时事件。
- [ ] 进程重启后，已持久化的 Run 时间线、Run 状态、Model Call 和 Tool Execution 可以查询。
- [ ] 事件持久化失败不会发送产生空洞的事件，终态事务不会发布半完成结果。
- [ ] Structured Output 只能使用已注册 Contract；非法参数没有成功事件，合法值能写入数据库并发布 `structured_output.available`。
- [ ] `emit_structured_output` 的 `terminate: true` 使 Agent 直接结束，不产生额外模型调用。
- [ ] `required` 和 `optional` 输出模式的 Run 终态符合定义，Contract 的 semver 和 schema hash 写入 snapshot。
- [ ] Telemetry 形成 Run -> Turn -> Step -> Model Call/Tool Execution 的父子树，且记录终态、耗时、TTFT、chunk count、usage 和 cost。
- [ ] Telemetry 故障不会改变模型结果、Tool 结果、审计记录或 Run 终态。
- [ ] 产品事件、Run Timeline、Run Trace 和 SQLite 审计均不包含禁止数据。
- [ ] 按顺序通过 `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm --filter @starter/api db:check` 和 `git diff --check`。

## 已确定的关键决策

- 产品事件只保留一套 `RunEvent`，不提供事件协议切换参数。
- 外部事件采用 Starter 自己的消息片段模型，参考课程中的 UI parts 分层，不直接采用 Vercel AI SDK 的消息协议。
- Pi Agent loop、Pi Session 和 Tool 安全边界继续由 Pi 与现有 adapter 负责；Starter 只增加关联、投影、持久查询和结构化输出边界。
- Structured Output 使用 Pi 已支持的终止型 Tool，不实现自由文本 JSON 抽取。
- Run Event Timeline 是恢复事实；live snapshot 只用于运行中快速渲染，不承担历史恢复。
- SQLite audit 与 Telemetry 分开。Audit 服务于持久查询，Telemetry 服务于时序和 tracing exporter。

## 风险与处理

- 事件写入量可能增加：delta 在 Publisher 内合并，生命周期事件和完成快照单独持久化，并建立 `(run_id, sequence)` 索引。
- 异步 span 容易提前结束：只使用 `TelemetryContext.startSpan` 的 callback 作用域，把完整异步执行包在 callback 内。
- 结构化 Contract 变化会影响模型参数：Run snapshot 保存 Contract semver 和 schema hash，运行中只使用启动时解析出的不可变 Contract。
- Run 终态、Pi custom entry 和事件终态可能分离：统一由 Run Service 的终态事务方法完成，并增加故障路径测试。

## 阻塞问题

无。本文、`design.md` 和 `implement.md` 审核通过后进入实施阶段。
