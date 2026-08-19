# Pi Agent Harness 父任务执行计划

## 当前状态

- 父任务处于 `planning`。
- 当前进度为 `7/8 done`。
- S1 `08-18-pi-session-storage-foundation` 已完成并归档。
- S2 `08-18-agent-harness-contracts-schema` 已完成并归档。
- S3 `08-18-agent-definition-management` 已完成并归档。
- S4 `08-18-pi-agent-execution-core` 已完成、检查并归档，提交为 `f72c2e3`。
- S5 `08-18-agent-session-api` 已完成、检查并归档，提交为 `81ce2fb`（实现）/ `164daff`（归档）。
- S6 `08-18-agent-run-api` 已完成、检查并归档，提交为 `a4c58d5`（实现）/ `ba7b3fd`（track）。
- S7 `08-18-admin-agent-harness-ui` 已完成、检查并归档，提交为 `c96423c`（实现）/ `8aa6bd6`（归档）。
- S8 仍处于 `planning`，未启动。
- 旧 Conversation runtime 继续临时保留。

## 父任务职责

父任务不运行 `task.py start`，也不修改产品代码。每次只启动一个满足前置条件的子任务。子任务完成并归档后，更新本文件的状态和父任务 PRD 的跨任务验收项。

## 执行顺序

### 1. 完成基础任务

- [x] 评审并批准 S1 `08-18-pi-session-storage-foundation`。
- [x] 启动、实施、检查并归档 S1。
- [x] 评审并批准 S2 `08-18-agent-harness-contracts-schema`。
- [x] 启动、实施、检查并归档 S2。

S2 实现提交为 `00b7ae4`，归档提交为 `7d95a05`。

S3 实现提交为 `b19a7a7`，归档提交为 `ab1b906`。

S4 实现提交为 `7d8b9fe`，归档提交为 `f72c2e3`。

检查点：旧 Conversation 功能仍通过测试；Pi Session DB、AgentDefinition 与新增业务表已可独立使用。

### 2. 完成配置与执行能力

- [x] 评审并批准 S3 `08-18-agent-definition-management`。
- [x] 启动、实施、检查并归档 S3。
- [x] 评审并批准 S4 `08-18-pi-agent-execution-core`。
- [x] 启动、实施、检查并归档 S4。

检查点：AgentDefinition 可管理；Executor 可以通过直接测试完成 Agent loop 和 Tool loop，但尚未由公开 Run API 调用。

### 3. 完成 Session 与 Run API

- [x] 评审并批准 S5 `08-18-agent-session-api`。
- [x] 启动、实施、检查并归档 S5。
- [x] 评审并批准 S6 `08-18-agent-run-api`。
- [x] 启动、实施、检查并归档 S6。

S5 实现提交为 `81ce2fb`，归档提交为 `164daff`。S5 的 transcript runId 挂载约定已写入 S6 的 `prd.md` 备注。

S6 实现提交为 `a4c58d5`。检查点：文本 Run 唯一 completed/failed 终态和 SSE 顺序、同 lane 冲突与不同 lane 并发、abort/steer/follow-up、启动恢复均已通过 smoke test；旧 Conversation API 仍通过原测试。

检查点：新 Harness API 可以独立完成 Session 创建、Run、transcript、abort 和恢复；旧 Conversation API 仍通过原测试。

### 4. 完成 Admin 调试界面

- [x] 评审并批准 S7 `08-18-admin-agent-harness-ui`。
- [x] 启动、实施、检查并归档 S7。

检查点：Admin 同时有旧 Conversation 页面和新 Harness 调试页面，两者没有共享 reducer、query key 或运行状态。已通过 tsc/lint/format/test/build/db:check，前端测试 120 条全绿；开发库已应用到 `0011_normal_sentinel.sql`（含 Harness 新表，`ai_model_calls` 旧 61 条审计数据保留），并在 Admin 完成 Session 创建、Agent 选择（S7验证Agent）、Run 流式、Tool 活动、abort（AI.REQUEST_ABORTED）与 refresh 恢复的人工验证。

### 5. 执行破坏性切换

- [ ] 确认 S1 至 S7 的 `task.json.status` 均为 `completed`。
- [ ] 评审并批准 S8 `08-18-conversation-destructive-cutover`。
- [ ] 启动 S8，先在含新旧数据的临时数据库验证 destructive migration。
- [ ] 输出开发数据库绝对路径和旧三表记录数。
- [ ] 执行开发库 migration，不创建备份。
- [ ] 删除旧 runtime、contracts、API、Admin 页面和测试。
- [ ] 完成静态删除检查和全仓质量门。
- [ ] 归档 S8。

### 6. 父任务最终验收

- [ ] 逐项核对父任务 `Cross-Child Acceptance Criteria`。
- [ ] 确认八个子任务均已归档，父任务没有直接产品改动。
- [ ] 使用 `trellis-check` 检查最终代码与父任务共同约束。
- [ ] 使用 `trellis-update-spec` 更新已经验证的 Harness 规则。
- [ ] 运行最终命令：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

- [ ] 未经用户确认，不提交、不推送、不归档父任务。

## 子任务启动规则

每个子任务启动前必须：

1. 读取该子任务的 `prd.md`、`design.md` 和 `implement.md`。
2. 核对前置任务状态。
3. S1 至 S7 读取 `research/harness-contracts.md`；S8 按该文件检查最终实现。
4. 核对上游归档任务的实际代码、验收记录与共享契约是否一致，不只检查 `task.json.status`。
5. 向用户展示该子任务的最终规划摘要。
6. 获得用户对该摘要的明确批准。
7. 运行 `task.py start <child>`，不得启动父任务代替子任务。

## 共同质量门

每个包含 JS/TS 修改的子任务依次运行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
```

然后按子任务范围运行测试、构建和数据库检查。任何一步失败时，只修复该子任务引入的问题；既有无关错误记录后交给用户。
