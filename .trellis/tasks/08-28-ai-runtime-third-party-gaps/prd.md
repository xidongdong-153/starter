# 修复 AI 运行面第三方接入缺口

## Goal

让第三方（product_app，Bearer + `X-AI-External-User-Id` 等头）能完整消费 AI 运行面：能直连（CORS）、能发现 Agent、能用非流式方式启动 Run、能读到结构化输出（含历史会话回放），并修掉 SSE 恢复流的心跳缺陷。

上一轮代码走读确认的缺口（修复顺序，也是验收顺序）：

| 序号 | 缺口 | 严重度 | 处理 |
| --- | --- | --- | --- |
| G1 | `events/stream` 心跳写字面量 `\n` 而非真实换行，保活帧无效 | 缺陷 | 本任务修 |
| G2 | CORS `allowHeaders` 缺 `authorization` / `x-ai-*` / `last-event-id`，第三方浏览器端 preflight 必挂 | 硬阻断 | 本任务修 |
| G3 | Agent 公共列表/详情走 starter user cookie 鉴权，product_app 无法发现 agentId | 硬阻断 | 本任务修 |
| G4 | `ai_structured_outputs` 无任何读取路由，`structured_output.available` 的 referenceId 无法解析 | 能力缺口 | 本任务修 |
| G5 | transcript 不含结构化输出，历史会话渲染需要按 run 再拉 timeline（两跳） | 渲染缺口 | 本任务修 |
| G6 | `POST /runs` 只返回 SSE，runId 只能从事件流取；不消费流的 S2S 集成没有 JSON 启动模式 | 集成缺口 | 本任务修 |

明确不做（后续单独任务，不在本任务偷做）：

- 客户端 SDK / reducer 共享包（把 `apps/web/lib/ai` 的折叠逻辑抽成包，结构性重构，影响 web，单独设计）。
- webhook / 回调（需要重试与签名等产品决策）。
- 每应用限流 / 配额（需要配额模型决策）。
- AppError message i18n、RunEvent envelope 版本字段（协议演进，暂不动）。

## Requirements

### R1 心跳修复（G1）

- `apps/api/src/modules/ai/run/run.route.ts` 第 126 行 `": heartbeat\\n\\n"` 改为真实换行 `": heartbeat\n\n"`，与第 58 行创建流的写法一致。
- 不改心跳间隔（15s）、不加配置项。

### R2 CORS 头白名单（G2）

- `apps/api/src/middleware/cors.middleware.ts` 的 `allowHeaders` 增补：`authorization`、`last-event-id`、`x-ai-external-user-id`、`x-ai-subject-type`、`x-ai-subject-id`，保留现有 `content-type`、`x-request-id`。
- `allowMethods`、`credentials`、`origin`（环境变量控制）不动。
- 第三方接入方的 origin 仍需运维在 `CORS_ORIGINS` 配置，这一点写进接口说明（`apps/api/.env.example` 注释），不在代码里放开 origin。

### R3 Agent 公共发现对 product_app 开放（G3）

- `GET /api/ai/agents`（listPublic）与 `GET /api/ai/agents/{agentId}`（getPublic）改挂 `requireRuntimePrincipal`：cookie 用户与 Bearer product_app 都能访问。
- 只返回 `status=enabled` 的 summary（现状语义不变：name、description、status、revision、时间戳，不含 config）。
- Admin 面（listAdmin/getAdmin/CRUD/工具列表）鉴权不变：`requireAuth` + `requireRead` / `requireManage`。
- OpenAPI：运行面路由（sessions、runs、agents 公共两个）的 `security` 从仅 `cookieAuth` 扩为 `[{ cookieAuth }, { bearerAuth }]`，并注册 `bearerAuth` security scheme。

### R4 结构化输出读取路由（G4）

- 新增运行面路由 `GET /api/ai/sessions/{sessionId}/runs/{runId}/structured-outputs`，`requireRuntimePrincipal` 鉴权，沿用 `requireScopedRun` 的 session+run 归属校验。
- 响应 `items`：每条含 `referenceId`、`contract`（AiOutputContractRef）、`createdAt`、`value`。
- 可见性规则与 `structured_output.available` 事件一致：`visibility=product` 返回 value；`visibility=admin` 返回 `value: null`。
- 新增 admin 路由 `GET /api/ai/admin/runs/{runId}/structured-outputs`，`requireAuth` + `AI_CONFIG_READ` 权限，返回全部输出且 value 不打码（admin 可见性只有 admin 能读）。
- contract 已从代码注册表中移除（resolve 不到）的记录：不返回该条（registry 是渲染元数据的唯一来源），记 WARN 日志。

### R5 Transcript 结构化输出回放（G5）

- contracts：`agentTranscriptToolActivitySchema` 增加可选字段 `structuredOutput: { contract: AiOutputContractRef, value: Record<string, unknown> | null, referenceId: string }`。
- presenter 从 toolResult entry 的 `details.structuredOutputId`（UUID 校验）识别结构化输出工具调用；session service 按页批量取回输出后由 presenter 注入到对应 tool_activity item。
- 可见性规则同 R4：product → value，admin → null；contract resolve 不到 → 该 item 不带 `structuredOutput` 字段（tool_activity 本身保留）。
- 返回结构对现有消费方纯增量（可选字段），web 无需改动。

### R6 Run JSON 启动模式（G6）

- `POST /api/ai/sessions/{sessionId}/runs` 按请求 `Accept` 分流：显式含 `application/json` 且不含 `text/event-stream` 时返回 JSON `{ ok, data: { runId }, meta }`，不订阅事件流；否则维持 SSE（含 Accept 缺省的 `*/*`，向后兼容）。
- JSON 模式下 Run 照常执行，客户端用 `GET /runs/{runId}`（含 live 快照）+ timeline 轮询。
- OpenAPI 该路由的 200 响应增加 `application/json` 内容类型与 DTO。

## Acceptance Criteria

全部满足才算完成：

- [ ] G1：`run.route.ts` 两处心跳写入均为真实换行；`grep -n 'heartbeat' run.route.ts` 只剩一种写法。
- [ ] G2：新增 smoke 断言——OPTIONS 预检带 `Access-Control-Request-Headers: authorization, x-ai-external-user-id`，响应的 `Access-Control-Allow-Headers` 覆盖全部运行面所需头。
- [ ] G3：product_app（Bearer + X-AI 头）能 `GET /api/ai/agents` 列出 enabled agent、能按 id 取详情；未携带合法 Bearer 时 401；admin 路由行为不变。
- [ ] G4：带 outputContract 的 Run 完成后，runtime 路由能列出结构化输出，product 可见性含 value、admin 可见性 value 为 null；admin 路由能读到 admin 可见性的 value；跨 scope（他人 session/run）404。
- [ ] G5：同一条 Run 的 transcript 中，`emit_structured_output` 的 tool_activity item 携带 `structuredOutput`（product 可见性含 value）；admin 可见性 value 为 null；无输出的 tool item 不带该字段。
- [ ] G6：`Accept: application/json` 启动 Run 返回 200 JSON 且含 `runId`；随后 `GET /runs/{runId}` 能轮询到 completed；`Accept: text/event-stream` 行为与现状完全一致。
- [ ] OpenAPI `/doc` 中 bearerAuth scheme 存在，运行面路由声明了两种安全方式。
- [ ] 质量门全部通过：`pnpm check`（类型 / lint / format）+ `pnpm test`（api smoke tests 全绿）。
- [ ] `.trellis/spec/api/backend/agent-run-guidelines.md` 等规范文档按新增路由与可见性规则更新（见 implement.md 收尾步骤）。

## Constraints

- 不改事件协议既有字段语义，只做纯增量（新可选字段、新路由）。
- 不新增数据库表、不加 migration（`ai_structured_outputs` 已有字段够用；可见性从代码注册表 resolve）。
- 不动 web / admin 前端代码；contracts 变化必须保持对现有消费方向后兼容（可选字段）。
- 错误响应沿用统一 `{ ok, error, meta }` 与既有 error code（`COMMON.NOT_FOUND` 等），不新造错误码。
