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
