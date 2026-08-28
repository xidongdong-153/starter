# 一次性无状态 AI 调用端点

## Goal

新增运行面端点 `POST /api/ai/completions`：调用方直接指定模型（和可选的 system prompt）加一段输入，同步拿到单轮模型结果。不建 Agent Session、不建 Agent Run、不写 Pi 历史，只走 Gateway、模型白名单和用量审计。

目标场景：

- 翻译一句话、分类一段文本、改写一个标题这类单轮任务。
- 产品后端（product_app 凭据）在业务流程里嵌入一次模型调用，不想为每次调用维护 Session。
- 成本从"建 Session → 启动 Run → 读 transcript"三次调用降为一次调用。

## 已确认事实（2026-08-28 代码走读）

以下事实来自源码，设计时直接引用，不需要重新确认：

- `AiGatewayInput`（`apps/api/src/infra/ai/ai-gateway.types.ts` L54-L64）原生支持 `model`、`systemPrompt`、`messages`、`tools`、`timeoutMs`、`signal`。不传 `tools` 就是纯文本单轮调用。
- `createAiInvocationRunner`（`apps/api/src/modules/ai/usage-audit/usage-audit.service.ts` L323-L405）已经把 Gateway 流和 `ai_model_calls` 审计的 begin / finalize 封装成 `stream(context, input)`，含超时收敛、失败分类、abort 归因。无状态调用直接复用它，只换 scenario。
- `prepareTest`（`apps/api/src/modules/ai/configuration/configuration.service.ts`）是同类原型：模型直选或用户偏好、单条 user message、无工具、SSE 输出、scenario 为 `model_test`。它证明"裸 Gateway + 审计"路径已经跑通。
- `ai_model_calls.scenario` 有 CHECK 约束 `IN ('model_test', 'agent_run', 'legacy')`（`apps/api/src/modules/ai/ai.schema.ts` L675-L676）。新增 scenario 值需要一次 migration（历史上已经用 migration 改过该约束：`0011_normal_sentinel.sql` → `0015_orange_nemesis.sql`）。
- 模型白名单判据是 `ai_enabled_models` 表（`apps/api/src/modules/ai/ai.schema.ts` L168），`isModelAllowed` 是现有校验入口。
- 运行面统一鉴权中间件 `requireRuntimePrincipal`（`apps/api/src/modules/ai/principal.guard.ts`）已经同时接受 starter_user cookie 和 product_app Bearer + `X-AI-*` 头，返回 `RuntimeAccessContext`（`apps/api/src/modules/ai/principal.ts` L17）。
- `Accept` 分流模式刚在 Run 启动落地（`apps/api/src/modules/ai/run/run.route.ts`，含 `application/json` 且不含 `text/event-stream` 走 JSON，其余走 SSE），代码路径成熟，可直接复用到本端点。
- 请求超时统一走 `runtime.env.AI_REQUEST_TIMEOUT_MS`。

## Requirements

### R1 端点与鉴权

- 新增 `POST /api/ai/completions`，挂 `requireRuntimePrincipal`：starter_user 和 product_app 都能调用。
- OpenAPI 归入 `AI Runtime` tag，security 声明 `[{ cookieAuth }, { bearerAuth }]`。

### R2 请求形态（已收敛：模型直选 + 可选内联 systemPrompt，不引用 agent）

请求体（`completionRequestSchema`，strictObject）：

- `model`：`{ providerId, modelId }` 模型引用，必填。必须在 `ai_enabled_models` 白名单内，否则 403 `AI.MODEL_NOT_ALLOWED`。
- `systemPrompt`：可选，trim 后 1 到 32000 字符。指令由调用方自带（翻译 / 分类指令天然属于调用方）。
- `input`：必填，trim 后 1 到 100000 字符（对齐 `agentRunInputTextSchema` 的边界）。

不引用 `agentId`：Agent 的本义是带工具的循环，skill 注入依赖 `read_skill` 工具，无状态调用无工具时 skill 无意义；要复用完整 Agent 配置就走 Agent Run。治理边界靠模型白名单（与 `/api/ai/test` 的 `prepareTest` 同一判据）。

### R3 响应形态

- `Accept: application/json`（不含 `text/event-stream`）：同步等待模型完成，返回 `{ ok, data, meta }`，data 含 `content`（完整文本）、`stopReason`、`usage`（读不到时省略，不补 0）。
- 其余 Accept（含缺省、`*/*`、`text/event-stream`）：SSE 流式返回 `text_delta` 和 `done` 事件，事件形状对齐 `/api/ai/test` 的现有流（`AiTestStreamEvent` 家族），不新造第二套事件协议。
- 上游失败、超时、abort 沿用 Gateway 与 `AiGatewayError` 的错误分类，走统一 `{ ok, error, meta }`。

### R4 审计

- `ai_model_calls.scenario` 新增值 `completion`，需要 migration 修改 CHECK 约束。
- 审计上下文带 requestId、principal（starter_user 的 userId 或 product_app 的 appId + externalUserId）、scope、模型、耗时、token、cost、结果。
- 不写 `ai_run_events`、不写 `ai_agent_runs`、不写 Pi Session SQLite。

### R5 边界行为

- 无工具调用：请求不带 tools，模型不会返回 `tool_use`；万一上游异常返回 tool_use，按上游错误处理（对齐 `prepareTest` 的现有行为）。
- 超时：单请求受 `AI_REQUEST_TIMEOUT_MS` 控制，超时返回上游超时错误码。
- 无限流 / 配额（父任务已定不做）。

## Acceptance Criteria

- [ ] starter_user（cookie）和 product_app（Bearer + `X-AI-External-User-Id`）都能 `POST /api/ai/completions` 拿到结果。
- [ ] `Accept: application/json` 返回 200，data 含完整 `content` 与 `usage`；`Accept: text/event-stream` 收到 `text_delta` 序列和 `done` 终止事件。
- [ ] 请求白名单外模型返回 403 `AI.MODEL_NOT_ALLOWED`；input 超长返回 400。
- [ ] 调用后主库新增一条 `ai_model_calls`，`scenario='completion'`，含 token / cost / 结果；`ai_agent_sessions`、`ai_agent_runs`、`ai_run_events` 无新增行；Pi Session SQLite 无新写入。
- [ ] migration 落地后 `pnpm --filter @starter/api db:check` 干净，既有 `model_test` / `agent_run` / `legacy` 数据不受影响。
- [ ] 质量门：`pnpm check` + `pnpm test` 全绿，新增 smoke test 覆盖上述断言（复用 `apps/api/src/test/helpers.ts` 的 `createTestApp` / `readSuccess` 与 `ai-third-party-access.test.ts` 的 Bearer 客户端模式）。

## 明确不做

- 工具调用（无状态 = 无工具，要工具就走 Agent Run）。
- 多轮对话（要上下文就走 Session）。
- 结构化输出 / JSON mode（调用方在 systemPrompt 里自行约定 JSON 格式并自行解析；后续需要服务端校验再单独立任务）。
- `agentId` 引用（见 R2 收敛理由）。
- 客户端 SDK、限流配额、webhook（父任务边界）。
- `/api/ai/test` 的改造或删除（它是管理面的连通性测试，scenario 和受众都不同，保留现状）。

## 关键决策记录

| 决策 | 结论 | 依据 |
| --- | --- | --- |
| 请求形态 | model 直选 + 可选 systemPrompt，不引用 agent | 2026-08-28 用户选定方案 A；`prepareTest` 已证明平台接受"用户自带 prompt + 白名单模型" |
| 结构化输出 | 不做 | 单轮无工具下 JSON 保证手段有限（无 provider JSON mode 支持，`AiGatewayInput` 无 responseFormat 字段），调用方自行解析够用 |
| SSE 事件 | 新定义 `completionStreamEventSchema`，字段同构 `aiTestStreamEventSchema` 但独立命名 | OpenAPI 组件名要表达 Runtime 语义，不与 model_test 的流协议耦合 |
