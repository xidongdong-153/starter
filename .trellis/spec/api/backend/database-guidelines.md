# API 数据库规范

## 连接与 schema

数据库使用 better-sqlite3 + Drizzle。`createDatabase` 会创建父目录、打开 SQLite、启用 `foreign_keys = ON` 和 `journal_mode = WAL`，然后把 `schema` 传给 Drizzle client。新增表时在所属模块维护 schema，并在 `apps/api/src/infra/db/schema/index.ts` 加 import 和展开。

```ts
// apps/api/src/infra/db/schema/index.ts
import * as filesSchema from "@api/modules/files/files.schema.js";

export const schema = {
  ...authSchema,
  ...filesSchema,
  ...profileSchema,
};
```

时间字段统一使用 `integer(name, { mode: 'timestamp_ms' })`，应用层使用 `Date`。外键明确设置 `onDelete`，例如 `files.ownerId` 对 user 使用 cascade，profile 的 avatar 使用 set null。

## migration

修改 `apps/api/src/infra/db/schema/index.ts` 或模块 schema 后运行：

```bash
pnpm --filter @starter/api db:generate
pnpm --filter @starter/api db:check
pnpm --filter @starter/api db:migrate
```

API 启动不会自动执行 migration。不要手动修改已经提交的 migration；新增 migration 后在 `src/infra/db/migrations/` 提交 SQL 和 meta 文件。

## repository 与事务

repository 只负责 Drizzle 查询和持久化，不抛业务文案。需要同时更新多张表时使用 `db.transaction`，如 `profile.repository.ts` 更新 user 与 profiles，`files.repository.ts` 删除文件时清空头像引用再删除 files 行。

查询必须带 owner/user 条件保护资源边界。`findOwned(fileId, ownerId)`、`deleteOwned(fileId, ownerId)` 是当前文件领域的所有权模式。

## 测试数据库

`apps/api/src/test/helpers.ts` 为每个测试创建临时目录、临时 SQLite 和临时 files 目录，并执行同一套 migration；测试结束必须调用 `cleanup()`。不要让 smoke test 读写 `apps/api/data/app.db`。

## 已知坑：drizzle-kit 0.31.10 对带 CHECK 的新列生成坏 migration

> **Warning**：给 SQLite 表新增带 CHECK 约束的列时，drizzle-kit 会生成表重建脚本，
> 其中 `INSERT INTO __new_table(...) SELECT ... FROM old_table` 会把新列也放进
> SELECT 列表，而旧表没有该列，`db:migrate` 报 "no such column" 失败。

规避：不在 DB 层加 CHECK，改用应用层强校验（Zod schema 在接口入口拦截），
如 `user.status` 用 contracts 的 `userStatusSchema`（z.enum）校验。

```ts
// 错误：migrate 失败
status: text("status").notNull().default("active"),
// (table) => [check("user_status_check", sql`${table.status} IN ('active','suspended')`)]

// 正确：生成干净的 ALTER TABLE ADD COLUMN
status: text("status").notNull().default("active"),
```

## AI Runtime 主库结构

### 1. 适用范围

修改 Agent、Session、Run 业务表、RunEvent 时间线或 Model Call/Tool Execution 关联时，按本节检查。Pi transcript 不进入 Starter 主库。旧 Conversation 三表（`ai_conversations`、`ai_conversation_messages`、`ai_generations`）已在 destructive migration 中删除，不再存在于 schema 和运行时。

### 2. 数据库签名

- `ai_agent_definitions`：`id`、`name`、`description`、`status`、`revision`、`config_json`、创建/更新人和时间。
- `ai_agent_sessions`：`id`、`owner_id`、`title`、`default_agent_id`、`archived_at` 和时间。
- `ai_agent_runs`：`id`、`session_id`、`agent_id`、`lane`、`status`、`agent_revision`、`snapshot_json`、`request_id`、终态摘要和时间。
- `ai_run_turns`：Run 下的 `turn_index`、`outcome` 和时间，`(run_id, turn_index)` 唯一。
- `ai_run_steps`：Run/Turn 下的 `kind`、`attempt`、`outcome`、错误码和时间。
- `ai_run_events`：`event_id`、`run_id`、连续 `sequence`、事件 `type`、`payload_json` 和时间，`(run_id, sequence)` 唯一。
- `ai_structured_outputs`：Run/Step 关联、Contract 名称/版本、schema hash、render kind 和校验后的 value。
- `ai_model_calls.run_id`：可空，引用 `ai_agent_runs.id`，索引为 `(run_id, started_at, id)`，`scenario` 为 `model_test | agent_run | legacy`；Agent Run 记录同时保存 `turn_id`、`step_id` 和模型调用观测字段。
- `ai_tool_executions`：使用唯一的 `model_call_id`、`run_id`、`step_id`、`tool_call_id` 和 `tool_execution_id` 关联执行，不再使用 `ai_call_id`。

时间列使用 `timestamp_ms`；`final_entry_id` 不建立跨数据库外键。

### 3. 数据契约

`config_json`、`snapshot_json`、RunEvent `payload_json` 和 Structured Output `value_json` 由 `packages/contracts/src/ai.ts` 的严格 Zod schema 在写入和读取时校验，数据库同时检查 JSON 语法。`ai_model_calls` 的 `scenario` 分布：模型测试无 Run 关联，新 Run 调用写 `run_id`，destructive migration 后旧 Conversation 调用归为 `legacy` 且 `run_id` 为 `NULL`。

### 4. 校验与错误矩阵

- `status`、`revision`、`agent_revision` 和 JSON 语法：由表级 CHECK 保证；接口输入继续由 Zod 校验。
- destructive migration 后旧三表和外键不存在，`ai_model_calls` 不再有 `conversation_id`/`generation_id` 列。
- 迁移后外键不完整：`PRAGMA foreign_key_check` 必须返回空结果，否则停止迁移验证。
- 迁移复制语句缺少旧列或旧值：停止，不在开发库继续执行。

### 5. 正常、基础、错误用例

- 正常：destructive migration 在临时库执行后，旧三表被删除，`ai_model_calls` 旧 `conversation` 调用保留为 `legacy` 且 `run_id` 为 `NULL`，新 Run 调用保留 `run_id`。
- 基础：没有 Run 数据时，`ai_model_calls` 只有 `legacy` 和模型测试记录，`run_id` 全部为 `NULL`。
- 错误：destructive migration 后仍从代码、测试或断言中引用旧三表，或复用旧 `conversation_id`/`generation_id` 列。

### 6. 必须执行的测试

```bash
pnpm check
pnpm --filter @starter/api test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

迁移测试必须用 drizzle-kit 事务式执行（BEGIN/COMMIT 逐条跑 `statement-breakpoint`），写入 Conversation、message、generation、model call、Provider、Prompt、Skill 和 Tool 执行，再执行 destructive migration，检查旧三表删除、`legacy` 归一、Run 审计保留、Tool 审计保留和 `foreign_key_check`。

### 7. 错误与正确写法

错误写法在重建 `ai_model_calls` 时保留旧 `conversation_id`/`generation_id` 列，或不复制 Tool 执行审计（DROP 父表会级联删除 `ai_tool_executions`）：

```sql
-- 错误：DROP 被引用的父表会级联清空 ai_tool_executions
DROP TABLE ai_model_calls;
```

正确写法先复制 Tool 执行审计到临时表，重建备份表，再恢复：

```sql
CREATE TABLE __keep_tool_executions AS SELECT * FROM ai_tool_executions;
DROP TABLE ai_tool_executions;
-- ... 删除旧表、重建 ai_model_calls、把旧 scenario 归一为 legacy ...
CREATE TABLE ai_tool_executions (... 同原结构 ...);
INSERT INTO ai_tool_executions SELECT * FROM __keep_tool_executions;
DROP TABLE __keep_tool_executions;
```

注意：drizzle-kit migrate 在单个事务内执行 SQL，事务内 `PRAGMA foreign_keys=OFF` 是 no-op，所以重建父表前必须显式解除子表引用，不能依赖外键开关。

## AI Run 事件与关联数据

### 1. Scope / Trigger

修改 `ai_run_turns`、`ai_run_steps`、`ai_run_events`、`ai_structured_outputs` 或 AI 审计关联列时，必须同时检查 schema、migration、repository、JSON 校验和恢复测试。

### 2. Signatures

- `ai_run_events` 通过 `(run_id, sequence)` 唯一键保存 RunEvent；`event_id` 是主键。
- `ai_tool_executions` 只使用 `model_call_id` 关联 `ai_model_calls`，新记录不能为空；删除 Model Call 时按 schema 定义级联删除 Tool Execution。
- `RunEvent` 的 sequence 由 Publisher 在持久化时分配，repository 按 Run 和 sequence 正序读取。

### 3. Contracts

- `payload_json` 必须先通过 `runEventSchema`，读取时再次 parse；解析失败按数据损坏处理，不使用类型断言跳过。
- `value_json` 必须是已注册 Output Contract 的 Zod 校验结果。
- migration `0020_amusing_plazm.sql` 从旧 Tool 表重建新表，用 `COALESCE(model_call_id, ai_call_id)` 保留旧关联值，并删除 `ai_call_id`。

### 4. Validation & Error Matrix

- 重复 `(run_id, sequence)`：数据库拒绝，不产生第二条事件。
- 旧 Tool 行没有 `model_call_id` 但有 `ai_call_id`：迁移时回填；回填后仍无关联值则迁移失败，不静默丢行。
- `PRAGMA foreign_key_check` 非空：停止迁移验证，不能继续使用该数据库。

### 5. Good / Base / Bad Cases

- Good：重建 `ai_tool_executions` 前保留旧行，复制列时显式把旧 `ai_call_id` 回填到 `model_call_id`，再检查列集合和外键。
- Base：历史 Model Call 的 `run_id` 可以为空，但新 Agent Run 的 Tool Execution 必须有 Model Call 关联。
- Bad：保留 `ai_call_id` 与 `model_call_id` 双写，或在删除父表后才尝试恢复 Tool 审计。

### 6. Tests Required

- migration 后检查 `ai_call_id` 不存在、旧 Tool 行数和 `model_call_id` 值保留。
- 检查 `PRAGMA foreign_key_check` 返回空结果。
- 检查 Run 删除级联事件、Turn、Step 和 Structured Output；Model Call 删除按 schema 级联 Tool Execution。

### 7. Wrong vs Correct

错误做法是在事务里执行 `PRAGMA foreign_keys=OFF` 后直接删除被引用的父表，认为子表可以稍后恢复。

正确做法是先保存受影响的子表数据；本次 `0020` 只重建子表，不重建 `ai_model_calls`，并用 `COALESCE` 回填旧 Tool 关联，迁移后再执行外键检查。
