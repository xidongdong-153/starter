# Harness 契约与增量数据库结构实施计划

## 前置条件

- 建议 S1 已完成并归档；本任务不调用 S1 代码。
- 旧 Conversation runtime、contracts 和表必须仍存在。
- 若 S1 已归档，先核对其 `task.json.status`、Session adapter 实际导出和测试结果，不只读取 S1 规划文字。

## 执行步骤

### 1. 建立基线

- [x] 运行全仓类型、Lint、Format；API 全量测试和构建通过。
- [x] 记录旧 Conversation contracts 导出和三张表记录数。

### 2. 新增 contracts

- [x] 增加 AgentDefinition schema、输入、列表项和详情 DTO。
- [x] 增加 AgentSession、transcript、cursor 和 lane schema。
- [x] 增加 AgentRun、控制输入和终态 schema。
- [x] 增加 HarnessEvent discriminated union。
- [x] 增加 transcript discriminated union 和 `starter.run.v1` data schema。
- [x] 增加新错误码，保留旧错误码。
- [x] 给用量审计 DTO 增加 `runId` 和 `agent_run` scenario，保留旧关联字段与 scenario。
- [x] 建立字段级 contract tests，逐个覆盖共享契约中的 union 分支、严格 object、长度、唯一数组和终态约束。
- [x] 补 schema 单元测试和导出检查。

### 3. 新增 Drizzle schema

- [x] 增加三张新表、relations 和索引。
- [x] 给 `ai_model_calls` 增加 nullable `runId`，保留旧关联字段。
- [x] 增加 `agent_run` scenario 和旧/新关联互斥 check。
- [x] 检查 JSON 字段和 contracts 的版本字段一致。

### 4. 生成并审查 migration

- [x] 运行 `pnpm --filter @starter/api db:generate`。
- [x] 逐列检查 `ai_model_calls` 复制语句，禁止丢失旧值。
- [x] 确认 migration 没有 `DROP TABLE ai_conversations`、message 或 generation。
- [x] 在含旧数据的临时库实跑 migration。
- [x] 检查旧记录数、新表空值、`run_id` 和外键。

### 5. 共存回归

- [x] 运行 Conversation、Tool、Prompt 和审计测试。
- [x] 运行 OpenAPI 和 RPC type probe。
- [x] 搜索并确认旧 contracts 没有被删除或重命名。

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

- [x] 使用 `trellis-check` 核对 contracts、migration 和旧功能回归。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 验证备注

- `pnpm test`（turbo 并行 API + Admin）已通过：API 28 个文件 225 个测试，Admin 17 个文件 100 个测试；此前记录的 Admin 技能页面文案测试超时未复现。
- `pnpm --filter @starter/api test`、`pnpm --filter @starter/admin test`、`pnpm check`、`pnpm build`（API 强制重建通过）和 `pnpm --filter @starter/api db:check` 已通过。

## 回滚点

- contracts 失败：只恢复新增导出，不改旧调用方。
- migration fixture 失败：停止，不对开发库运行 migration。
- migration 已在开发库执行但新表仍为空：删除新增表和 `run_id` 前再次确认没有新数据。
