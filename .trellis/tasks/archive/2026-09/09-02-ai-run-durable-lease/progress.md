# 阶段A实施进度（implement agent 工作记录）

按 `.trellis/tasks/09-02-ai-run-durable-lease/implement.md` 步骤 1-6 执行。

## 关键决策（与 design.md 的偏差在此记录）

1. 双 runtime 测试共享同一个 `AgentSessionStore` 实例（而非各自打开同一文件）：
   Pi SQLite backend 对同一 session 只允许一个写者（open 时抛 already has an active writer，
   30s TTL 持续心跳），两个 repository 各自打开同一文件时"不同 lane 不互斥"和"A 终态后
   B 可启动"都会在 Pi open 处失败。Starter 主库（lease 权威）仍由两个 runtime 各自的连接共享。
2. 恢复扫描的过期 lease 清理放在扫描末尾单独执行（非与终态写入同事务）：
   删除条件带 `lease_until < now`，并发接管只会把行换成未过期新行，条件删除不会误删；
   避免把 lease 表操作耦合进 run repository 的终态事务。
3. 终态 fencing 校验只在执行路径生效：`completeWithTerminalEvent` 增加可选 `lease.ownerId`，
   传入时校验 lease 行 owner + token + 未过期，失配强制 interrupted；恢复扫描路径不传，
   保持投影语义（历史行 execution_fencing_token 为 NULL 也跳过校验）。
4. readiness 注入：`createAiAgentRunService` 新增可选 `readiness` promise（默认 resolved），
   ai.services 用 deferred 传入并在 recoverInterrupted 完成后 resolve（失败也 resolve，只记日志）；
   测试用 pending promise 直接验证 startRun 等待，不加 runtime 级 gate。
5. 测试注入短 TTL：`RuntimeDeps.laneLeaseOptions`（ttlMs / renewIntervalMs）传给
   `createRuntime` 里创建的 `createLaneLeaseStore`；生产走常量默认值。

## 状态

- [x] 步骤 1：schema + migration（0028_tan_meggan.sql）
- [x] 步骤 2：lane-lease.ts
- [x] 步骤 3：run.service.ts 接入
- [x] 步骤 4：终态 fencing（run.repository.ts）
- [x] 步骤 5：测试（harness 双 runtime + ai-lane-lease.test.ts + 修正既有直连构造）
- [x] 步骤 6：验证命令全绿 + spec 更新 + 调研任务勾选

## 验证结果（最终，2025-09-02）

- `pnpm --filter @starter/api check-types`：通过
- `pnpm --filter @starter/api lint`：通过（0 error 0 warning）
- `pnpm --filter @starter/api format:check`：通过
- `pnpm --filter @starter/api test`：60 文件 433 用例全部通过
- `pnpm --filter @starter/api db:check`：通过
- `pnpm --filter @starter/api build`：通过
- `db:generate` / `db:migrate`：通过

## 改动文件

代码：
- `apps/api/src/modules/ai/ai.schema.ts`：新表 `ai_agent_lane_leases` + `ai_agent_runs.execution_fencing_token`
- `apps/api/src/modules/ai/run/lane-lease.ts`（新）：acquire/renew/release/releaseExpired + 常量
- `apps/api/src/modules/ai/run/run.repository.ts`：终态事务 fencing 校验 + `executionFencingToken` 写入
- `apps/api/src/modules/ai/run/run.service.ts`：readiness await、lease acquire/release、续租定时器、恢复扫描 lease 清理
- `apps/api/src/modules/ai/run/index.ts`：导出 lane-lease
- `apps/api/src/modules/ai/ai.services.ts`：`AiServices.readiness` deferred + 新 service 输入
- `apps/api/src/bootstrap/create-runtime.ts`：`AppRuntime.laneLeaseStore` + `RuntimeDeps.laneLeaseOptions`

migration：
- `apps/api/src/infra/db/migrations/0028_tan_meggan.sql` + `meta/0028_snapshot.json` + `meta/_journal.json`

测试：
- `apps/api/src/test/ai-lane-lease.test.ts`（新，6 用例）
- `apps/api/src/test/ai-run-harness.ts`：`runDualRuntimeApps`
- `apps/api/src/test/ai-agent-runs.test.ts`：3 处直连构造补 `laneLeaseStore` / `instanceId`
- `apps/api/src/test/ai-runtime-schema.test.ts`：列清单补 `execution_fencing_token`

文档：
- `.trellis/spec/api/backend/agent-run-guidelines.md`：lane lease 语义、fencing、readiness 门禁、双 runtime 测试说明
- 调研任务 `implement.md` 阶段 A 勾选；本任务 `implement.md` 勾选

未提交：改动全部留在工作区，等用户确认。
