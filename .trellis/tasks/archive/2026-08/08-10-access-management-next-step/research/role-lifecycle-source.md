# 角色生命周期来源结论

## 来源

- `.trellis/tasks/archive/2026-08/08-09-permission-role-evolution/design.md`
- `.trellis/spec/api/backend/authorization-guidelines.md`
- `packages/contracts/src/index.ts`
- `apps/api/src/modules/authorization/`
- `apps/admin/src/features/authorization/pages/AuthorizationSettings.tsx`

## 已批准的产品边界

- `admin` 是平台根角色，自动拥有全部活动且已注册 permission。key、permission 和生命周期不可编辑。
- `operator`、`viewer` 是内置角色。key 和生命周期不可编辑，permission 继续允许平台管理员调整。
- 自定义角色从 `role_permissions` 读取 permission。key 创建后不可修改，名称、描述和 permission 可改，可以归档和恢复。
- 自定义角色不物理删除。
- 归档前必须在写 transaction 内重新检查用户分配；存在分配时返回 409 和分配用户数量。
- 恢复只启用角色并保留原有 permission，不创建用户角色关系。
- permission 不提供运行时创建、改名或删除。

## 已批准的接口形状

```http
POST /api/authorization/roles
PATCH /api/authorization/roles/{roleKey}
PUT /api/authorization/roles/{roleKey}/permissions
POST /api/authorization/roles/{roleKey}/archive
POST /api/authorization/roles/{roleKey}/restore
GET /api/authorization/roles/{roleKey}/impact
GET /api/authorization/permissions/{permissionKey}/impact
```

- 创建角色和初始 permission 写一条 `role.created`。
- metadata PATCH 写一条 `role.updated`。
- permission PUT 继续写 `role_permissions.replaced`。
- 归档和恢复分别写 `role.archived`、`role.restored`。
- 幂等请求不更新时间，不重写关系，不写审计。

## 当前实现事实

- `roles` 已有 `key`、`name`、`description`、`isSystem`、`archivedAt`、`createdAt`、`updatedAt`。
- `roles_key_unique`、`roles_archived_at_idx` 已存在。
- `user_roles_role_user_idx` 支持按 role 统计分配用户。
- `role_permissions_permission_role_idx` 支持 permission 影响查询。
- `authorization_audit_events.action` 是 text，新 action 不需要 migration。
- 当前所有授权写入已经在 repository transaction 内重新检查 actor 的活动 `admin` 关系。
- 当前 Admin 已有角色 permission Drawer、PermissionGuard、TanStack Query 失效逻辑和 Vitest/jsdom 测试基础。
- 当前 role catalog 只返回活动角色；默认调用行为需要保持兼容。

## 本任务新增决定

- Admin 根据角色名称生成 key 建议值，管理员创建前可以修改，创建后不可变。
- 管理员手动修改 key 后，名称变化不再覆盖。
- 不做中文拼音转换；无法生成有效 ASCII key 时由管理员填写。
- permission impact 必须按有效授权计算，包含 `admin` 自动获得全部活动注册 permission 的分支。
- 当前 user schema 没有停用字段，impact 统计现存用户，不描述为“可登录用户”。
- 本任务不修改数据库 schema，不生成 migration。
