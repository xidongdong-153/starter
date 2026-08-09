# 当前授权实现审计

## 审计范围与判断方法

本文件只描述 2026-08-09 仓库源码和测试能够证明的行为。对照基线是归档任务 `.trellis/tasks/archive/2026-08/08-09-explore-user-permissions/research.md`，其中首版建议是：

- 使用全局 User -> Role -> Permission RBAC，用户权限取多个活动角色的权限并集；不支持角色继承、通配符或用户直接 permission（归档报告第 51、502-503 行）。
- Better Auth session 只提供身份，API 根据 `currentUserId` 查询数据库并执行最终授权；前端权限集合只控制界面和导航（归档报告第 7、195、301、470-471 行）。
- 首版不使用服务端权限缓存，权限撤销在下一次受保护请求生效；Admin 使用独立权限接口和 React Query 快照（归档报告第 340、348、457-466 行）。
- ABAC、Organization 多租户、复杂审计和共享缓存留到后续，不进入首版（归档报告第 337-342、494-526 行）。

状态定义：

- **已实现**：源码中存在完整请求或数据路径，并有直接测试，或实现足够简单且可由调用点证明。
- **部分实现**：主路径存在，但旧建议中的管理范围、保护规则或测试仍缺一部分。
- **未实现**：相关 schema、接口、策略或 UI 在审计范围内没有实现。
- **与旧建议不同**：已经实现，但事实来源、权限语义或接口选择不同于归档报告。

## 结论摘要

| 能力 | 状态 | 当前结论 |
| --- | --- | --- |
| 全局 User -> Role -> Permission 数据模型 | 已实现 | 四张表、复合主键、唯一约束、归档字段和关联索引均已落库。 |
| 多角色权限并集 | 已实现 | 普通角色使用去重查询求并集；测试覆盖 `operator + viewer`。 |
| `admin` 权限语义 | 与旧建议不同 | `admin` 不依赖 `role_permissions` 求并集，而是自动获得全部已注册且未归档权限。 |
| 精确 `resource:action` 权限目录 | 已实现 | contracts 提供 7 个封闭 permission key；数据库只返回代码已注册项。 |
| 角色继承、通配符、用户直授权限 | 未实现 | 没有对应表、匹配器或接口，当前只做精确 key 查询。 |
| Better Auth 认证与业务授权分离 | 已实现 | session 只写 `currentUserId`，授权 guard 再查自建表；未启用 Admin/Organization plugin。 |
| 每请求实时授权、无服务端缓存 | 已实现 | guard 每次构造数据库查询；没有权限 Map、Redis 或 session permission。 |
| 权限管理 API | 部分实现 | 可列用户/角色并替换用户角色、角色权限；不能创建、改名、归档或删除角色/权限，也没有平台管理员二次检查。 |
| 用户管理 | 部分实现 | 有分页、搜索、角色筛选和详情，只读；没有创建、禁用、删除、session 管理。 |
| 文件动作权限与 owner 条件 | 已实现 | 五个文件动作分别授权，repository 继续按 owner 限制具体资源。 |
| Admin 路由、菜单、标签和按钮控制 | 已实现 | 使用同一 permissions query；无权直达路由进入 `/403`。 |
| Admin 权限加载与错误状态 | 已实现 | loading/error 时隐藏受保护入口，侧栏与移动菜单提供重试。 |
| 权限变更同步 | 已实现 | 后端下一请求生效；前端缓存 30 秒、窗口聚焦刷新、403 失效当前权限 query。 |
| 401/403 错误契约与 OpenAPI | 部分实现 | JSON 接口已声明并测试；文件内容下载路由不进入 OpenAPI 文档。 |
| API 自动化测试 | 已实现 | migration、bootstrap、401/403/500、并集、隔离、变更、归档和 owner 边界均有 smoke test。 |
| Admin 自动化测试 | 未实现 | `apps/admin` 没有 test/spec 文件，权限 UI 只靠源码和人工验收。 |
| ABAC/资源范围策略 | 部分实现 | 文件 owner 检查是固定资源条件；没有通用 policy、条件表达式或 `:any` 权限。 |
| Organization 多租户 | 未实现 | 没有 organization/tenant schema、active organization 或租户角色。 |
| 审计、角色变更历史 | 未实现 | 只有当前关系的 `assignedAt`/`assignedBy`，替换操作会删除旧关系。 |
| Better Auth Admin/Organization plugin | 与旧建议不同 | 归档报告把插件列为候选；实际实现未启用插件，自建表是唯一角色事实来源。 |

## 1. 数据模型与权限目录

### 1.1 四张 RBAC 表：已实现

`roles`、`permissions`、`user_roles`、`role_permissions` 已定义在 `apps/api/src/modules/authorization/authorization.schema.ts:14`、`:34`、`:59`、`:79`，并由 `apps/api/src/infra/db/schema/index.ts` 汇总给 Drizzle。

具体约束与旧建议基本一致：

- role key 唯一，角色带 `isSystem`、`archivedAt`、创建和更新时间；见 `authorization.schema.ts:14-30`。
- permission key 唯一，`resource + action` 也唯一，权限带 `isSystem` 和 `archivedAt`；见 `authorization.schema.ts:34-55`。
- `user_roles` 与 `role_permissions` 使用复合主键；见 `authorization.schema.ts:74`、`:94`。
- 用户删除会级联删除 `user_roles`，角色或权限删除会级联删除关联；`assignedBy` 用户删除后置空；见 `authorization.schema.ts:64-70`、`:84-90`。
- migration 实际创建四张表和索引，并预置 `admin`、`operator`、`viewer` 与 7 个权限；见 `apps/api/src/infra/db/migrations/0001_tidy_hellcat.sql:1-65`。
- migration 给已有用户回填 `operator`；见 migration 第 80 行。新注册用户则由 Better Auth user create hook 在事务中写入 `operator`；见 `apps/api/src/modules/auth/auth.config.ts:53-81`。

测试 `apps/api/src/test/authorization.smoke.test.ts:29` 从空库执行两份 migration，检查三个角色、代码权限目录和已有用户的 `operator` 回填。

### 1.2 代码目录与数据库组合：已实现

`packages/contracts/src/index.ts:53-69` 定义当前唯一的 TypeScript permission 和 system role 常量：

- 权限：`authorization:read`、`authorization:manage`、`file:list`、`file:read`、`file:upload`、`file:rename`、`file:delete`。
- 角色：`admin`、`operator`、`viewer`。

输入 schema 只接受 `PermissionKeys` 中的精确值；见 contracts 第 72、88-93 行。repository 又使用 `registeredPermissions = Object.values(PermissionKeys)` 过滤数据库目录；见 `apps/api/src/modules/authorization/authorization.repository.ts:14`、`:69-70`、`:170-171`。因此：

- 只在数据库插入一个新 permission，不会让它出现在当前权限接口或角色目录。
- 只在代码增加 key 但没有 migration/seed 数据，该 key 也不能通过数据库授权。
- 当前实现没有通配符匹配；`file:*` 不会匹配任何动作。

这符合归档报告的“代码定义权限目录 + 数据库存角色分配”，但当前没有单独的目录同步命令；新增 permission 仍需要代码和 migration 同时修改。

### 1.3 归档与系统数据保护：部分实现

所有权限查询和管理目录都过滤已归档角色/权限；见 `authorization.repository.ts:60`、`:86-88`、`:154`、`:163-187`。测试直接归档 `viewer` 和 `file:upload` 后，下一请求立即失去对应权限；见 `authorization.smoke.test.ts:421-464`。

仍缺少以下管理能力：

- 没有创建、改名、归档、恢复或删除 role/permission 的 service 和 route。
- `isSystem` 目前只作为 DTO 展示字段。代码只特殊保护 `admin` 的权限集合；见 `apps/api/src/modules/authorization/authorization.presenter.ts:69` 和 `authorization.service.ts:89-96`。
- `operator`、`viewer` 虽然在 migration 中标为 system role，但允许通过管理接口替换权限。由于没有角色删除/改名接口，归档报告提出的“系统角色 key 不可修改、不可删除”当前没有执行路径，也没有通用保护器。

## 2. 授权计算与安全边界

### 2.1 普通角色权限并集：已实现

`findCurrentAuthorization` 先读取当前用户全部未归档角色，再通过 `selectDistinct` 联结 `user_roles -> roles -> role_permissions -> permissions` 获取未归档、已注册权限；见 `authorization.repository.ts:55-60`、`:75-89`。`toCurrentPermissions` 再去重、排序；见 `apps/api/src/modules/authorization/authorization.presenter.ts:19-35`。

测试给同一用户同时分配 `operator` 和 `viewer`，验证 role 数组包含两项、权限仍是去重后的五项；见 `authorization.smoke.test.ts:199-219`。请求 URL 中伪造 `userId` 不会改变结果，接口始终使用 session 用户；见测试第 221-228 行。

### 2.2 `admin` 自动拥有全部注册权限：与旧建议不同

只要用户拥有活动 `admin` 角色，`findCurrentAuthorization` 就跳过 `role_permissions`，直接读取全部未归档且存在于 `PermissionKeys` 的 permission；`hasPermission` 也使用同一特殊分支；见 `authorization.repository.ts:63-73`、`:99-124`。角色目录 presenter 同样把全部活动权限展示给 `admin`；见 `authorization.presenter.ts:86-94`。

这不再是严格的“所有角色权限关联并集”：

- migration 虽然给 `admin` 写了 7 条 `role_permissions`，运行时对 `admin` 的授权不依赖这些记录。
- 将来注册新的 permission 并写入数据库后，所有 `admin` 会自动获得它，不需要更新 admin 的关联表。
- 管理接口禁止修改 `admin` 权限，前端也显示为只读；见 `authorization.service.ts:89-96`、`authorization.presenter.ts:69`。

这条特殊规则需要在后续设计中明确为“平台级管理员”语义，不能再把 `admin` 当成普通可配置全局角色。

### 2.3 认证与授权分离：已实现

Better Auth 自有 schema 仍只有 `user`、`session`、`account`、`verification`；见 `apps/api/src/modules/auth/auth.schema.ts:12`、`:28`、`:48`、`:70`。`createAuth` 没有 `plugins` 配置，业务角色不写入 Better Auth user/session。

请求顺序为：

1. `createRequireAuth` 调用 `requireSession` 并写入 `currentUserId`；见 `apps/api/src/modules/auth/auth.guard.ts:6-11`。
2. `createRequirePermission` 使用 `currentUserId` 和服务端代码传入的 `Permission` 查询数据库；见 `apps/api/src/modules/authorization/authorization.guard.ts:9-24`。
3. 授权失败抛出 `AUTH.FORBIDDEN` 403；数据库异常不被 guard 捕获，交给全局错误处理返回 500；见 guard 第 20-24 行和 `apps/api/src/bootstrap/error-handler.ts:35-45`。

所有 authorization、users 和 files route 都按 `[requireAuth, requirePermission]` 顺序注册；见 `authorization.route.ts:159-202`、`users.route.ts:66-91`、`files.route.ts:115-208`。

### 2.4 服务端缓存：未实现，符合首版建议

guard 每次请求调用 repository 的 `hasPermission`；普通角色执行一次联结查询，`admin` 分支先查角色再查 permission。`/api/me/permissions` 每次请求也重新读取角色和权限。审计范围内没有授权结果 Map、Redis、共享缓存或 session permission 字段。

所以数据库关系变更提交后，下一次受保护 API 请求就使用新状态。代价是每个受保护请求都会访问 SQLite；当前没有查询合并、请求内权限集合复用或批量授权接口。

### 2.5 资源范围：部分实现

文件 route 已把列表、读取、上传、重命名、删除映射到五个精确 permission；见 `apps/api/src/modules/files/files.route.ts:115-133`。通过动作权限后，repository 仍按 `ownerId` 查询或修改具体文件；见 `apps/api/src/modules/files/files.repository.ts:9-21`、`:29-46`。

测试证明拥有 `file:read` 的另一个用户读取非本人文件时返回 404，而不是越过 owner 条件；见 `authorization.smoke.test.ts:409-416`。

这是固定的资源所有权条件，不是通用 ABAC：

- 没有 `file:read:any`、资源 scope、部门条件或 policy 接口。
- 没有把资源属性传入 permission guard。
- 其他模块的条件仍由各 service/repository 自己实现。

## 3. 管理接口与用户管理

### 3.1 当前授权接口：已实现

`apps/api/src/modules/authorization/authorization.route.ts:30-124` 提供：

| Method | Path | 权限 |
| --- | --- | --- |
| GET | `/api/me/permissions` | 已登录 |
| GET | `/api/authorization/users` | `authorization:read` |
| PUT | `/api/authorization/users/{userId}/roles` | `authorization:manage` |
| GET | `/api/authorization/roles` | `authorization:read` |
| PUT | `/api/authorization/roles/{roleKey}/permissions` | `authorization:manage` |

contracts 定义请求和响应 DTO；见 `packages/contracts/src/index.ts:88-129`。当前权限响应包含排序后的 `roles`、`permissions` 和 16 位 SHA-256 截断 hash `version`；见 `authorization.presenter.ts:25-35`、`authorization.openapi.ts:32-39`。归档报告中的 `version: 12` 只是草图，实际实现不是数据库递增版本。

两个替换操作都在 SQLite transaction 内执行；见 `authorization.repository.ts:194-235`、`:240-295`。service 还要求用户至少保留一个活动角色、禁止调用者修改自己的角色、禁止修改 `admin` 权限；见 `authorization.service.ts:50-66`、`:89-96`。

route 只检查 `authorization:manage`，service 和 transaction 都不要求调用者拥有活动 `admin` 角色。因此，只要普通角色被加入 `authorization:manage`，调用者就可以给其他用户授予包括 `admin` 在内的任意活动角色，也可以修改自己所属的非 `admin` 角色权限。当前 seed 没有把该 permission 给 `operator` 或 `viewer`，所以默认数据不会触发这条路径；但现有接口不能把 `authorization:manage` 当成可安全委派的管理权限。

### 3.2 管理范围：部分实现

当前所谓“角色管理”只支持修改既有角色的 permission，不支持角色生命周期。当前所谓“用户角色管理”只支持替换用户的全局 role，不支持用户直授权限。

缺少：

- role 创建、名称/描述编辑、归档、恢复、删除。
- permission 创建、归档、恢复和目录同步。
- 查看某个 permission 影响哪些用户或角色的接口。
- 批量用户角色操作。
- 授权关系历史记录和变更原因。

### 3.3 用户目录：部分实现，权限命名与旧示例不同

`apps/api/src/modules/users/users.route.ts:26-59` 提供用户分页列表和详情，两个接口都复用 `authorization:read`；实际没有归档报告实施清单中的 `user:list`、`user:create`、`user:delete`（归档报告第 282-296、544 行）。

当前用户目录支持分页、名称/邮箱搜索、活动角色筛选、稳定排序、provider/profile 聚合，并排除 token/password；主要实现见 `apps/api/src/modules/users/users.repository.ts:45-114` 和 `users.service.ts:67-105`。它是只读目录：没有创建用户、编辑身份、封禁、删除、模拟登录或 session 管理接口。

`apps/api/src/test/users.smoke.test.ts:17-445` 覆盖 401/403、admin 访问、分页搜索、角色筛选、详情、敏感字段排除和稳定排序。

### 3.4 管理员初始化：已实现

`AUTH_BOOTSTRAP_ADMIN_EMAIL` 和 `auth:bootstrap-admin` 脚本把一个已存在用户的角色幂等替换为 `admin`；见 `apps/api/src/scripts/bootstrap-admin.ts:12-58`。普通注册不会自动创建管理员，新旧普通用户都默认是 `operator`。

测试覆盖未配置邮箱、migration 缺失、目标用户不存在、重复 bootstrap 和最终单一 admin 角色；见 `authorization.smoke.test.ts:83-167`。

## 4. Admin 前端权限控制

### 4.1 独立权限接口与缓存：已实现

Admin 从 `/api/me/permissions` 读取权限，不把权限写入 session、Zustand 或 localStorage；见 `apps/admin/src/api/authorization/authorization.api.ts:12-14`。`currentPermissionsQueryOptions` 使用 30 秒 `staleTime` 并启用窗口聚焦刷新；见 `apps/admin/src/api/authorization/authorization.query.ts:20-25`。

用户角色或角色权限 mutation 成功后，同时失效 current、users、roles 三组 query；见 `authorization.query.ts:45-71`。

### 4.2 路由、菜单、标签和动作：已实现

- route record 的 `permission?: Permission` 使用 contracts 类型；带 permission 的 route 在 `beforeLoad` 调用 `requireAdminRoutePermission`；见 `apps/admin/src/app/router/types.ts:18-35`、`routes.tsx:42-51`。
- permission query 成功但缺少权限时跳 `/403`，401 跳 `/login`，其他错误继续抛给 ErrorBoundary；见 `apps/admin/src/app/router/auth-guard.ts:23-41`。
- 用户管理和授权管理 route 都要求 `authorization:read`，文件 route 要求 `file:list`；见 `apps/admin/src/features/users/routes.tsx:20`、`features/authorization/routes.tsx:20`、`features/files/routes.tsx:20`。
- 菜单按 route permission 过滤；见 `apps/admin/src/app/navigation/navigation.ts:65-73`。标签栏也按同一 route permission 过滤；见 `apps/admin/src/layout/components/tab-bar/TabBar.tsx:23-54`。
- `usePermission` 返回 allowed/loading/error/refetch；`PermissionGuard` 默认在 loading、失败或无权时不渲染 children；见 `apps/admin/src/hooks/usePermission.ts:6-15`、`components/common/PermissionGuard.tsx:12-15`。
- 文件页面对读取、上传、重命名、删除分别使用精确 guard；见 `apps/admin/src/features/files/pages/FileList.tsx:120-304`。
- 授权管理页面只有 `authorization:manage` 才显示编辑动作和 drawer，当前用户的角色按钮禁用，`admin` 权限只读；见 `AuthorizationSettings.tsx:207-284`、`:358-434`。

前端控制只隐藏入口。API route 仍独立挂 permission middleware，因此直接请求不能绕过授权。

### 4.3 加载、失败、401/403：已实现

权限未成功加载时，菜单和标签不显示受保护记录。侧栏和移动菜单使用 `PermissionQueryStatus` 显示 loading 或带重试按钮的错误；见 `apps/admin/src/layout/components/app-sidebar/SidebarContent.tsx:16-30`、`mobile-drawer/MobileDrawer.tsx:37-61`、`components/common/PermissionQueryStatus.tsx:14-54`。

全局 HTTP 行为区分 401 和 403：

- fetch 始终带 `credentials: 'include'`；见 `apps/admin/src/api/http.ts:73-87`。
- 401 清空 QueryClient 并跳登录页；见 `apps/admin/src/App.tsx:29-34`。
- 403 保持 session，只失效 current permission query，并对活跃 query 发起 refetch；见 `App.tsx:36-40`。
- mutation 自己仍收到 `ApiRequestError`，页面显示服务端错误文案；全局 403 listener 不会自动把所有页面切到 `/403`。

这与归档报告“403 刷新权限但不退出登录”一致。权限增加最多受 30 秒 stale 时间、窗口聚焦或主动刷新影响；权限撤销即使按钮短暂保留，也会在下一 API 请求被后端拒绝。

### 4.4 Admin 测试：未实现

`apps/admin/package.json` 只有 type-check、lint、format 和 build 脚本，没有 test 脚本；仓库中也没有 `apps/admin/**/*.test.ts(x)` 或 `*.spec.ts(x)`。根目录 `pnpm test` 当前固定为 `pnpm --filter=@starter/api test`，即使直接新增 Admin 测试文件也不会进入仓库测试命令。因此以下行为只有实现代码和 spec，没有自动化回归证据：

- admin/operator/viewer 的菜单、标签和直达 URL 差异。
- 权限加载失败、重试、401 跳转和 403 query 失效。
- `PermissionGuard` 对 loading/error/fallback 的行为。
- 授权管理 drawer、self-edit 禁用和 admin 只读。

## 5. 错误契约、OpenAPI 与测试

### 5.1 错误契约：已实现

`AUTH.FORBIDDEN` 已加入共享错误码；见 `packages/contracts/src/index.ts:4`。permission guard 在已认证但无权限时返回该 code 和 403；未认证仍由 auth service 返回既有 401。OpenAPI 共用 `forbiddenResponse`；见 `apps/api/src/openapi/responses.ts:65`。

当前全局 error handler 对 `AppError` 和 `HTTPException` 直接构造响应，只有未知异常会调用 `runtime.logger.error`；见 `apps/api/src/bootstrap/error-handler.ts:8-44`。因此 401/403 响应契约已实现，但拒绝操作没有结构化 Pino 记录，不能把错误响应当成安全审计日志。

authorization、users 和四个 OpenAPI files JSON route 均声明 401/403；见 `authorization.route.ts:35-124`、`users.route.ts:32-59`、`files.route.ts:36-108`。文件内容 `/api/files/:fileId/content` 使用普通 Hono route，不进入 OpenAPI；测试明确断言该路径不在文档中，见 `apps/api/src/test/openapi.smoke.test.ts:22`。所以“所有受保护动作都在 OpenAPI 声明 403”只部分成立。

### 5.2 API 测试覆盖：已实现但仍有空白

授权 smoke tests 的五个场景位于 `apps/api/src/test/authorization.smoke.test.ts:29`、`:83`、`:117`、`:233`、`:253`，已覆盖：

- migration 目录与旧用户回填。
- bootstrap 的成功、幂等和主要失败分支。
- 401、403、多角色并集、current user 隔离和 version 变化。
- 权限表异常返回 500，不误判为 403。
- 用户角色/角色权限替换、禁止自改、保护 admin、viewer 写拒绝、owner 隔离、角色和权限归档立即生效。

OpenAPI test 检查授权管理和用户目录的 403 response；见 `openapi.smoke.test.ts:24-39`。用户目录另有 6 个 smoke test；见 `users.smoke.test.ts:17`、`:76`、`:189`、`:285`、`:335`、`:382`。

尚未看到直接测试：

- 重复 role/permission key、无效 key、空 role 数组等请求校验是否保持原关系不变。
- 角色或用户不存在时两个替换接口的 404。
- 普通角色获得 `authorization:manage` 后的提权边界；当前实现允许其修改其他用户角色和非 `admin` 角色权限。
- `operator`/`viewer` 这类 `isSystem` role 的保护边界，因为当前允许修改其权限且没有生命周期接口。
- Admin 前端的任何权限行为。

## 6. 未实现的进阶能力

### 6.1 角色模型扩展：未实现

没有角色继承、嵌套角色、deny 规则、优先级、通配符、用户直授权限或临时授权。当前事实来源只有自建 `user_roles` 和 `role_permissions`，并且 permission 类型是 contracts 中的封闭枚举。

### 6.2 Organization 多租户：未实现

审计范围内没有 organization/tenant/workspace schema、成员关系、邀请、active organization、`organizationId` 请求上下文或 organization-scoped role。所有 role 都是全局 role，授权输入只有 `currentUserId + permission`。

### 6.3 通用 ABAC/资源范围策略：未实现

文件 owner 条件是局部业务规则。没有 policy 模块、条件表达式、策略 DSL、属性目录、关系授权或外部策略引擎。当前不能表达“同一 permission 在不同组织、部门、资源类型或时间段下有不同结果”。

### 6.4 审计与治理：未实现

`assignedAt` 和 `assignedBy` 只记录当前关联的最后一次写入信息。替换角色/权限时先删除旧关系再插入新关系；见 `authorization.repository.ts:220-231`、`:270-289`。因此无法从现有表还原谁在何时撤销了哪个 role/permission，也没有审计日志、变更理由、审批、权限影响分析、离职账号处理或定期访问审查。

### 6.5 Better Auth 插件：与旧建议不同

归档报告建议根据用户管理或多租户需求评估 Better Auth Admin/Organization plugin，并警告避免两个 `admin` 事实来源（归档报告第 480-496 行）。实际实现没有启用任何这两类 plugin：

- Better Auth 只负责认证、session 和用户创建 hook。
- 用户目录、角色、permission、管理员 bootstrap 和授权管理全部自建。
- 自建 `roles` 是当前唯一业务角色事实来源，没有 Better Auth role 与自建 role 的同步问题。

如果以后启用 Better Auth Admin 或 Organization plugin，必须先决定插件 role 与现有全局 role 的所有权；直接并存会重新引入归档报告已经指出的双重事实来源风险。

## 7. 对后续规划最重要的事实

1. 当前不是“只有权限判断的初版”，而是已经具备可用的全局 RBAC 主链路、管理 API、Admin UI 和实时撤权行为。下一任务不应重复实现四张表、guard 或 `PermissionGuard`。
2. `admin` 已经是平台级特殊角色：自动获得全部注册权限、不可编辑。后续设计应明确保留或移除这条特殊语义，不能继续把它描述成普通角色权限并集。
3. 当前最先需要补的是平台管理员写入边界和授权审计。完成后再补角色生命周期、系统角色保护和权限影响分析，避免新 mutation 上线时没有历史记录。
4. 资源范围目前只有文件 owner 条件。若真实需求开始出现“查看他人资源”“部门范围”或“组织内资源”，应先单独设计 scope/context 输入，不要把条件塞进 permission key 通配符。
5. Organization 是否进入默认脚手架仍取决于产品定位。当前 schema 和接口没有租户维度，直接给 `user_roles` 增加 `organizationId` 会改变全局角色、平台 admin 和 `/api/me/permissions` 的契约，应单独立项。
6. 当前最明显的验证缺口在 Admin。后续任何权限演进都需要先决定是否引入前端测试基础设施；否则路由、菜单、标签、按钮和错误状态只能人工验收。
