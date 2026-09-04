# API Webhook 子域规范

改 `apps/api/src/modules/ai/webhook/`、`ai_webhook_endpoints` / `ai_webhook_deliveries` 表、webhook 相关环境变量或 `webhookRunTerminalPayloadSchema` 时按本规范。Run 本身的生命周期见 `agent-run-guidelines.md`。

## 1. Scope / Trigger

- 新增或改动 webhook 的 route、service、repository、dispatcher、presenter 或 OpenAPI。
- 修改投递 payload schema、签名算法、claim 协议或重试策略。
- 修改 `AI_WEBHOOK_*` 环境变量。
- 不需要本规范：只读改动 Run 生命周期（见 `agent-run-guidelines.md`）。

## 2. Signatures

```ts
// webhook.dispatcher.ts
function createAiWebhookDispatcher(deps: {
  db: AppDatabase
  crypto: WebhookCrypto
  urlGuard: { fetch: typeof fetch }
  logger: Logger
  settings: { sweepIntervalMs: number; maxAttempts: number; backoffMs: readonly number[] }
}): AiWebhookDispatcher
```

Repository 方法（`webhook.repository.ts`）：`listEndpointsByApp` / `listEnabledEndpoints` / `insertDeliveryIgnore` / `claimDueDeliveries` / `markDelivered` / `markRetry` / `markDead` / `touchLastDelivery`。

Route：`/api/ai/admin/webhook-endpoints`（CRUD + rotate + test）、`/api/ai/admin/webhook-deliveries`（分页查询），全部挂 `requireAuth`；列表与投递记录查询挂 `AI_CONFIG_READ`，写操作（create/update/rotate/delete/test）挂 `AI_CONFIG_MANAGE`。

## 3. Contracts

职责边界（不可违反）：

- Webhook 投递器不进 Run 终态事务，不订阅 RunService 事件，不读写 Pi Session；它只扫 `ai_agent_runs` 并从 `ai_run_events` 读 terminal 事件标识。
- 进程重启后内存游标归零，漏发的终态 Run 按同一规则补扫；端点创建之前和禁用窗口内结束的 Run 永不补发。
- 总开关 `AI_WEBHOOK_ENABLED` 默认 false；关闭时管理面 CRUD 仍可用。

端点管理面：

- 端点 CRUD、signing secret 的 AES-256-GCM 加解密（key 复用 `AI_CREDENTIAL_ENCRYPTION_KEY`）、连通性 test 探测、投递记录查询。
- secret 只在创建和 rotate 的响应里返回一次，列表 DTO 不携带。

补登扫描（周期 tick，`AI_WEBHOOK_SWEEP_INTERVAL_MS` 默认 5 秒）：

- 扫描对象是终态 `product_app` Run，游标是复合键 `(finished_at, run_id)`（严格大于；同 `finished_at` 超过单批上限时继续扫下一批不跳过）。
- 入队不早于端点 `created_at`；`(endpoint_id, run_id)` 唯一约束保证幂等。
- 入队时 leftJoin `ai_run_events` 取 terminal 事件的 `eventId` / `sequence` 写入 delivery 行；`eventProtocolVersion` 统一写 contracts 常量 `AI_EVENT_PROTOCOL_VERSION`（当前 1）。

投递 DTO（`aiWebhookDeliverySchema`）：

- `eventId`（uuid nullable）、`sequence`（int min 1 nullable）来自 terminal RunEvent；interrupted Run 无 terminal 事件行时两列为 null。
- `eventProtocolVersion` 引用同一常量，nullable；按 migration 实际写入值投影。
- 投递记录查询响应与 `ai_webhook_deliveries` 行值一致，不携带 secret。

多实例投递互斥：

- `claimDueDeliveries` 用条件 UPDATE（`status='pending'` 且 claim 未过期）领取 delivery，TTL `DELIVERY_CLAIM_TTL_MS = 60s`（代码常量）。
- `AI_WEBHOOK_TIMEOUT_MS` 默认 10s，上限 30000ms 在 `parseEnv` 校验（超过启动失败）：超时配得比 claim TTL 长会出现 claim 过期被重领的合法重复 POST。
- `markDelivered` / `markRetry` / `markDead` 清 claim 两列。
- 协议是 at-least-once，接收方按 `X-Starter-Delivery-Id` 请求头去重。

出站请求与重试：

- 出站请求全部走 `AiUrlGuard.fetch`；`AiUrlGuardError` 属配置性失败（URL 变内网、不可达、被重定向），直接置 `dead` 不重试。
- 重试退避与最大次数由 `AI_WEBHOOK_BACKOFF_MS`、`AI_WEBHOOK_MAX_ATTEMPTS` 控制，超限置 `dead`；无手工重投。
- 请求头：`Content-Type: application/json`、`User-Agent: starter-webhook/1`、`X-Starter-Event`、`X-Starter-Timestamp`、`X-Starter-Signature`（HMAC-SHA256）、`X-Starter-Delivery-Id`。

Payload（`webhookRunTerminalPayloadSchema`）：

- `run.terminal` 事件：appId、runId、sessionId、eventId / sequence（interrupted 为 null）、eventProtocolVersion、lane、agentId、agentRevision、status、errorCode、finishedAt、occurredAt。
- 不携带 endpointId、transcript 正文和身份字段；secret 不进 payload、日志和列表 DTO。

表结构：

| 表 | 保存内容 | 不保存内容 |
| --- | --- | --- |
| `ai_webhook_endpoints` | 端点 URL、所属 app、加密 signing secret、enabled/disabled、最后投递时间 | secret 明文 |
| `ai_webhook_deliveries` | 端点、Run、payload 快照、terminal 事件的 eventId/sequence/协议版本、claim 与过期时间、状态、尝试次数、下次尝试时间、最近响应码和错误 | secret；payload 不含正文和身份字段 |

## 4. Validation & Error Matrix

| 条件 | 行为 |
| --- | --- |
| `AI_WEBHOOK_TIMEOUT_MS` 超过 30000 | 启动失败，错误信息指明上限与 claim TTL 的安全边界 |
| 出站 URL 被 `AiUrlGuard` 拒绝 | 直接置 `dead`，不重试 |
| 出站 HTTP 非 2xx | 按 `AI_WEBHOOK_BACKOFF_MS` 退避重试，达 `AI_WEBHOOK_MAX_ATTEMPTS` 置 `dead` |
| claim 过期（timeout 大于 TTL 的旧配置或接管） | 其他实例合法重领，接收方按 `X-Starter-Delivery-Id` 去重 |
| 端点 disabled 窗口内 Run 终态 | 不入队；重新启用后按补扫规则处理启用窗口内的终态 Run |
| `AI_WEBHOOK_ENABLED=false` | dispatcher 不启动，管理面 CRUD 仍可用 |

## 5. Good / Base / Bad Cases

- Good：tick 先补登终态 Run 再投递到期 pending 记录；同 `(endpoint_id, run_id)` 重复 tick 只产生一条 delivery。
- Good：payload 的 eventId/sequence 与 `ai_run_events` terminal 行一致；请求头带稳定投递 ID 供接收方幂等去重。
- Base：同 `finished_at` 超过单批上限 200 条时继续扫下一批，不跳过记录。
- Bad：把投递逻辑挂进 Run 终态事务或订阅 RunService 事件发布路径——终态推送只依赖周期扫描。
- Bad：扫描游标退回单列 `finished_at` 水位——同时间戳超批会跳过记录。

## 6. Tests Required

`apps/api/src/test/ai-webhook.test.ts` 覆盖：

- payload 的 eventId/sequence 与 `ai_run_events` terminal 行一致；interrupted Run（无 terminal 事件行）两列 null。
- 投递记录查询响应含 eventId / sequence / eventProtocolVersion 三字段，与 `ai_webhook_deliveries` 行值一致；interrupted Run 的两列为 null、协议版本为 1。
- 同 `finished_at` 201 条不漏（`(finishedAt, runId)` 复合游标）；重复扫描不重复建 delivery。
- 双 dispatcher claim 互斥与过期重领；请求头带 `X-Starter-Delivery-Id`。
- 端点禁用窗口内终态的 Run 不入队；重新启用后补扫启用窗口内的终态 Run。
- 签名可按文档公式验证；guard 拒绝直接死信；重试达上限置 dead（attempts、lastResponseCode 断言）。

## 7. Wrong vs Correct

### Wrong：投递进 Run 终态事务

```ts
// run.service.ts 终态事务里同步投递 webhook
await db.transaction(async (tx) => {
  await completeWithTerminalEvent(...)
  await deliverWebhook(...) // Run 终态被第三方端点的可用性拖挂
})
```

### Correct：周期扫描补登

```ts
// webhook.dispatcher.ts 独立于 Run 生命周期
const runs = repository.listTerminalProductAppRunsAfter(cursor, ENQUEUE_BATCH_LIMIT)
for (const run of runs) repository.insertDeliveryIgnore({ ... }) // (endpoint_id, run_id) 唯一
```

### Wrong：单列水位游标

```ts
where(gt(aiAgentRuns.finishedAt, lastFinishedAt)) // 同一秒 201 条时下一批全部跳过
```

### Correct：复合游标

```ts
where(
  or(
    gt(aiAgentRuns.finishedAt, cursor.finishedAt),
    and(eq(aiAgentRuns.finishedAt, cursor.finishedAt), gt(aiAgentRuns.id, cursor.runId)),
  ),
)
```
