# AI Run Webhook 终态推送

## Goal

第三方应用（product_app）可以为自己的 Run 配置 Webhook 端点；Run 进入终态（completed / failed / aborted / interrupted）后，API 用 HTTP POST 推送终态事件，带 HMAC-SHA256 签名，失败按退避重试，超限进死信，全程可查询投递记录。第三方从此不用长挂 SSE 或轮询来获知 Run 结束。

## Requirements

### 管理面（admin，AI_CONFIG_READ / AI_CONFIG_MANAGE）

1. Webhook 端点 CRUD：
   - `POST /api/ai/admin/webhook-endpoints`：body `{ appId, url }`。创建时生成签名 secret，只在本次响应返回一次。URL 必须通过出站安全检查（http/https、拒绝内网/metadata/带凭据 URL，production 要求公网 https；复用 `AiUrlGuard.assertAllowed`）。
   - `GET /api/ai/admin/webhook-endpoints?appId=`：列表（不含 secret）。
   - `PATCH /api/ai/admin/webhook-endpoints/{endpointId}`：body `{ url?, status? }`，status 取 `enabled | disabled`。
   - `POST /api/ai/admin/webhook-endpoints/{endpointId}/rotate`：换新 secret，响应返回一次。
   - `DELETE /api/ai/admin/webhook-endpoints/{endpointId}`：删除端点，投递记录级联删除。
2. 投递记录查询：`GET /api/ai/admin/webhook-deliveries?endpointId=&status=&page=&pageSize=`，分页返回投递状态、尝试次数、下次尝试时间、最近响应码/错误。
3. 连通性测试：`POST /api/ai/admin/webhook-endpoints/{endpointId}/test`：同步发一条 `webhook.test` 探测请求（不写投递记录），返回 `{ ok, responseCode, error }`。
4. 一个 app 允许多个端点；只有 `enabled` 的端点会入队和投递。

### 推送面

5. 推送时机：Run 终态后由周期扫描补登（默认每 5 秒一个 tick，环境变量可调）。不侵入 `run.service` 的终态事务路径。
6. 入队规则（补登）：`ai_agent_runs` 中 `principal_kind = 'product_app'`、`app_id` 非空、终态、`finished_at` 大于扫描水位且不早于端点 `created_at` 的 Run，为该 app 每个 enabled 端点写一条投递记录；`(endpoint_id, run_id)` 唯一，重复入队幂等。进程重启后水位从 0 开始，按同一规则补发漏掉的终态 Run（端点创建之前的 Run 不补）。
7. 推送 payload（`run.terminal`）：`{ type, appId, endpointId 不含, runId, sessionId, lane, agentId, agentRevision, status, errorCode, finishedAt, occurredAt }`。不含 transcript、输入输出正文、用户身份、secret。
8. 签名：`X-Starter-Signature: t=<unix秒>,v1=<hex>`，`v1 = HMAC-SHA256("<t>." + body, signingSecret)`；另带 `X-Starter-Event: run.terminal`、`X-Starter-Timestamp`。验证方需重算并比对，且拒绝过旧时间戳（建议容忍 5 分钟）。
9. 投递判定：HTTP 2xx 为成功；3xx 视为失败（guard 已拒绝跟随重定向）；网络错误、超时、4xx、5xx 为失败。`AiUrlGuardError`（URL 变成内网/不可达等配置性问题）直接进死信，不重试。
10. 重试：默认最多 5 次，退避默认 `0s, 30s, 2m, 10m, 30m`（环境变量 `AI_WEBHOOK_BACKOFF_MS` 覆盖，逗号分隔；次数不足时重复末位）。超限置 `dead`。
11. 总开关：`AI_WEBHOOK_ENABLED`（默认 false）。关闭时不扫描、不投递；管理面 CRUD 仍可用。
12. 出站请求统一走 `AiUrlGuard.fetch`（DNS pin、内网拒绝、重定向拒绝、响应体上限、超时），防 SSRF。

### 契约与文档

13. `packages/contracts/src/ai.ts` 新增：端点 DTO、创建/更新输入、一次性 secret DTO、投递记录 DTO、查询 schema、`webhookRunTerminalPayloadSchema`（第三方验证 payload 用）、test 结果 DTO；`common.ts` 新增错误码 `AI_WEBHOOK_ENDPOINT_NOT_FOUND`。
14. `docs/ai/integration.md` 新增 Webhook 章节：配置步骤、签名验证代码示例、重试与死信语义、补发规则；`design.md`/`maintenance.md` 同步模块与表说明。

## Acceptance Criteria

- [ ] admin CRUD 全链路 smoke test：创建（secret 只返回一次、列表不含 secret）、改 URL/状态、rotate、删除。
- [ ] 非法 URL（内网、错误 scheme、带凭据）创建返回 400。
- [ ] 端到端：本地 HTTP 服务器收 Run 终态推送，签名可按文档公式验证，payload 与 Run 终态一致，投递记录转 `delivered`。
- [ ] 重试：前两次 500 第三次 200，投递记录 attempts=3 最终 delivered。
- [ ] 死信：持续 5xx 到达最大次数后 `dead`，不再尝试。
- [ ] 禁用端点不产生投递；重新启用后只投递新终态 Run（禁用窗口内结束的 Run 不补发）。
- [ ] 补登：直接向 `ai_agent_runs` 插一条终态 Run 行（finished_at 晚于端点创建），等待一个 tick 后出现对应投递记录（模拟进程崩溃漏发）。
- [ ] `AI_WEBHOOK_ENABLED=false` 时无任何投递行为。
- [ ] `pnpm check`、`pnpm test`、`pnpm --filter @starter/api db:check` 全绿；新 migration 只建新表和索引。

## 约束

- 不改 `run.service.ts`、`run.repository.ts`、SSE、事件发布路径——本任务零接触 Run 执行内核。
- signing secret 用 `AI_CREDENTIAL_ENCRYPTION_KEY` 做 AES-256-GCM 加密存储；key 未配置时创建/rotate 端点返回 `AI.CREDENTIAL_KEY_UNAVAILABLE`（复用既有错误码）。
- 单进程内投递（无外部队列）；扫描和投递是同步 better-sqlite3 调用 + 有限并发，不引入新依赖。
- OpenAPI 归 `AI Control` tag；运行面不新增任何端点。
