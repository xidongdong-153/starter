# AI Run Webhook 终态推送 —— 执行清单

前置：`task.py start .trellis/tasks/08-28-ai-run-webhook` 已执行；子任务 remove-ai-pipeline 已归档。

## 步骤（顺序执行，每步可验证）

1. **契约**（`packages/contracts/src/ai.ts`、`common.ts`）
   - 按 design.md 第 8 节加全部 schema 与类型导出。
   - 错误码加 `AI_WEBHOOK_ENDPOINT_NOT_FOUND`。
   - 验证：`pnpm --filter @starter/contracts check-types`（或 pnpm check-types）。

2. **DB schema + migration**
   - `apps/api/src/modules/ai/ai.schema.ts` 加两张表（design.md 第 2 节）+ `aiAgentRuns` 加 `(finished_at)` 索引。
   - `pnpm --filter @starter/api db:generate`，核对 `0024_*.sql`：两张 CREATE TABLE、UNIQUE(endpoint_id, run_id)、三个索引、ai_agent_runs 的新索引。没有 DROP 语句。
   - 验证：`pnpm --filter @starter/api db:check`。

3. **webhook.crypto.ts**
   - `createWebhookCrypto(encodedKey)` → `{ available, encryptSecret(plain): string, decryptSecret(payload): string }`，格式 `v1.<iv>.<tag>.<ciphertext>`（base64url），AES-256-GCM。
   - `createWebhookSigningSecret()` → `wh_<43 chars>`。
   - 单元断言放进集成测试（加密→解密 roundtrip）。

4. **webhook.repository.ts**
   - 端点：`create`、`listByApp(appId)`、`findById`、`update`（url/status/updatedAt/updatedBy）、`replaceSecret`、`delete`、`touchLastDelivery(endpointId, now)`。
   - 投递：`insertDeliveryIgnore(...)`（ON CONFLICT DO NOTHING）、`listDue(limit, now)`（join enabled 端点，带 url 与 signing_secret_encrypted）、`markDelivered(id, now, responseCode)`、`markRetry(id, now, nextAttemptAt, responseCode, error)`、`markDead(id, now, responseCode, error)`、`listDeliveries(query)`（分页 + count）。
   - 补登：`listTerminalProductAppRunsAfter(watermark, limit)`。
   - 全部 better-sqlite3 同步 API，事务仅在需要原子处使用。

5. **webhook.dispatcher.ts**
   - `createAiWebhookDispatcher(deps)` → `{ start(), stop(), tick(): Promise<void> }`（tick 导出给测试）。
   - tick = enqueuePhase + deliverPhase，设计见 design.md 第 3、4 节。
   - `setInterval` 触发；`start()` 先 tick 一次再排程；`stop()` clearInterval 并置空。
   - 签名函数独立导出 `signWebhookPayload(secret, timestampSec, body): string` 供测试与 test 探测共用。
   - logger：warn 记投递失败（endpointId/runId/attempts/error），error 记 tick 异常。日志不落 secret 与 body。

6. **webhook.service.ts**
   - admin CRUD；URL 校验用 `urlGuard.assertAllowed(url)` 后存 `url.toString()`（或原串，保一致即可）。
   - key 不可用抛 `AppError(AI_CREDENTIAL_KEY_UNAVAILABLE, 500)`。
   - `testEndpoint`：同步走签名 + `urlGuard.fetch`，捕获异常转 `{ ok:false, responseCode:null, error }`。
   - 投递列表查询：appId 与 endpointId 二选一过滤（都给时按 endpointId）。

7. **webhook.openapi.ts + webhook.route.ts**
   - 按 design.md 第 6 节七个端点写 createRoute 与 handler，tag `AI Control`，错误响应用 `@api/openapi/responses.ts` 的既有 helper。
   - 响应码与 application 模块对齐（成功一律 200）。

8. **装配**（`ai.route.ts`、`create-runtime.ts`）
   - `env.ts` + `.env.example` 加五个变量（见 design.md 第 7 节）。
   - `ai.route.ts`：AI_WEBHOOK_ENABLED 时创建 crypto、dispatcher；dispatcher 挂到 runtime（`webhookDispatcher` 可选字段），`runtime.close()` 里 stop。service/route 无条件装配（CRUD 可用，投递不跑）。
   - 注意 `AiUrlGuard` 从 `@api/infra/ai/index.js` 导入 `createAiUrlGuard`。

9. **测试**（新文件 `apps/api/src/test/ai-webhook.test.ts`）
   - 复用 `createTestApp` + `ai-run-harness.ts` 的假 executor 流（参考 `ai-pipeline.test.ts` 删前实现——已删则参考 `ai-agent-runs.test.ts` 的 Bearer/假流模式）与 `ai-app-credentials.test.ts` 的 admin 权限准备。
   - 测试 env：`AI_WEBHOOK_ENABLED=true, AI_WEBHOOK_SWEEP_INTERVAL_MS=1000, AI_WEBHOOK_TIMEOUT_MS=2000, AI_WEBHOOK_MAX_ATTEMPTS=3, AI_WEBHOOK_BACKOFF_MS=0,100,100`。
   - 本地接收服务器：`node:http` createServer 挂 127.0.0.1 随机端口（test env 下 guard 放行 loopback）。
   - 用例清单（prd Acceptance Criteria 逐条）：
     1. CRUD：创建返回 secret 一次、列表无 secret、PATCH url/status、rotate、delete 后 404。
     2. 非法 URL 400（内网 IP、`ftp://`、带 user:pass）。
     3. 端到端：Bearer 启动 Run（JSON 模式）→ 等待接收服务器收到 POST → 验证 `X-Starter-Signature`（用返回的 secret 重算 HMAC 比对）→ payload 字段与 `GET /runs/{runId}` 一致 → admin 查 deliveries 变 delivered。
     4. 重试：接收服务器计数，前 2 次回 500、第 3 次 200 → 等待 delivered，attempts=3。
     5. 死信：恒 500 → 等待 dead（attempts=3=max）。
     6. 禁用端点：PATCH status=disabled → 跑一个 Run → 服务器无新请求、无 pending 记录。
     7. 补登：db 直插终态 Run 行（finished_at=now）→ 等一个 tick → 出现 delivery。
     8. 关闭开关：AI_WEBHOOK_ENABLED=false 的 app 实例 → 跑 Run → 无投递。
   - 等待统一用 `vi.waitFor`，超时 8 秒。
   - 每个用例 cleanup：关接收服务器、app.cleanup()。

10. **文档**（xdd-plain-docs 风格，无 emoji）
    - `docs/ai/integration.md` 新增「Webhook 终态推送」章节：前置（管理员开通）、配置端点、签名验证（curl/node 示例代码）、payload schema、重试与死信、补发规则、禁用语义；端点总表加 admin webhook 行。
    - `docs/ai/design.md`：调用方式表加 Webhook 行、模块职责表加 `webhook/` 行、新增小节概述 tick 模型。
    - `docs/ai/maintenance.md`：两张新表的数据表行 + 投递器运维要点（env、死信排查）。

11. **spec 更新**（Phase 3.3）
    - `.trellis/spec/api/backend/ai-system-design.md`：第 1 节系统承诺加 Webhook 一句、模块职责加 3.6 webhook、表清单加两行、OpenAPI 面分类 AI Control 加 webhook 端点。
    - 如有值得沉淀的实现契约（如「投递器不得进入 Run 终态事务」），追加到该文件设计约束节。

12. **验证**
    ```bash
    pnpm check
    pnpm test
    pnpm --filter @starter/api db:check
    pnpm build
    ```

13. **提交**（用户已授权）
    ```
    feat(api): add ai run webhook delivery
    ```
    文件范围：contracts 两文件、ai.schema.ts、新 migration、webhook 目录、env.ts、.env.example、create-runtime.ts、ai.route.ts、新测试、docs/ai/*、spec 更新、任务目录。

14. **归档**：`task.py archive`，单独 `chore(task): archive ai-run-webhook`。

## 回滚点

- 步骤 1-2（契约 + 表）：revert 单提交即可，无存量数据风险（新表空）。
- 功能开关默认 false：即使代码上线，未配置 env 的部署行为不变。

## 风险与预案

- drizzle-kit 对 `UNIQUE(endpoint_id, run_id)` 与普通索引组合的生成结果需人工核对；出现意外 DROP 立即停。
- `AiUrlGuard.fetch` 在 test env 放行 loopback（`appEnv !== 'production'`），测试服务器必须用 `127.0.0.1` 且不能跟 redirect（guard 拒绝 3xx）。
- better-sqlite3 同步调用在 tick 内批量执行：LIMIT 200/50 保证单 tick 有界；测试里 tick 间隔 1s 不会拖慢其他用例（webhook 测试独立 app 实例）。
