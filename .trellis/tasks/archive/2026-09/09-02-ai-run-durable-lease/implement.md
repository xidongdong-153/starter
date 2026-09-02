# 阶段A执行计划

## 步骤 1：数据层

- [x] `ai.schema.ts` 新增 `ai_agent_lane_leases` 表（主键 session_id+lane，字段见 design.md 第 2 节）。
- [x] `ai_agent_runs` 增加 `execution_fencing_token` 列（integer，可空以兼容历史行）。
- [x] `pnpm --filter @starter/api db:generate` 生成 migration，人工检查 SQL 与设计一致。（0028_tan_meggan.sql）
- [x] `pnpm --filter @starter/api db:migrate` 执行。

## 步骤 2：lane lease 模块

- [x] 新建 `apps/api/src/modules/ai/run/lane-lease.ts`：`LEASE_TTL_MS = 90_000`、`RENEW_INTERVAL_MS = 30_000` 常量与 acquire/renew/release 函数。
- [x] acquire 用单事务：先条件 INSERT，冲突后条件 UPDATE 过期行；均不命中返回 busy 结果（不抛异常，由调用方映射 `AI.SESSION_BUSY`）。
- [x] renew/release 返回受影响行数，0 表示失去所有权。
- [x] 单元级验证：直接用内存 SQLite 测三种条件更新路径（插入、过期接管、busy）。

## 步骤 3：Run Service 接入

- [x] `startRun`：入口 `await readiness`；内存 registry 快速检查 → db acquire → 写 run row（含 fencing token）→ attach → 启动续租定时器。
- [x] 终态路径（正常终态、abort、错误收尾）：先做终态事务（含 token 校验），成功后 db release + registry release + clear 定时器，统一放现有 finally 段。
- [x] 续租定时器回调：renew 失败 → 调用 executor 现有 abort 路径，不发明新错误码。
- [x] `recoverInterrupted` 扩展：恢复扫描后清理对应 lane 的过期 lease；`ai.services.ts` 暴露 `readiness: Promise<void>`。

## 步骤 4：终态 fencing 校验

- [x] `run.repository.ts` 终态事务：读取 lease 行比对 `owner_id + fencing_token` 与 run row；不一致时终态写 `AI.RUN_INTERRUPTED`（丢弃实际结果），一致时正常提交。
- [x] 确认该事务仍是单事务（与现有 Run row 终态写入同一事务内）。

## 步骤 5：测试

- [x] `ai-run-harness.ts` 支持双 runtime：相同 db 路径、不同 `APP_INSTANCE_ID`。（Pi store 共享实例，见 progress.md 决策 1）
- [x] 新建 `ai-lane-lease.test.ts`，覆盖 design.md 第 7 节七个用例。
- [x] 全量回归：`ai-agent-runs`、`active-run-registry`、`ai-run-idempotency`、`ai-cross-product-runtime`、`pi-agent-executor`、`ai-third-party-access`。

## 步骤 6：收尾

- [ ] 验证命令全绿：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
pnpm --filter @starter/api db:check
```

- [x] 质量门禁已按 trellis-check 同口径执行（check-types / lint / format:check / test / db:check 全绿）；trellis-check 子代理由主会话派发。
- [x] 更新 `.trellis/spec/api/backend/agent-run-guidelines.md`：lane 排他语义、fencing、readiness 门禁。
- [x] 回到调研任务 `implement.md` 勾选阶段 A 条目。
- [ ] 改动摘要给用户确认后提交。

## 回滚点

- 步骤 1-2 后：删除 migration 与新模块即可。
- 步骤 3-4 后：`run.service.ts` / `run.repository.ts` 还原为纯 registry 排他；保留数据表（历史 token 数据无害）但代码不再读取。
- 回滚不允许保留内存与数据库同时决定执行权的中间态。
