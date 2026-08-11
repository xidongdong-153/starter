# 执行计划

## 1. 开始前

- [x] 读取 `prd.md` 和 `design.md`，确认任务仍只包含自定义角色生命周期与影响分析。
- [x] 读取 `implement.jsonl` 中的 API、Admin、contracts 规范和来源设计。
- [x] 确认 `python3 ./.trellis/scripts/task.py current --source` 指向本任务，状态为 `in_progress` 后才修改产品代码。
- [x] 记录开始前 `git status --short`，不覆盖用户已有改动。

检查点：本任务不新增依赖，不修改数据库 schema，不生成 migration。

## 2. Contracts

目标文件：`packages/contracts/src/index.ts`。

- [x] 增加 `AUTH.ROLE_KEY_CONFLICT` 和 `AUTH.ROLE_IN_USE` error code。
- [x] 提取并导出 role name、description schema。
- [x] 增加 create role、update role、role catalog status query schema 和输入类型。
- [x] 扩展 `AuthorizationRole`，增加 `archivedAt`、`metadataEditable`、`lifecycleEditable`，保留 `permissionsEditable`。
- [x] 增加 `AuthorizationRoleImpact` 和 `AuthorizationPermissionImpact` DTO。
- [x] 在 `AuditActions` 增加 `role.created`、`role.updated`、`role.archived`、`role.restored`。
- [x] 增加新 action 的 payload schema 和 TypeScript 判别联合。
- [x] 保持现有 user role、role permission 和 audit query 类型兼容。

检查点：key 仍由 `roleKeySchema` 校验；create 输入不能提交 `isSystem` 或 `archivedAt`；permission 仍是 `permissionSchema` 封闭集合。

验证：

```bash
pnpm --filter @starter/contracts check-types
```

## 3. API OpenAPI 与 presenter

目标文件：

- `apps/api/src/modules/authorization/authorization.openapi.ts`
- `apps/api/src/modules/authorization/authorization.presenter.ts`
- `apps/api/src/modules/authorization/authorization.audit.ts`

- [x] 扩展 role OpenAPI schema 和 catalog status query。
- [x] 增加 create/update body、role impact 和 permission impact schema。
- [x] 更新 `toAuthorizationRole`，由服务端计算 metadata、permission 和 lifecycle editable 字段。
- [x] 增加影响 DTO presenter；所有 role key 和 permission key 去重、排序。
- [x] 扩展 `AuditEventInput`，按 action 明确类型和 targetType。
- [x] `insertAuditEvent` 对 role lifecycle payload 显式选择字段，不序列化数据库 record。
- [x] 扩展 `toAuthorizationAuditEvent`，逐 action 解析并校验新 payload。
- [x] 保持未知 action、损坏 JSON、错误 targetType 返回 `SYSTEM.INTERNAL_ERROR` 500。

检查点：`role.created` payload 的 permissionKeys 排序；role key 只保存在 targetId。

## 4. API repository

目标文件：`apps/api/src/modules/authorization/authorization.repository.ts`。

### 4.1 目录查询

- [x] `listRoleCatalog` 接收 `active | archived`，默认调用仍为 active。
- [x] archived 查询保留角色已有 permission 关系；permission 目录始终只返回活动注册项。
- [x] 增加按任意状态查 role 的内部查询，供 lifecycle 和 impact 使用。

### 4.2 创建

- [x] 定义 `CreateRoleResult` 判别联合。
- [x] transaction 内校验活动 permission、actor 平台 admin 和全状态 key 唯一性。
- [x] 插入 `isSystem=false` 的 role、初始 `role_permissions` 和一条 `role.created`。
- [x] 任一步失败时验证 role、关系和审计全部回滚。

### 4.3 metadata 修改

- [x] 定义 `UpdateRoleResult` 判别联合。
- [x] 只允许活动、自定义 role。
- [x] 规范化 before/after；相同值按幂等成功返回。
- [x] 实际变化时更新 `updatedAt` 并写一条 `role.updated`。

### 4.4 归档与恢复

- [x] 定义 archive/restore result 判别联合。
- [x] system role 在 repository transaction 内拒绝。
- [x] archive transaction 内用 `COUNT(DISTINCT user.id)` 重查分配人数。
- [x] 有分配时返回 `role-in-use` 和 assignedUserCount，不更新、不写审计。
- [x] 无分配时写 `archivedAt` 和 `role.archived`。
- [x] restore 只清空 `archivedAt`，保留 permission，不新增 user role，写 `role.restored`。
- [x] 重复 archive/restore 返回成功且不更新时间、不写事件。

### 4.5 影响查询

- [x] role impact 返回现存分配用户数。
- [x] permission impact 验证 permission 活动且已注册。
- [x] 普通角色从 `role_permissions` 读取；平台 `admin` 对每个活动注册 permission 单独合并。
- [x] roleKeys 和 user ID 去重；排除归档 role 和 permission。

检查点：新增写函数都在同一 transaction 内调用 `isActivePlatformAdmin`；system actor 不用于这些 HTTP endpoint。

## 5. API service 与 route

目标文件：

- `apps/api/src/modules/authorization/authorization.service.ts`
- `apps/api/src/modules/authorization/authorization.route.ts`

- [x] service 把 repository result 映射为 400、403、404、409 和成功 DTO。
- [x] duplicate key 使用 `AUTH.ROLE_KEY_CONFLICT`。
- [x] 有用户分配使用 `AUTH.ROLE_IN_USE`，details 含 assignedUserCount。
- [x] system role metadata/lifecycle 写入使用 `AUTH.FORBIDDEN`。
- [x] 增加角色 catalog status query。
- [x] 注册 POST role、PATCH metadata、archive、restore、role impact、permission impact route。
- [x] 写 route 先 `requireAuth`、再 `authorization:manage`；读 impact 使用 `authorization:read`。
- [x] 所有写 route 传当前 user actor 和 request ID。
- [x] OpenAPI 声明 400、401、403、404、409、500 中实际可能出现的响应。

检查点：不新增 DELETE route，不新增 permission mutation，不修改 Better Auth session。

## 6. API 测试

目标文件：

- `apps/api/src/test/authorization.smoke.test.ts`
- `apps/api/src/test/authorization-audit.smoke.test.ts`
- `apps/api/src/test/openapi.smoke.test.ts`

可按可读性新建专门的 role lifecycle smoke test，但继续复用 `helpers.ts` 的临时数据库。

- [x] 创建空 permission 角色和带初始 permission 角色。
- [x] 重复活动或归档 key 返回 409，数据库和审计不变。
- [x] 无效或归档 permission 返回 400，transaction 回滚。
- [x] 非 admin 即使持有 `authorization:manage`，所有新增写接口仍返回 403。
- [x] metadata 更新成功、部分 PATCH、幂等 PATCH、system role 拒绝和归档 role 拒绝。
- [x] 有一个或多个用户分配时归档返回 409，details 数量正确。
- [x] 无分配角色可以归档；归档后不能分配、不能修改 metadata 或 permission。
- [x] 恢复保留 permission，不自动新增用户关系；重复 archive/restore 不写事件。
- [x] role impact 数量正确。
- [x] permission impact 对多角色用户去重，并包含 `admin` 自动权限分支。
- [x] 四个新审计 action 的 actor、target、before/after 和 request ID 正确。
- [x] 审计插入失败和关系写入失败都回滚。
- [x] 新 action 的损坏 JSON、payload 或 targetType 返回 500。
- [x] OpenAPI 包含新增路径和响应状态。
- [x] 现有用户角色、permission 替换、最后一个 admin 和审计测试保持通过。

验证：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
```

## 7. Admin API 与 Query

目标文件：

- `apps/admin/src/api/authorization/authorization.api.ts`
- `apps/admin/src/api/authorization/authorization.query.ts`
- `apps/admin/src/api/authorization/index.ts`

- [x] 增加 active/archived role catalog adapter，默认 active。
- [x] 增加 create、update、archive、restore adapter。
- [x] 增加 role impact 和 permission impact adapter。
- [x] query key 的 roles 包含 status。
- [x] roleImpact 和 permissionImpact 使用各自 key，不按页面 state 复用错误缓存。
- [x] mutation 成功后失效 active/archived roles、users、current permissions 和 impact queries。
- [x] archive 409 后页面可以主动刷新对应 impact 和 roles。
- [x] mutation 失败不执行成功失效逻辑。

## 8. Admin 页面

目标文件：

- `apps/admin/src/features/authorization/pages/AuthorizationSettings.tsx`
- 必要时拆出同 feature 下的 role form、impact Drawer 和纯函数文件
- `apps/admin/src/features/authorization/pages/AuthorizationAudit.tsx`
- `apps/admin/src/i18n/locales/zh.ts`
- `apps/admin/src/i18n/locales/en.ts`

### 8.1 Key 建议

- [x] 增加无依赖纯函数生成 ASCII key 建议。
- [x] 支持空值、大小写、空格、连字符、拉丁组合音标和超长结果。
- [x] 中文等无法生成有效 key 的名称返回空建议。
- [x] 表单记录 `keyTouched`，手动编辑后不再覆盖。
- [x] 提交前继续由 contracts schema 或 Form rule 校验。

### 8.2 角色管理

- [x] 角色 Tab 增加 active/archived `Segmented`。
- [x] 增加创建 Drawer，包含名称、key、描述和 permission Tree。
- [x] 自定义活动角色显示 metadata、permission、impact 和 archive 操作。
- [x] 内置角色只按 DTO editable 字段显示允许操作；不在客户端硬编码另一套规则。
- [x] 已归档角色显示状态、影响和 restore 操作。
- [x] metadata Drawer 不包含 key 和 permission。
- [x] permission Drawer 显示 role impact；有差异时 confirm 展示新增、移除 key 和人数。
- [x] archive 前读取最新 impact；人数大于 0 时禁用确认。
- [x] 所有 pending 状态阻止重复提交，成功和失败用 Ant Design message/modal。

### 8.3 Permission impact

- [x] 增加 Permission Tab，使用现有活动 permission 目录。
- [x] 每行提供影响查询操作，按需打开 Drawer。
- [x] 展示有效 role keys 和 affectedUserCount；长 key 可换行或复制，不撑破布局。

### 8.4 审计展示

- [x] 把当前只处理 key 数组的 renderer 改为按 action 判别。
- [x] 展示 role.created、role.updated、role.archived 和 role.restored 的结构化 before/after。
- [x] 组件不调用 `JSON.parse`，不接收数据库 JSON 字符串。

检查点：不增加新路由；用户 Tab 的角色分配始终只使用 active role catalog。

## 9. Admin 测试

目标目录：`apps/admin/src/test/`。

- [x] key 建议纯函数：英文、拉丁音标、中文、非法首字符、长度和 keyTouched 行为。
- [x] roles query key 包含 active/archived status。
- [x] create/update/archive/restore 成功后的失效范围。
- [x] mutation 失败不失效 query。
- [x] role/permission impact query 使用正确参数和独立 key。
- [x] DTO editable 字段控制 system、custom active、custom archived 的操作可见性。
- [x] 创建、metadata、permission、archive、restore的 loading、错误和空状态。
- [x] archive 有分配用户时不能提交。
- [x] 审计 renderer 覆盖四个新 action 和现有 action。
- [x] `authorization:manage` 缺失时写操作继续隐藏。

不要测试 Ant Design 内部实现；优先把 key 建议、action 计算、diff 和审计展示数据提取为纯函数测试。

验证：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin test
```

## 10. Spec 更新

实现与测试稳定后，使用 `trellis-update-spec` 更新：

- [x] `.trellis/spec/api/backend/authorization-guidelines.md`
- [x] `.trellis/spec/admin/frontend/authorization-guidelines.md`
- [x] 如 contracts 新错误契约形成可复用规则，再更新对应 contracts spec；没有新通用规则时不改。

记录最终接口、角色状态、impact 中 admin 特殊分支、审计 payload 和回滚限制。不要把本任务实现清单复制进 spec。

## 11. 完整验证

按项目质量门禁顺序运行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

然后运行：

```bash
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-10-access-management-next-step
git diff --check
```

浏览器验收：

1. 启动 API 和 Admin 开发服务。
2. 以平台 admin 打开 `/settings/authorization`。
3. 在桌面和移动视口验证创建、metadata、permission diff、impact、archive、restore 和错误状态。
4. 检查 active/archived 切换、长 key、Drawer、Modal、表格横向滚动没有重叠。
5. 验证 operator/viewer 看不到未授权写操作，直接调用 API 仍返回 403。

## 12. 回滚点

- contracts 完成后：若 audit union 无法保持现有事件兼容，停在 contracts/API presenter 阶段，不继续写 UI。
- repository 完成后：若 create、lifecycle 和 audit 不能放进同一 transaction，返回设计阶段，不改成请求成功后补写审计。
- Admin 完成后：若单文件继续膨胀，最多按当前 feature 边界拆出角色表单、impact 和纯函数，不创建新的全局状态或组件体系。
- 本任务没有 migration。回滚代码时保留对新审计 action 的解析与展示；否则历史事件会让旧审计查询返回 500。
- 不删除已经创建的自定义角色或审计事件。需要停用角色时使用归档。
