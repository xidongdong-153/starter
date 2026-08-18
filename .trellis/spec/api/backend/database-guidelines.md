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

## Harness 主库增量迁移

### 1. 适用范围

新增 Agent、Session、Run 业务索引，或给 `ai_model_calls` 增加 Run 关联时，必须保留旧 Conversation 表、列、外键、索引和记录。Pi transcript 不进入 Starter 主库。

### 2. 数据库签名

- `ai_agent_definitions`：`id`、`name`、`description`、`status`、`revision`、`config_json`、创建/更新人和时间。
- `ai_agent_sessions`：`id`、`owner_id`、`title`、`default_agent_id`、`archived_at` 和时间。
- `ai_agent_runs`：`id`、`session_id`、`agent_id`、`lane`、`status`、`agent_revision`、`snapshot_json`、`request_id`、终态摘要和时间。
- `ai_model_calls.run_id`：可空，引用 `ai_agent_runs.id`，索引为 `(run_id, started_at, id)`。

时间列使用 `timestamp_ms`；`final_entry_id` 不建立跨数据库外键。

### 3. 数据契约

`config_json` 和 `snapshot_json` 由 `packages/contracts/src/ai.ts` 的严格 Zod schema 校验，数据库只检查 JSON 语法。旧调用写 `conversation_id`/`generation_id`，新 Run 调用只写 `run_id`，模型测试三列都为空。Run 关联不能和旧 Conversation 关联同时存在。

### 4. 校验与错误矩阵

- `status`、`revision`、`agent_revision` 和 JSON 语法：由表级 CHECK 保证；接口输入继续由 Zod 校验。
- `run_id` 与旧关联同时存在：数据库拒绝写入。
- 迁移后外键不完整：`PRAGMA foreign_key_check` 必须返回空结果，否则停止迁移验证。
- 迁移复制语句缺少旧列或旧值：停止，不在开发库继续执行。

### 5. 正常、基础、错误用例

- 正常：含旧 Conversation 数据的临时库执行新 migration 后，旧记录数和关键字段不变，新三张表为空。
- 基础：没有 Run 数据时，旧 `ai_model_calls` 的 `run_id` 全部为 `NULL`，旧审计响应增加 `runId: null`。
- 错误：同时提交 `run_id` 与 `conversation_id` 时写入失败；不能通过删除旧列来绕过约束。

### 6. 必须执行的测试

```bash
pnpm check
pnpm --filter @starter/api test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

迁移测试必须先写入 Conversation、message、generation、model call、Provider、Prompt 和 Skill，再执行新 migration，检查旧记录、新表空值、Run 索引和 `foreign_key_check`。

### 7. 错误与正确写法

错误写法只复制部分旧列，或用字符串替换删除旧表关联：

```sql
INSERT INTO __new_ai_model_calls (id, run_id)
SELECT id, NULL FROM ai_model_calls;
```

正确写法逐列复制旧值，只把新增 `run_id` 初始化为 `NULL`，并在最后恢复外键检查：

```sql
INSERT INTO __new_ai_model_calls (
  id,
  request_id,
  user_id,
  scenario,
  conversation_id,
  generation_id,
  provider_id,
  model_id,
  started_at,
  timeout_ms,
  finished_at,
  duration_ms,
  result,
  stop_reason,
  error_code,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  cache_write_1h_tokens,
  reasoning_tokens,
  total_tokens,
  cost_input,
  cost_output,
  cost_cache_read,
  cost_cache_write,
  cost_total,
  cost_currency,
  run_id
)
SELECT
  id,
  request_id,
  user_id,
  scenario,
  conversation_id,
  generation_id,
  provider_id,
  model_id,
  started_at,
  timeout_ms,
  finished_at,
  duration_ms,
  result,
  stop_reason,
  error_code,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  cache_write_1h_tokens,
  reasoning_tokens,
  total_tokens,
  cost_input,
  cost_output,
  cost_cache_read,
  cost_cache_write,
  cost_total,
  cost_currency,
  NULL
FROM ai_model_calls;
```

```sql
PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
```
