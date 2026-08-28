# AI Agent 流水线编排

## Goal

新增流水线（pipeline）能力：管理员预注册一个顺序步骤列表（每步引用一个 AgentDefinition），调用方用一条 `pipelineId + input` 请求触发整条流水线，服务端顺序执行每一步的 Agent Run，把上一步的产出渲染进下一步的输入，直到最后一步完成或某步失败。

目标场景：

- "先提取要点，再翻译，最后生成摘要"这类固定多步工作流，一次调用拿到最终结果。
- 调用方（含 product_app）不再需要自己轮询 Run 终态、读输出、拼下一步输入。
- 每一步的完整执行记录（transcript、审计、事件）保留在现有 Run 体系里，流水线只多一层编排索引。

## 已确认事实（2026-08-28 代码走读）

- `startRun`（`apps/api/src/modules/ai/run/run.service.ts` L204）是 Run 的唯一创建入口，入参 `access + sessionId + input + requestId`，负责 Session 校验、agent 解析、lane reserve、Run 行创建、executor 挂载和事件队列。pipeline 步骤执行直接复用它。
- `ai_agent_runs`（`apps/api/src/modules/ai/ai.schema.ts` L427）强绑 `sessionId` 外键（cascade delete），Run 无法脱离 Session 存在。
- `agentService.resolve(id, access)`（`apps/api/src/modules/ai/agent/agent.service.ts` L266）把 AgentDefinition 展开成 `ResolvedAgentDefinition`（model、systemPrompt、skills、tools、outputContract、thinkingLevel、maxTurns），含权限与状态校验。步骤引用 agent 的解析复用它。
- 结构化输出已完整落库：`ai_structured_outputs` 表 + `listByRun(runId)` / `findByIds(ids)` 读取路径（`apps/api/src/modules/ai/output/structured-output.repository.ts`）。
- `ActiveRunRegistry` 保证单进程内同一 `sessionId + lane` 同时只有一个 active Run；`startRun` 冲突时抛 409 `AI.SESSION_BUSY`。
- Run 终态在 `ai_agent_runs.status`（CHECK 约束六值：starting / running / completed / failed / aborted / interrupted），进程重启有 `recoverInterrupted()` 扫描。
- Session 建表带 principal 约束（`ai_agent_sessions_principal_check`）：starter_user 行必须有 ownerId 无 appId，product_app 行反之；`accessWhere` 是可见范围唯一判据。
- Run 的 JSON 启动模式（Accept 分流）刚落地，S2S 轮询模式（`GET /runs/{runId}` + live 快照）已验证可用，pipeline runner 步骤间等待可直接用内部等价物。

## Requirements

### R1 Pipeline 定义（控制面）

- 新表 `ai_pipeline_definitions`：名称（唯一）、描述、状态（draft / enabled / disabled）、revision、步骤列表 JSON、创建 / 更新人与时间戳。对齐 `ai_agent_definitions` 的治理形态。
- 步骤列表每步含：`agentId`（引用 enabled 的 AgentDefinition）、`inputTemplate`（模板字符串）、可选 `laneLabel`（仅用于 transcript 展示，非 lane 本身）。
- Admin CRUD API：`GET / POST /api/ai/admin/pipelines`、`GET / PATCH /api/ai/admin/pipelines/{id}`、状态切换端点，鉴权 `requireAuth` + `AI_CONFIG_MANAGE`（读用 `AI_CONFIG_READ`）。行为对齐 AgentDefinition 路由族（revision 递增、config 校验）。
- 定义校验：至少一步；每步 agentId 存在且状态处理在启动时校验（定义时允许引用 draft agent，启动时解析失败则该步骤失败）；`inputTemplate` 引用的变量必须在执行时可用。

### R2 模板变量（步骤间数据传递）

- 两个内置变量：`{{input}}`（整条流水线的原始输入）、`{{steps.N.output}}`（第 N 步的产出，从 0 计）。
- 步骤产出提取规则：优先取该步 Run 的结构化输出 value（JSON 序列化为字符串注入）；无结构化输出时取 assistant 最终文本。
- 未定义变量渲染失败：该步骤 Run 不启动，流水线进入 failed，错误码指向具体步骤与变量名。
- 模板不做条件、循环、过滤器：纯字符串替换（`{{...}}` 字面量匹配），需要逻辑就写进 Agent 的 prompt。

### R3 Pipeline Run（运行面）

- 新表 `ai_pipeline_runs`：id、pipelineId、pipelineRevision（快照语义对齐 Run 的 snapshot）、principal / scope 列（对齐 `ai_agent_sessions` 的归属列族）、状态、步骤执行明细 JSON、输入、最终产出、errorCode、时间戳。
- 启动端点 `POST /api/ai/pipelines/{pipelineId}/runs`，body `{ input }`，鉴权 `requireRuntimePrincipal`。响应 JSON `{ runId }`（pipeline run id），调用方轮询。
- 查询端点 `GET /api/ai/pipeline-runs/{id}`：返回状态、步骤明细（每步的 agentId、agentRevision、runId、状态、产出摘要）、最终产出。可见性走与 Session 相同的 principal / scope 归属判据，他人资源 404。
- Abort 端点 `POST /api/ai/pipeline-runs/{id}/abort`：abort 当前正在执行的步骤 Run，后续步骤不启动，流水线进入 aborted。
- 状态机：`pending → running → completed | failed | aborted`；步骤失败即整条 failed（fail fast），已完成步骤的产出保留在明细里。

### R4 执行模型

- 一次 pipeline run 创建一个专用 Agent Session（归属发起的 principal / scope，标题自动生成），步骤依次在该 Session 上执行：每步一个 Run、串行、lane 命名 `pipeline-<i>`（关键决策见文末），共享 Session transcript。
- 每步 Run 走完整现有生命周期：事件落库、模型审计（scenario 沿用 `agent_run`）、结构化输出、失败终态。
- 进程重启恢复：pipeline 层启动扫描把 running 行全部转 `failed + AI.RUN_INTERRUPTED`，不自动续跑；步骤 Run 本身由现有 Run recovery 处理。
- 单 pipeline run 不设总时长上限以外的新限制；每步受 `maxRunMs` 约束（现状 120000 ms）。

### R5 契约与文档

- `packages/contracts/src/ai.ts` 新增 pipeline 定义 DTO、pipeline run DTO、启动 / 查询 / abort 请求响应 schema。
- OpenAPI 归入 `AI Runtime`（运行面）与 `AI Control`（admin CRUD）tag。
- `.trellis/spec/api/backend/ai-system-design.md`、`docs/ai/` 同步更新编排语义与新表。

## Acceptance Criteria

- [ ] Admin 能创建含两步的 pipeline 定义（步骤 1 摘要 Agent、步骤 2 翻译 Agent，步骤 2 的 `inputTemplate` 引用 `{{steps.0.output}}`），revision 从 1 递增。
- [ ] `POST /api/ai/pipelines/{id}/runs` 返回 pipeline runId；轮询 `GET /api/ai/pipeline-runs/{id}` 到 completed，最终产出为步骤 2 的文本；每步明细含对应 Agent Run 的 runId 且可独立查询 transcript。
- [ ] 步骤 1 失败（Agent 配置无效或模型失败）时整条 pipeline 为 failed，步骤 2 未启动，步骤 1 的 Run 终态为 failed。
- [ ] 模板静态校验：步骤 0 引用 `{{steps.0.output}}`（自引用）或 `{{steps.5.output}}`（越界）时定义保存被拒（400），错误信息含步骤序号与变量名。
- [ ] Abort 进行中的 pipeline run：当前步骤 Run 变 aborted，pipeline 为 aborted，后续步骤无 Run。
- [ ] product_app（Bearer + `X-AI-*` 头）能启动和查询自己的 pipeline run；跨 principal 访问 404。
- [ ] 每步产生独立 `ai_model_calls`（scenario 仍为 `agent_run`，带各自 runId）；pipeline 本身不产生额外模型调用。
- [ ] migration（两张新表）后 `pnpm --filter @starter/api db:check` 干净；`pnpm check` + `pnpm test` 全绿，新增 smoke test 覆盖以上断言。

## 明确不做

- 条件分支、并行步骤、DAG（父任务已定）。
- 运行时临时内联步骤（只接受预注册 pipelineId）。
- pipeline 级 SSE 事件流（MVP 用 JSON 轮询；步骤内部的 SSE 消费不受影响，调用方拿步骤 runId 可自行订阅）。
- 定时触发、webhook 回调、配额（父任务边界）。
- 跨 Session 的流水线（一次 pipeline run 绑定一个专用 Session）。

## 关键决策记录

| 决策 | 结论 | 依据 |
| --- | --- | --- |
| 步骤 lane 命名 | `pipeline-<i>` 分 lane | transcript 按步骤分支，产出提取按 lane 精确读取，不与用户在 main lane 的内容混流；`ensureLane` 已幂等 |
| 进程重启处置 | running 行全部转 `failed + AI.RUN_INTERRUPTED`，不续跑 | 续跑要求编排循环可从任意步骤重入，复杂度远超收益；已完成步骤明细保留，调用方重新发起即可 |
| 模板转义 | 替换结果不再扫描，不二次展开 | 防模型输出注入模板指令 |
| 模板校验时机 | 定义保存时静态校验（步骤 i 只能引用 `steps.<i-1>` 及更早） | 运行时渲染只剩纯替换，没有失败模式 |
| 步骤产出提取 | 结构化输出 value 优先（JSON 序列化），assistant 文本兜底（readTranscript 按 lane + runId 过滤） | 结构化输出带 schema 校验，是推荐的步骤间契约 |
| 步骤等待终态 | 迭代 events 直到 terminal，结束后读 Run 行终态兑底 | 事件队列溢出自关闭时 terminal 可能丢失，Run 行是唯一持久事实 |
| 步骤明细存储 | `steps_state_json` 列，不建第三张表 | 步骤最多 8 条、无独立查询需求，对齐 `snapshotJson` 先例 |
| 状态机 | 五值：running / completed / failed / aborted（创建即 running，无 pending 中间态） | pending 只在崩溃窗口有语义价值，恢复策略统一抹平 |
| DTO 步骤产出 | 截断 1000 字符 + 省略标记，`finalOutput` 全量 | 最坏 8 步全量可达 800KB；全量事实在 transcript（runId 可查） |
