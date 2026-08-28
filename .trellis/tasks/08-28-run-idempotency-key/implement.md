# startRun 幂等键 —— 执行清单

前置：`task.py start .trellis/tasks/08-28-run-idempotency-key` 已执行；前两个子任务已归档。

## 步骤

1. **契约**
   - `packages/contracts/src/ai.ts`：`startAgentRunSchema` 加 `idempotencyKey`（prd 定义）；`startAgentRunRoute` 所在 `run.openapi.ts` 的 description 补幂等说明。
   - `packages/contracts/src/common.ts`：加 `AI_IDEMPOTENCY_KEY_CONFLICT`。
   - 验证：`pnpm --filter @starter/contracts check-types`。

2. **DB schema + migration**
   - `ai.schema.ts`：`aiAgentRuns` 加 `idempotencyKey`、`idempotencyScope` 可空 text 列 + 部分唯一索引（`.where(sql\`idempotency_key IS NOT NULL\`)`）。
   - `pnpm --filter @starter/api db:generate`；核对 `0025_*.sql`：两条 ALTER TABLE + 一条 CREATE UNIQUE INDEX（带 WHERE）。drizzle-kit 生成不出 WHERE 时手工补该条语句并同步 snapshot meta，其余照生成。
   - 验证：`pnpm --filter @starter/api db:check`。

3. **repository**（`run.repository.ts`）
   - `AiAgentRunCreateInput` 加两个可选字段；`create` values 带上。
   - 加 `findByIdempotencyKey(scope, key)`。

4. **service**（`run.service.ts`）
   - 私有 `idempotencyScopeOf(access)`（design.md 第 2 节）。
   - `startRun` 插入预检查分支与 create catch 的唯一约束分支（design.md 第 3、5 节）；Replay 返回 `{ runId, events }` 与首启同构（events 用与首启相同的方式构造——直接复用 `subscribe(access, sessionId, existing.id, 0)` 返回的 iterable）。
   - 注意 Replay 分支也要走 `requireScopedRun` 同等权限（existing 记录本身来自 scope 查询，天然满足；不额外查 session）。

5. **测试**（新文件 `apps/api/src/test/ai-run-idempotency.test.ts`）
   - 底座复用 `ai-run-harness.ts`（假流 executor）+ `createTestApp`；Bearer 场景参考 `ai-third-party-access.test.ts`。
   - 用例（prd Acceptance 逐条）：
     1. JSON 同 key 同 session 两次 → 同 runId；db 查 `ai_agent_runs` 计数 = 1。
     2. 同 key 异 session → 409 `AI.IDEMPOTENCY_KEY_CONFLICT`。
     3. 挂住 streamFn 让 Run 停在 running；同 key 重试 → 同 runId（200，不是 409 busy）。
     4. busy 不消费 key：Run A（无 key）占 main lane；带 key K 请求 main lane → 409 busy；A 终态后同 K 请求 → 新 Run，行里 idempotency_key=K。
     5. 两个 product_app 凭据同 key 各自启动 → 两个不同 runId，均成功。
     6. 带 key 的 Run 跑到 failed（假流抛错）→ 同 key 重试 → 同 runId，状态仍 failed，行数不变。
     7. key 非法（7 字符、含 `#`）→ 400。
     8. SSE 模式：JSON 启动带 key，等终态后同 key 再启动（Accept: text/event-stream）→ 收到完整事件流且以 terminal 事件结束，runId 一致。
   - 验证：`pnpm --filter @starter/api exec vitest run src/test/ai-run-idempotency.test.ts --config vitest.config.ts`。

6. **文档**
   - `docs/ai/integration.md`：「幂等重试」小节（design.md 第 6 节要点），放在 Run 启动章节之后。
   - `docs/ai/design.md`：Run 输入说明处补 idempotencyKey 一句。

7. **spec 更新**（Phase 3.3）
   - `.trellis/spec/api/backend/agent-run-guidelines.md`：Contracts 节补幂等键存储与语义一行；Validation & Error Matrix 加 409 行。
   - `.trellis/spec/api/backend/ai-system-design.md`：4.1 输入阶段补幂等检查顺序。

8. **验证**
   ```bash
   pnpm check
   pnpm test
   pnpm --filter @starter/api db:check
   pnpm build
   ```

9. **提交**（用户已授权）
   ```
   feat(api): add idempotency key to agent run start
   ```
   文件范围：contracts 两文件、run.openapi.ts、ai.schema.ts、migration 0025、run.repository.ts、run.service.ts、新测试、docs/ai/*、spec 两文件、任务目录。

10. **归档**：`task.py archive`，单独 `chore(task): archive run-idempotency-key`。

## 回滚点

- 单提交 revert 即可；两列可空、索引部分，对不带 key 的调用零影响。

## 风险与预案

- drizzle-kit 部分索引生成不确定 → 已定预案：只手工补那一条语句。
- Replay 的 events iterable 与 route SSE 分支的交互：subscribe 对终态 Run 回放持久事件后自然结束，已有 `replayAndSubscribe` 覆盖，不写新逻辑。
- ai-agent-runs.test.ts 既有用例不能回归（尤其 busy/409 顺序）。
