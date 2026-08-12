# implement.md — admin 日志查看与日志可观测性优化

## 执行顺序

### 1. contracts：新增权限键

- `packages/contracts/src/index.ts`：`PermissionKeys` 增加 `SYSTEM_LOGS_READ: "system:logs:read"`（字母序 FILE_* 之后）。

### 2. API：请求日志补 userId

- `apps/api/src/middleware/request-log.middleware.ts`：payload 增加 `userId: c.var.currentUserId ?? undefined`。

### 3. API：业务事件日志埋点

- `apps/api/src/modules/users/users.repository.ts`：`UpdateUserStatusResult` 的 ok 分支增加 `from: UserStatus`（用 `targetUser.status`），幂等短路分支 `from: targetUser.status`（与 to 相同）。
- `apps/api/src/modules/users/users.service.ts`：`updateUserStatus` 透传 `from`。
- `apps/api/src/modules/users/users.route.ts`：成功时 `c.var.logger.info({ event: "users.status.changed", actorId, targetUserId, from, to }, ...)`。
- `apps/api/src/modules/files/files.route.ts`：upload handler try/catch，成功 `files.upload.succeeded`（info），失败 `files.upload.failed`（AppError→warn，未知→error，含 err）。

### 4. API：日志查询接口

- `apps/api/src/infra/db/migrations/0004_*.sql`（`db:generate` 后手动补 INSERT，或手写 migration）：`permissions` 插入 `system:logs:read`（is_system=1）。
- `apps/api/src/modules/system/system.openapi.ts`：日志查询 query/response schema。
- `apps/api/src/modules/system/system.service.ts`（新建）：读 LOGS_DIR 文件、解析、过滤、分页。
- `apps/api/src/modules/system/system.route.ts`：新增 `GET /api/system/logs`，挂 `requireAuth` + `requirePermission(SYSTEM_LOGS_READ)`。

### 5. admin：日志页

- `apps/admin/src/features/system/api/logs.api.ts` + `logs.query.ts`。
- `apps/admin/src/features/system/pages/LogViewer.tsx`（列表 + 筛选 + 分页 + 链路 Drawer）。
- `apps/admin/src/features/system/routes.tsx`；`records.ts` 注册；`navigation.ts` 菜单（settings 组）；i18n 文案。

### 6. 测试

- `apps/api/src/test/system-logs.smoke.test.ts`：权限、过滤、分页、未配置 LOGS_DIR、损坏行。
- admin UI 测试：列表渲染、筛选、链路展开（参照现有 test 模式）。

## 验证命令（每步后或阶段末）

```bash
pnpm --filter @starter/api db:generate && pnpm --filter @starter/api db:migrate && pnpm --filter @starter/api db:check
pnpm --filter @starter/api test
pnpm check   # 类型 + lint + format
```

## 风险点与回滚

- 高风险文件：`users.repository.ts`（返回结构变化，需同步 service/route/既有测试）、`request-log.middleware.ts`（所有请求日志）、`system.route.ts`（权限挂载）。
- 回滚：撤 migration、contracts 键、接口与页面；日志写入逻辑无改动。

## 完成标准

- 请求日志（5xx/4xx/正常）均含 userId（已认证请求）。
- 日志文件出现 `users.status.changed`、`files.upload.succeeded/failed`。
- `/api/system/logs` 对 admin 可用，支持 query/level/requestId 过滤与分页；非 admin 403。
- admin 日志页可浏览、筛选、展开 requestId 链路。
- `pnpm check` 与 `pnpm test` 通过。
