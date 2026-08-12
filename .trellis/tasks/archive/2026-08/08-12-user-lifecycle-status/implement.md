# Implement：用户生命周期状态

## 执行顺序

1. **contracts**（`packages/contracts/src/index.ts`）
   - `ApiErrorCodes.AUTH_USER_SUSPENDED`
   - `UserStatus` / `userStatusSchema`
   - `UserManagementUser` 加 `status`
   - `updateUserStatusSchema` + `UpdateUserStatusInput`
   - `AuditActions.USER_STATUS_CHANGED` + `auditUserStatusPayloadSchema` + 审计 payload 联合类型

2. **schema**（`apps/api/src/modules/auth/auth.schema.ts`）
   - `user` 表加 `status` 列（default "active"）+ CHECK 约束
   - 验证：`pnpm --filter @starter/api db:generate` → 检查生成的 migration → `db:migrate`

3. **Better Auth 配置**（`apps/api/src/modules/auth/auth.config.ts`）
   - `user.additionalFields.status`（input: false, defaultValue: "active"）
   - `databaseHooks.session.create.before`：查 user.status，suspended → false
   - 验证 `session.user.status` 类型可达；不可达则 guard 显式查库

4. **guard**（`apps/api/src/modules/auth/auth.service.ts`）
   - `requireSession` 检查 suspended → 401 `AUTH.USER_SUSPENDED`

5. **审计**（`apps/api/src/modules/authorization/authorization.audit.ts`）
   - `AuditEventInput` 联合类型增加 `USER_STATUS_CHANGED` 分支

6. **API 后端**（`apps/api/src/modules/users/`）
   - `users.repository.ts`：`updateStatus`、`deleteSessionsByUser`
   - `users.service.ts`：`updateUserStatus`（404 / 防呆 400 / 幂等 / 事务：update + 删 session + 审计）
   - `users.openapi.ts`：PATCH 路由 + `updateUserStatusSchema` + 响应 schema
   - `users.route.ts`：挂载 PATCH，中间件 requireAuth + requirePermission(AUTHORIZATION_MANAGE)

7. **测试**（`apps/api/src/test/user-status.smoke.test.ts`）
   - 登录拦截 / 已登录 401 / 启用恢复 / 权限矩阵（401/403/404）/ 防呆 400 / 幂等 / 审计

8. **前端**（`apps/admin/src/`）
   - `api/users/users.api.ts`：`updateUserStatus`
   - `features/users/pages/UserManagement.tsx`：状态 Tag + 禁用/启用操作

9. **门禁**：`pnpm check` + `pnpm test` 全绿

## 验证命令

```bash
pnpm --filter @starter/api db:generate
pnpm --filter @starter/api db:migrate
pnpm --filter @starter/api test        # 或 pnpm test
pnpm check
```

## 风险点 / 回滚点

- **migration 生成**（步骤 2）：SQLite ADD COLUMN 带 CHECK 可能触发表重建；
  生成后人工检查 migration 文件内容，确保存量数据默认 active。
- **additionalFields 类型**（步骤 3）：`session.user.status` 类型不可达时，
  guard 改为 drizzle 显式查 `user.status`（user 表已含列，无 schema 成本）。
- **session.create.before 行为**（步骤 3）：返回 false 时 Better Auth 的错误响应
  需在测试里断言实际状态码与文案，不臆测。
- **回滚点**：contracts（步骤 1）→ schema（步骤 2）→ 配置（步骤 3）每步可独立
  编译验证；前端（步骤 8）最后做，后端先行验证。

> 注：项目没有 db:rollback 脚本（只有 generate / migrate / check / studio），回滚通过删除新 migration 文件并重新 generate 处理。

## 完成标准

- `pnpm check` 零错误；`pnpm test` 全绿。
- 手工冒烟：admin 禁用用户 → 该用户登录失败、已有会话请求 401；启用 → 恢复。
