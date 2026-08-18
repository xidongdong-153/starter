# AgentRun API 实施计划

实施前先读取父任务共享契约：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。

## 前置条件

- S3、S4、S5 已完成并归档。
- Agent resolver、Executor、registry、Session Service 和 `ai_agent_runs` 已可用。
- 启动前核对 S3-S5 的 `task.json.status`、实际 ports、公开 DTO、migration 和测试结果；发现与共享契约不一致时停止。

## 执行步骤

### 1. Repository 与状态机

- [ ] 实现 Run insert、详情、非终态恢复扫描和条件终态更新；本任务不增加公开 Run 列表 endpoint。
- [ ] 固定内部与公开状态映射。
- [ ] 覆盖重复 terminal 和错误条件更新。

### 2. Run Service

- [ ] 验证 Session owner、归档状态和 Agent enabled 状态。
- [ ] 冻结 revision 与无 secret snapshot。
- [ ] 由 Run Service reserve lane、插入 Run、创建 EventSequencer、prepare Executor、attach controls、start，并处理所有失败窗口。
- [ ] Executor 返回 terminal result 后，由 Run Service 写 `starter.run.v1`、条件更新主库、发布唯一 terminal event 并 release。
- [ ] 实现 abort、steer 和 follow-up。

### 3. SSE Route

- [ ] 实现启动 Run 的 SSE response。
- [ ] 映射 id、event、data 和 heartbeat comment。
- [ ] 实现 transport unsubscribe，不触发 abort。
- [ ] 增加状态和三个控制 endpoint。
- [ ] 更新 OpenAPI 和 RPC type probe。

### 4. 启动恢复

- [ ] bootstrap 扫描非终态 Run。
- [ ] 读取唯一合法的 Pi `starter.run.v1` terminal entry 并修复主库。
- [ ] 无 entry、重复 entry 或 schema 解析失败时标记 `AI.RUN_INTERRUPTED`。
- [ ] 记录恢复数量和失败 id，不自动重跑。

### 5. 测试

- [ ] 覆盖成功、Provider 失败、Tool 失败、abort 和 compaction 失败。
- [ ] 覆盖同 lane 冲突、不同 lane 并发和 writer lease 冲突。
- [ ] 覆盖 SSE 顺序、heartbeat、断开不取消和唯一 terminal。
- [ ] 覆盖 Run row 创建前 JSON error、创建后 pre-start `run.failed` 单事件和正常 `run.started` 路径。
- [ ] 覆盖控制接口的 owner、active 和终态行为。
- [ ] 覆盖无 terminal entry、唯一合法 entry、重复 entry、错误 schema 和主库更新失败窗口。

### 6. 共存回归与质量门

- [ ] 运行旧 Conversation、Tool、审计和 Prompt 测试。

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

- [ ] 使用 `trellis-check` 复核状态、SSE、持久化和权限。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- terminal 持久化顺序无法保证：不挂载 Run Route。
- SSE 断开触发 abort：修复 transport 所有权后再继续。
- 恢复测试失败：不在 bootstrap 启用恢复扫描。
