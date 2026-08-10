# 执行计划

## 前置确认

- [x] 确认 S2 `08-09-platform-admin-write-boundary` 已归档，`AuthorizationWriteContext` 和幂等短路已在代码中。
- [x] 确认 S1 `08-09-admin-test-harness` 已归档，`apps/admin` 有可用的 Vitest 环境。

两者缺任一项就停下，不在本任务里补做。

## 顺序

### 1. Contracts

- [x] `PermissionKeys` 按字母序插入 `AUTHORIZATION_AUDIT_READ: 'authorization-audit:read'`。
- [x] 定义 audit action 常量与 `z.enum` 用的值数组。
- [x] 定义 `authorizationAuditQuerySchema`，按 design 第 6.1 节。
- [x] 定义 `AuthorizationAuditEvent` 判别联合和 `AuthorizationAuditEventPage`。

检查点：`admin` 角色会自动获得新 permission（`registeredPermissions` 从 `PermissionKeys` 取值），无需改 repository 的 admin 分支。

### 2. Schema 与 migration

- [x] `authorization.schema.ts` 追加 `authorizationAuditEvents`，按 design 第 1 节。四个索引都要有。
- [x] 确认没有 `references()`，没有 `relations()`。
- [x] `infra/db/schema/index.ts` 已用 `export *`，新表自动汇总，确认无需手改。
- [x] `pnpm --filter @starter/api db:generate` 生成 migration。
- [x] 人工检查生成的 SQL：只有 CREATE TABLE 和 CREATE INDEX，没有修改已有表。
- [x] 在 migration 文件末尾追加 `authorization-audit:read` 的 permission seed，形状对齐 `0001_tidy_hellcat.sql` 里现有 permission 的插入语句。
- [x] `pnpm --filter @starter/api db:check`。

回滚点：SQL 不符合预期时先改 schema 再重新生成，不手工编辑生成的 migration 主体。

### 3. 审计构造器

- [x] 新建 `apps/api/src/modules/authorization/authorization.audit.ts`。
- [x] 定义 `AuditActions`、`AuditPayload`、`AuditEventInput` 和插入函数。
- [x] 实现 `resolveUserRolesAction`，按 design 第 3 节。
- [x] 运行时只导入 `@starter/contracts`、schema 汇总入口和 ID 生成器；transaction 类型从 infra client 做 type-only 导入，不导入 `@api/modules/auth/*`。
- [x] payload 只接受 key 数组，不接受数据库 record；写入时按 action 显式投影允许字段。

检查点：这个文件的 import 列表可以直接证明"不会序列化 user/session record"。

### 4. Repository 写入点

- [x] `replaceUserRoles` 在关系写入后追加审计 insert，action 用 `resolveUserRolesAction`。
- [x] `replaceRolePermissions` 追加 `role_permissions.replaced`。
- [x] `bootstrapAdminByEmail` 追加事件，action 按 design 第 5.2 节。
- [x] 确认三处都在 S2 已有的 transaction 内，幂等短路路径不写事件。

检查点：`git diff` 显示 insert 语句在 `db.transaction` 回调内部。

### 5. Better Auth hook

- [x] `auth.config.ts` 的 user create hook 在现有 transaction 内追加 `user_roles.initialized`。
- [x] actor 用 `{ actorType: 'system', actorId: 'better-auth:user.create', requestId: null }`。
- [x] before `{ roleKeys: [] }`，after `{ roleKeys: ['operator'] }`。
- [x] 确认导入的是 `authorization.audit.ts`，没有引入循环依赖（`pnpm check-types` 和 `pnpm build` 会暴露）。

检查点：注册一个新用户后审计表有一条 system 事件，`request_id` 为 NULL。

### 6. 查询接口

- [x] repository 加 `listAuditEvents`，复用 `users.repository.ts` 的 count + limit/offset 范式。
- [x] 排序 `desc(createdAt), desc(id)`，补 `desc` 导入。
- [x] `from` / `to` 转 `new Date(...)` 再比较。
- [x] presenter 实现 payload 解析，`JSON.parse` 用 try/catch 包住，损坏数据统一抛 500。
- [x] 用 Zod 按 action 校验 payload，不用类型断言。
- [x] service 组装分页结果。
- [x] route 注册 `GET /api/authorization/audit-events`，中间件 `[requireAuth, requireAuditRead]`。
- [x] OpenAPI 声明 200、400、401、403、500。

检查点：相同 `created_at` 的两条记录跨页查询不重复不丢失。

### 7. Admin

- [x] `authorization.api.ts` 加 fetch 函数。
- [x] `authorization.query.ts` 加 `auditEvents` query key 和 query options，不加 mutation。
- [x] `features/authorization/routes.tsx` 加审计 route，`permission: PermissionKeys.AUTHORIZATION_AUDIT_READ`。
- [x] 新建审计页面，Antd Table + 筛选 + 分页。
- [x] before/after 用 Tag 展示 key 差异，不显示原始 JSON，组件内没有 `JSON.parse`。
- [x] `actorId` / `targetId` / `requestId` 用 `Typography.Text` 的 `copyable` + `ellipsis`。
- [x] 覆盖 loading、错误、空状态。
- [x] 筛选状态使用组件内 `useState`；当前 Admin 没有 search params 校验模式，取舍记录在已知缺口。

检查点：桌面和移动视口下无文本或控件重叠。

### 8. 测试

新建 `apps/api/src/test/authorization-audit.smoke.test.ts`：

- [x] 三种 user roles action 各一个用例。
- [x] `role_permissions.replaced`。
- [x] 新用户注册的 `user_roles.initialized`，断言 actor 与 `request_id` 为空。
- [x] `bootstrapAdminByEmail` 首次写、重复不写。
- [x] 幂等 HTTP 请求不写事件。
- [x] transaction 回滚用例使用 SQLite `BEFORE INSERT` 触发器稳定制造关系写入或审计写入失败。
- [x] 损坏 JSON、payload 或 target type 返回 500，用 `sqlite.prepare` 直接插脏数据。
- [x] 分页稳定排序。
- [x] 无 `authorization-audit:read` 的用户访问返回 403。
- [x] 断言事件字段里没有密码、token、cookie；另测构造器不会序列化调用方对象的额外字段。

Admin 侧：

- [x] 审计 route 的 permission guard 测试。
- [x] 审计页三态、错误重试和筛选参数测试。

### 9. Spec 更新

- [x] `.trellis/spec/api/backend/authorization-guidelines.md` 补审计表、事件集合、查询接口和 `authorization-audit:read`。
- [x] 写明审计表没有保留期策略，是已知运维事项。
- [x] `.trellis/spec/admin/frontend/authorization-guidelines.md` 补审计页数据流和“不在组件内解析 JSON”的约束。

### 10. 质量门禁

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

- [x] 六项全过。
- [x] `pnpm --filter @starter/api db:migrate` 在开发库执行成功；另用隔离空库验证 migration 全量可应用。

## 已知缺口

- 失败和拒绝操作不写审计。当前 `AppError` 4xx 也不写 Pino，安全调查能力仍缺失，需要时另建任务。
- 审计表无保留期和导出策略。
- 角色生命周期事件（`role.created`、`role.updated`、`role.archived`、`role.restored`）不在本任务，留给后续角色生命周期任务。
- Admin 筛选使用组件内 `useState`，刷新页面或分享 URL 不会保留条件。当前路由没有 search params 校验模式，本任务不引入新路由约定。
- 稳定分页用例验证了相同 `created_at` 时的结果，但移除显式 `desc(id)` 的 mutation 没有变红：SQLite 会反向扫描 `(created_at, id)` 复合索引，当前查询计划仍碰巧返回 `id DESC`。代码检查仍须确认 `orderBy(desc(createdAt), desc(id))` 两个键都存在。

## 实现验证记录

- transaction 回滚测试用 SQLite `BEFORE INSERT` 触发器分别阻止关系写入和审计写入，两个方向都证明没有部分提交。
- 审计构造器按 action 显式投影 payload 字段。mutation 改回 `JSON.stringify(input.before)` 后，额外 `password` 字段会落库并使测试失败。
- presenter 校验 action、target type 和 payload。mutation 删除 target type 校验后，损坏事件从 500 变成 200，测试会失败。
- 浏览器验收使用隔离数据库和端口：桌面 `1470x871`、移动 `390x844`。移动端 body 无横向溢出，筛选控件均在视口内，表格只在自身容器横向滚动。
- S3 仍未使用 `@testing-library/user-event`，已按 S1 的记录从 Admin 依赖和 workspace catalog 删除。

## 回滚点

- 步骤 2 生成 migration 后先看 SQL，确认前不执行 `db:migrate`。
- 步骤 5 如果出现循环依赖，把审计构造器需要的 schema 引用改为参数传入，不把 `auth.config.ts` 改成调用 repository。
- 步骤 6 如果 payload 解析设计无法覆盖历史数据，回到设计阶段，不改成"解析失败返回原始字符串"。
- 发布后回滚代码时保留审计表和已有数据，不删除 migration。

## 验证命令

```bash
pnpm --filter @starter/api db:check
pnpm --filter @starter/api test
pnpm --filter @starter/admin test
pnpm check-types
pnpm lint
pnpm format:check
pnpm build
```
