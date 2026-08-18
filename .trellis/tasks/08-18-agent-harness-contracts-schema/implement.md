# Harness 契约与增量数据库结构实施计划

## 前置条件

- 建议 S1 已完成并归档；本任务不调用 S1 代码。
- 旧 Conversation runtime、contracts 和表必须仍存在。
- 若 S1 已归档，先核对其 `task.json.status`、Session adapter 实际导出和测试结果，不只读取 S1 规划文字。

## 执行步骤

### 1. 建立基线

- [ ] 运行全仓类型、Lint、Format 和测试。
- [ ] 记录旧 Conversation contracts 导出和三张表记录数。

### 2. 新增 contracts

- [ ] 增加 AgentDefinition schema、输入、列表项和详情 DTO。
- [ ] 增加 AgentSession、transcript、cursor 和 lane schema。
- [ ] 增加 AgentRun、控制输入和终态 schema。
- [ ] 增加 HarnessEvent discriminated union。
- [ ] 增加 transcript discriminated union 和 `starter.run.v1` data schema。
- [ ] 增加新错误码，保留旧错误码。
- [ ] 给用量审计 DTO 增加 `runId` 和 `agent_run` scenario，保留旧关联字段与 scenario。
- [ ] 建立字段级 contract tests，逐个覆盖共享契约中的 union 分支、严格 object、长度、唯一数组和终态约束。
- [ ] 补 schema 单元测试和导出检查。

### 3. 新增 Drizzle schema

- [ ] 增加三张新表、relations 和索引。
- [ ] 给 `ai_model_calls` 增加 nullable `runId`，保留旧关联字段。
- [ ] 增加 `agent_run` scenario 和旧/新关联互斥 check。
- [ ] 检查 JSON 字段和 contracts 的版本字段一致。

### 4. 生成并审查 migration

- [ ] 运行 `pnpm --filter @starter/api db:generate`。
- [ ] 逐列检查 `ai_model_calls` 复制语句，禁止丢失旧值。
- [ ] 确认 migration 没有 `DROP TABLE ai_conversations`、message 或 generation。
- [ ] 在含旧数据的临时库实跑 migration。
- [ ] 检查旧记录数、新表空值、`run_id` 和外键。

### 5. 共存回归

- [ ] 运行 Conversation、Tool、Prompt 和审计测试。
- [ ] 运行 OpenAPI 和 RPC type probe。
- [ ] 搜索并确认旧 contracts 没有被删除或重命名。

### 6. 质量门

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

- [ ] 使用 `trellis-check` 核对 contracts、migration 和旧功能回归。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- contracts 失败：只恢复新增导出，不改旧调用方。
- migration fixture 失败：停止，不对开发库运行 migration。
- migration 已在开发库执行但新表仍为空：删除新增表和 `run_id` 前再次确认没有新数据。
