# startRun 幂等键

## Goal

`POST /api/ai/sessions/{sessionId}/runs` 接受可选 `idempotencyKey`。同一调用方 scope 内，相同 key 的重复启动返回既有 Run 而不是创建新 Run。第三方在超时、网络故障后可以安全重试，不会产生重复执行。

## Requirements

1. 契约：`startAgentRunSchema` 加 `idempotencyKey?: string`，trim 后 8-128 字符，字符集 `[A-Za-z0-9._:-]`；`common.ts` 新增错误码 `AI_IDEMPOTENCY_KEY_CONFLICT`。响应契约不变（JSON 模式仍返回 `{ runId }`，SSE 模式回放既有事件流）。
2. 语义（按优先级）：
   - 同 scope + 同 key + 同 sessionId：返回既有 Run 的 runId；SSE 模式从 sequence 0 回放该 Run 事件（终态 Run 回放完整事件后正常结束）。
   - 同 scope + 同 key + 不同 sessionId：409 `AI.IDEMPOTENCY_KEY_CONFLICT`。
   - 不同 scope（不同 app / 不同用户）使用相同 key：互不相关，各自创建自己的 Run。
   - key 只在 Run 行创建成功后被消费：`AI.SESSION_BUSY`（lane 占用）、schema 校验失败、Session/Agent 不存在等启动前失败不消费 key，之后同 key 重试会创建新 Run。
   - Run 已 failed 后同 key 重试：返回那个 failed Run（不自动重新执行；真要重跑换新 key）。
3. 存储：`ai_agent_runs` 加 `idempotency_key TEXT NULL`、`idempotency_scope TEXT NULL`；部分唯一索引 `UNIQUE (idempotency_scope, idempotency_key) WHERE idempotency_key IS NOT NULL`。
4. scope 字符串：`kind|tenantId|projectId|principalId|externalUserId|subjectType|subjectId`（空值用空串），由 `RuntimeAccessContext` 计算，语义与 Session 可见性判据一致——同一调用方身份下 key 全局唯一，不同调用方互不冲突。
5. 并发：两个同 key 请求竞争时（better-sqlite3 单写者），后插者命中唯一约束，释放 lane 租约后按既有 Run 返回。
6. OpenAPI：`startAgentRunRoute` 请求 schema 自然带上新字段（引用同一 contracts schema），描述里写明幂等语义；`docs/ai/integration.md` 加幂等重试章节。

## Acceptance Criteria

- [ ] JSON 模式：同 key 同 session 两次启动返回同一 runId，`ai_agent_runs` 只多一行。
- [ ] 同 key 不同 session：409 `AI.IDEMPOTENCY_KEY_CONFLICT`。
- [ ] Run 运行中同 key 重试：返回同一 runId（不因 lane busy 409）。
- [ ] lane busy 不消费 key：同 lane 先占（无 key），带 key 请求得 409；占端结束后同 key 再请求创建新 Run。
- [ ] scope 隔离：两个不同 product_app（或 app 与 starter 用户）同 key 各自独立成 Run。
- [ ] failed Run + 同 key：返回既有 failed runId，不新建。
- [ ] 非法 key（过短、非法字符）：400 `COMMON.INVALID_REQUEST`。
- [ ] SSE 模式幂等回放：同 key 第二次启动收到完整事件流且以 terminal 事件收尾（若已终态）。
- [ ] `pnpm check`、`pnpm test`、`pnpm --filter @starter/api db:check` 全绿；migration 只加两列和部分唯一索引。

## 约束

- 不改变 startRun 既有步骤顺序（reserve → create → prepare → attach → markRunning → run.started）；幂等检查插在 reserve 之前，唯一约束兜底插在 create 的 catch 里。
- 幂等键不做过期清理：Run 行在，key 就在；不做 TTL。
- 不给 abort/steer/follow-up 加幂等（它们本身幂等或无害重复）。
