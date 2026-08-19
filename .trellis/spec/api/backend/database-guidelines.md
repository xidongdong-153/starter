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

## Harness 主库结构

### 1. 适用范围

修改 Agent、Session、Run 业务表或 `ai_model_calls` Run 关联时，按本节检查。Pi transcript 不进入 Starter 主库。旧 Conversation 三表（`ai_conversations`、`ai_conversation_messages`、`ai_generations`）已在 destructive migration 中删除，不再存在于 schema 和运行时。

### 2. 数据库签名

- `ai_agent_definitions`：`id`、`name`、`description`、`status`、`revision`、`config_json`、创建/更新人和时间。
- `ai_agent_sessions`：`id`、`owner_id`、`title`、`default_agent_id`、`archived_at` 和时间。
- `ai_agent_runs`：`id`、`session_id`、`agent_id`、`lane`、`status`、`agent_revision`、`snapshot_json`、`request_id`、终态摘要和时间。
- `ai_model_calls.run_id`：可空，引用 `ai_agent_runs.id`，索引为 `(run_id, started_at, id)`，`scenario` 为 `model_test | agent_run | legacy`。

时间列使用 `timestamp_ms`；`final_entry_id` 不建立跨数据库外键。

### 3. 数据契约

`config_json` 和 `snapshot_json` 由 `packages/contracts/src/ai.ts` 的严格 Zod schema 校验，数据库只检查 JSON 语法。`ai_model_calls` 的 `scenario` 分布：模型测试无 Run 关联，新 Run 调用写 `run_id`，destructive migration 后旧 Conversation 调用归为 `legacy` 且 `run_id` 为 `NULL`。

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
