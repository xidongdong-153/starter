# 阶段C执行计划

## 步骤 1：契约与数据层

- [x] `packages/contracts/src/ai.ts`：`aiToolSideEffectSchema`、`agentRetryPolicySchema`（config 加可选字段）、`AiToolSummary.sideEffect`、manifest tools 加 sideEffect、RunEvent 可选 `attemptNo`、`runTraceSchema.attempts`。
- [x] `ai.schema.ts`：`ai_run_attempts` 新表 + `ai_agent_runs.current_attempt_no` + `ai_run_steps.attempt_no` + `ai_run_turns.attempt_no` + `ai_tool_executions.idempotency_token` + `turn_id` 放开 nullable。
- [x] `db:generate` 生成 migration，核对回填（attempt_no 列 DEFAULT 1、idempotency_token 存量 NULL），`db:migrate` 执行。

## 步骤 2：Tool 副作用与幂等 token

- [x] `tool-registry.ts`：`sideEffect` 必填进定义与注册结果；manifestHash 输入加 sideEffect；`read_skill` 补 `read_only`；全部测试 tool 定义补 sideEffect。
- [x] `pi-tool-adapter.ts`：审计行写 token（`sha256Hex(canonicalJson({ runId, attemptNo, toolExecutionId }))`）；`AiToolExecutionContext` 加 `idempotencyToken`；超时 modelText 按 sideEffect 分类措辞。

## 步骤 3：Attempt 生命周期

- [x] 新建 `run-attempt.repository.ts`：create、findByRunId、终态条件更新（running → 终态）。
- [x] `run-execution-context.ts` / executor：每次启动创建 `kind='agent'` 顶层 Step；`beginStep` / `beginTurn` 传当前 attempt_no。
- [x] `run.service.ts` startRun：run row 后 INSERT attempt 1（trigger=initial，owner+token 来自 lease）。
- [x] auto retry 循环：executor result 为 `upstream_failed` / `timed_out` 且 `attempt_no < retryPolicy.maxAttempts` 且 manifest 无 `non_idempotent_write` 时，attempt 行落 failed（retry_reason）、INSERT 下一 attempt、更新 run 行 current_attempt_no、重建 executor 继续；否则走现有 finalize。
- [x] 恢复扫描：interrupted 时 Attempt 行与 running Step 一并收尾。

## 步骤 4：可观测面

- [x] RunEventPublisher 发布事件带 `attemptNo`（从当前 Attempt 取）。
- [x] `run-trace.repository.ts` + trace presenter：attempts 列表。

## 步骤 5：测试

- [x] 新增 `ai-run-attempts.test.ts`：
  - invocation 重放返回同一 Run，无新 Attempt。
  - 模型失败 + maxAttempts=2：Attempt 2 创建、事件 attemptNo 变化、单一 terminal、两条 Attempt 与 agent Step 终态正确。
  - 不可重试错误（abort）不创建 Attempt 2。
  - manifest 含 non_idempotent_write 时失败不重试。
  - 重试上限耗尽落 failed。
  - 重试期间 lease 被接管：终态 interrupted（复用阶段 A 双 runtime 底座）。
  - agent Step 与 turn/step 的 attempt_no 断言。
  - tool 审计行 idempotencyToken 断言（非空、持久、纯函数重算相同）。
- [x] 单测：token 公式与超时措辞分类。
- [x] 全量回归（重点：pi-agent-executor、pi-tool-adapter、ai-agent-runs、ai-lane-lease、ai-resolved-manifest、ai-third-party-access）。

## 步骤 6：收尾

- [x] 验证命令全绿：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
pnpm --filter @starter/api db:check
pnpm check
```

- [x] trellis-check。
- [x] spec 更新（agent-run-guidelines：attempt 语义、副作用门禁、token 契约；pi-agent-execution-guidelines：agent Step 与 token 生成）。
- [x] 勾选调研任务 implement.md 阶段 C 条目；用户确认后提交。

## 回滚点

- 步骤 1-2 后：删表列与 sideEffect 字段（类型必填会让编译失败暴露全部定义点）。
- 步骤 3-4 后：短路 retry 判定（maxAttempts 视为 1）即可停 auto retry，再回滚 attempt 调度。
- Attempt / Step / token 历史数据保留，回滚无需清理。
