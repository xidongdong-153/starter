# 执行计划

## 前置确认

- [ ] 确认 S2 `08-09-platform-admin-write-boundary` 已归档，`AuthorizationWriteContext` 和幂等短路已在代码中。
- [ ] 确认 S1 `08-09-admin-test-harness` 已归档，`apps/admin` 有可用的 Vitest 环境。

两者缺任一项就停下，不在本任务里补做。

## 顺序

### 1. Contracts

- [ ] `PermissionKeys` 按字母序插入 `AUTHORIZATION_AUDIT_READ: 'authorization-audit:read'`。
- [ ] 定义 audit action 常量与 `z.enum` 用的值数组。
- [ ] 定义 `authorizationAuditQuerySchema`，按 design 第 6.1 节。
- [ ] 定义 `AuthorizationAuditEvent` 判别联合和 `AuthorizationAuditEventPage`。

检查点：`admin` 角色会自动获得新 permission（`registeredPermissions` 从 `PermissionKeys` 取值），无需改 repository 的 admin 分支。

### 2. Schema 与 migration

- [ ] `authorization.schema.ts` 追加 `authorizationAuditEvents`，按 design 第 1 节。四个索引都要有。
- [ ] 确认没有 `references()`，没有 `relations()`。
- [ ] `infra/db/schema/index.ts` 已用 `export *`，新表自动汇总，确认无需手改。
- [ ] `pnpm --filter @starter/api db:generate` 生成 migration。
- [ ] 人工检查生成的 SQL：只有 CREATE TABLE 和 CREATE INDEX，没有修改已有表。
- [ ] 在 migration 文件末尾追加 `authorization-audit:read` 的 permission seed，形状对齐 `0001_tidy_hellcat.sql` 里现有 permission 的插入语句。
- [ ] `pnpm --filter @starter/api db:check`。

回滚点：SQL 不符合预期时先改 schema 再重新生成，不手工编辑生成的 migration 主体。

### 3. 审计构造器

- [ ] 新建 `apps/api/src/modules/authorization/authorization.audit.ts`。
- [ ] 定义 `AuditActions`、`AuditPayload`、`AuditEventInput` 和插入函数。
- [ ] 实现 `resolveUserRolesAction`，按 design 第 3 节。
- [ ] 只导入 `@starter/contracts` 和 `@api/infra/db/schema/index.js`。不导入 `@api/modules/auth/*`。
- [ ] payload 只接受 key 数组，不接受数据库 record。

检查点：这个文件的 import 列表可以直接证明"不会序列化 user/session record"。

### 4. Repository 写入点

- [ ] `replaceUserRoles` 在关系写入后追加审计 insert，action 用 `resolveUserRolesAction`。
- [ ] `replaceRolePermissions` 追加 `role_permissions.replaced`。
- [ ] `bootstrapAdminByEmail` 追加事件，action 按 design 第 5.2 节。
- [ ] 确认三处都在 S2 已有的 transaction 内，幂等短路路径不写事件。

检查点：`git diff` 显示 insert 语句在 `db.transaction` 回调内部。

### 5. Better Auth hook

- [ ] `auth.config.ts` 的 user create hook 在现有 transaction 内追加 `user_roles.initialized`。
- [ ] actor 用 `{ actorType: 'system', actorId: 'better-auth:user.create', requestId: null }`。
- [ ] before `{ roleKeys: [] }`，after `{ roleKeys: ['operator'] }`。
- [ ] 确认导入的是 `authorization.audit.ts`，没有引入循环依赖（`pnpm check-types` 和 `pnpm build` 会暴露）。

检查点：注册一个新用户后审计表有一条 system 事件，`request_id` 为 NULL。

### 6. 查询接口

- [ ] repository 加 `listAuditEvents`，复用 `users.repository.ts` 的 count + limit/offset 范式。
- [ ] 排序 `desc(createdAt), desc(id)`，补 `desc` 导入。
- [ ] `from` / `to` 转 `new Date(...)` 再比较。
- [ ] presenter 实现 `parsePayload`，`JSON.parse` 用 try/catch 包住，损坏数据统一抛 500。
- [ ] 用 Zod 按 action 校验 payload，不用类型断言。
- [ ] service 组装分页结果。
- [ ] route 注册 `GET /api/authorization/audit-events`，中间件 `[requireAuth, requireAuditRead]`。
- [ ] OpenAPI 声明 200、401、403。

检查点：相同 `created_at` 的两条记录跨页查询不重复不丢失。

### 7. Admin

- [ ] `authorization.api.ts` 加 fetch 函数。
- [ ] `authorization.query.ts` 加 `auditEvents` query key 和 query options，不加 mutation。
- [ ] `features/authorization/routes.tsx` 加审计 route，`permission: PermissionKeys.AUTHORIZATION_AUDIT_READ`。
- [ ] 新建审计页面，Antd Table + 筛选 + 分页。
- [ ] before/after 用 Tag 展示 key 差异，不显示原始 JSON，组件内没有 `JSON.parse`。
- [ ] `actorId` / `targetId` / `requestId` 用 `Typography.Text` 的 `copyable` + `ellipsis`。
- [ ] 覆盖 loading、错误、空状态。
- [ ] 筛选状态优先走 TanStack Router search params；成本超预期就降级为 `useState` 并记录在已知缺口。

检查点：桌面和移动视口下无文本或控件重叠。

### 8. 测试

新建 `apps/api/src/test/authorization-audit.smoke.test.ts`：

- [ ] 三种 user roles action 各一个用例。
- [ ] `role_permissions.replaced`。
- [ ] 新用户注册的 `user_roles.initialized`，断言 actor 与 `request_id` 为空。
- [ ] `bootstrapAdminByEmail` 首次写、重复不写。
- [ ] 幂等 HTTP 请求不写事件。
- [ ] transaction 回滚用例，按 design 第 8.1 节。找不到稳定触发方式就记录取舍。
- [ ] 损坏 payload 返回 500，用 `sqlite.prepare` 直接插脏数据。
- [ ] 分页稳定排序。
- [ ] 无 `authorization-audit:read` 的用户访问返回 403。
- [ ] 断言事件字段里没有密码、token、cookie。

Admin 侧：

- [ ] 审计 route 的 permission guard 测试。
- [ ] 审计页三态渲染测试。

### 9. Spec 更新

- [ ] `.trellis/spec/api/backend/authorization-guidelines.md` 补审计表、事件集合、查询接口和 `authorization-audit:read`。
- [ ] 写明审计表没有保留期策略，是已知运维事项。
- [ ] `.trellis/spec/admin/frontend/authorization-guidelines.md` 补审计页数据流和"不在组件内解析 JSON"的约束。

### 10. 质量门禁

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

- [ ] 六项全过。
- [ ] `pnpm --filter @starter/api db:migrate` 在开发库执行成功。

## 已知缺口

- 失败和拒绝操作不写审计。当前 `AppError` 4xx 也不写 Pino，安全调查能力仍缺失，需要时另建任务。
- 审计表无保留期和导出策略。
- 角色生命周期事件（`role.created`、`role.updated`、`role.archived`、`role.restored`）不在本任务，留给后续角色生命周期任务。
- （实现中发现的其他问题追加到这里）

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
