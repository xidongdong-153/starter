# 技术设计

## 实现边界

本任务把数据库、API、共享契约和 Admin 权限体验作为一个集成功能提交。权限 key 是跨层契约，migration、middleware、路由元数据和按钮控制必须使用同一份定义，因此不拆成独立 Trellis 子任务。

涉及的包：

- `packages/contracts`：权限常量、输入 schema、响应 DTO 和 `AUTH.FORBIDDEN`。
- `apps/api`：四张授权表、初始数据、管理员 bootstrap、授权查询、middleware、管理接口和 smoke tests。
- `apps/admin`：权限 query、全局 401/403 处理、菜单和路由控制、`PermissionGuard`、文件操作控制和授权管理页。
- 根目录说明与 `apps/api/.env.example`：记录 migration、默认角色和管理员 bootstrap 命令。

Web 公开站点不读取权限，也不增加权限页面。

## 权限目录与默认角色

权限常量只在 `@starter/contracts` 定义一次，API 和 Admin 都从该包导入。首版权限如下：

| Permission | 用途 |
| --- | --- |
| `authorization:read` | 查看用户角色、角色和权限目录 |
| `authorization:manage` | 替换用户角色和非 `admin` 角色的权限集合 |
| `file:list` | 查看当前用户的文件列表 |
| `file:read` | 预览或下载当前用户的文件 |
| `file:upload` | 给当前用户上传文件 |
| `file:rename` | 重命名当前用户的文件 |
| `file:delete` | 删除当前用户的文件 |

角色初始权限：

| Role | 初始权限 | 约束 |
| --- | --- | --- |
| `admin` | 全部权限 | 系统角色，权限集合不可通过管理接口修改 |
| `operator` | 全部 `file:*` 精确权限 | 新用户和 migration 前已有用户的默认角色 |
| `viewer` | `file:list`、`file:read` | 只读文件角色 |

权限判断只做精确字符串匹配。`file:*` 只是表格中的说明，不是运行时通配符。

## 数据库设计

新增 `apps/api/src/modules/authorization/authorization.schema.ts`，并在 `apps/api/src/infra/db/schema/index.ts` 汇总。

### `roles`

- `id`: text 主键。
- `key`: text，唯一且稳定。
- `name`: text，后台显示名。
- `description`: text，可空。
- `is_system`: boolean，系统角色为 true。
- `archived_at`: timestamp，可空。
- `created_at`、`updated_at`: timestamp。
- 索引：`key` 唯一索引和 `archived_at` 查询索引。

### `permissions`

- `id`: text 主键。
- `key`: text，唯一，值为 `resource:action`。
- `resource`、`action`: text，组合唯一。
- `description`: text，可空。
- `is_system`: boolean，代码目录中的权限为 true。
- `archived_at`: timestamp，可空。
- `created_at`、`updated_at`: timestamp。
- 索引：`key` 唯一索引、`resource + action` 唯一索引和 `archived_at` 查询索引。

### `user_roles`

- `user_id`、`role_id`: 复合主键。
- `assigned_at`: timestamp。
- `assigned_by`: 可空用户外键，用于记录管理员；bootstrap 和默认角色使用 null。
- 用户删除时删除其角色关系，角色物理删除时删除对应关系，`assigned_by` 用户删除时设为 null。
- 反向索引：`role_id + user_id`。

### `role_permissions`

- `role_id`、`permission_id`: 复合主键。
- `assigned_at`: timestamp。
- `assigned_by`: 可空用户外键。
- 角色或权限物理删除时删除对应关系，`assigned_by` 用户删除时设为 null。
- 反向索引：`permission_id + role_id`。

新增 migration 创建四张表，写入三个系统角色、七个系统权限和初始角色权限关系，再给 migration 前已有用户补 `operator`。migration 使用固定的合法 UUIDv7 作为系统数据 ID，避免重复环境得到不同关系。

新用户创建后的 Better Auth hook 在一个数据库事务中创建 profile 并分配 `operator`。migration 未执行或默认角色缺失时注册失败并返回错误，不静默创建权限数据。

## 共享契约

`packages/contracts/src/index.ts` 新增：

- `PermissionKeys` 和 `Permission`。
- `permissionSchema`、`roleKeySchema`。
- `CurrentPermissions`：`roles`、`permissions`、`version`。
- `AuthorizationUser`：用户基础字段和 `roleKeys`。
- `AuthorizationRole`：角色字段、`permissionsEditable` 和 `permissionKeys`。
- `AuthorizationPermission`：权限 key、resource、action 和 description。
- `AuthorizationRoleCatalog`：角色和权限目录。
- `replaceUserRolesSchema`：至少一个不重复的活动角色 key。
- `replaceRolePermissionsSchema`：不重复的已注册 permission key。
- `AUTH.FORBIDDEN` error code。

DTO 不包含数据库 ID、`assignedBy`、归档时间或内部时间字段。管理 mutation 使用稳定 key，不让 Admin 保存数据库主键。

`CurrentPermissions.version` 对排序后的角色 key 和权限 key 计算 SHA-256 摘要并截取固定长度。添加、删除或替换授权关系都会改变 version，不需要新增版本表。

## API 模块

新增模块目录：

```text
apps/api/src/modules/authorization/
  authorization.guard.ts
  authorization.openapi.ts
  authorization.presenter.ts
  authorization.repository.ts
  authorization.route.ts
  authorization.schema.ts
  authorization.service.ts
  index.ts
```

### Repository

Repository 只执行 Drizzle 查询和事务，提供：

- 查询当前用户的活动角色和权限。
- 判断用户是否具有一个精确 permission。
- 查询用户及其活动角色。
- 查询角色、权限目录和角色权限关系。
- 在一个事务中替换目标用户角色，校验用户和角色仍然存在且未归档。
- 在一个事务中替换目标角色权限，校验权限属于代码目录且未归档。
- 按邮箱把已存在用户的角色替换为 `admin`，供 bootstrap 命令调用。

Repository 用结构化结果表示目标不存在或 key 无效，不写业务错误文案。

### Service

Service 负责以下规则：

- 用户只能通过 role 获得权限，结果按集合去重并排序。
- 更新用户角色时禁止调用者修改自己的角色，且至少保留一个活动角色。
- `admin` 角色可以分配给其他用户，但它的权限集合不可修改。
- 归档角色和权限不出现在可分配目录中，也不参与授权。
- 无效用户或角色返回 404；无效角色集合返回 400；违反自改角色或保护角色规则返回 403 `AUTH.FORBIDDEN`。

### Guard

目标调用形式：

```ts
const requireAuth = createRequireAuth(runtime.auth)
const requirePermission = (permission: Permission) =>
  createRequirePermission(runtime.db, permission)
```

执行顺序固定为：

```text
Better Auth cookie
  -> requireAuth
  -> currentUserId
  -> requirePermission
  -> repository.hasPermission
  -> route handler
  -> service 的 owner 条件
```

没有权限时抛出 `AppError(ApiErrorCodes.AUTH_FORBIDDEN, ..., 403)`。数据库异常不捕获为 403，由全局错误处理返回 500。

### Endpoint

| Method | Path | Permission | Response |
| --- | --- | --- | --- |
| GET | `/api/me/permissions` | 只要求登录 | 当前角色、权限和 version |
| GET | `/api/authorization/users` | `authorization:read` | 用户及角色列表 |
| PUT | `/api/authorization/users/{userId}/roles` | `authorization:manage` | 更新后的用户角色 |
| GET | `/api/authorization/roles` | `authorization:read` | 角色和权限目录 |
| PUT | `/api/authorization/roles/{roleKey}/permissions` | `authorization:manage` | 更新后的角色权限 |

所有 JSON 接口使用统一 response wrapper。管理接口 OpenAPI 声明 400、401、403、404 中实际可能出现的状态。

文件接口增加对应 permission middleware：列表、内容、上传、重命名和删除分别使用权限目录中的五个 file permission。文件 repository 继续按 `fileId + currentUserId` 查询，permission 不增加跨用户读取能力。

## 管理员 Bootstrap

`apps/api/src/shared/env.ts` 增加可选 `AUTH_BOOTSTRAP_ADMIN_EMAIL`，空字符串解析为未配置。`apps/api/.env.example` 保留空值示例。

`apps/api/package.json` 增加 `auth:bootstrap-admin`。命令：

1. 读取开发环境文件和 `AUTH_BOOTSTRAP_ADMIN_EMAIL`。
2. 打开现有 SQLite 数据库，不启动 HTTP 服务。
3. 查找已存在且邮箱精确匹配的用户。
4. 在事务中把该用户的角色替换为 `admin`。
5. 重复执行时保持同一结果。
6. 邮箱未配置、用户不存在、migration 未执行或数据库写入失败时返回非零退出码和可执行的错误说明。
7. 无论成功失败都关闭 SQLite。

API 启动和注册流程不调用 bootstrap。使用顺序写入 README：执行 migration，注册目标账号，配置邮箱，执行 bootstrap 命令。

## Admin 数据流

### 当前权限 Query

新增 authorization API adapter 和 Query hooks：

- 当前权限 query key 独立于 session，`staleTime` 为 30 秒。
- 当前权限 query 开启窗口重新聚焦时刷新。
- 登录、注册和退出继续按现有 auth query 处理；退出清空全部 query。
- 管理 mutation 成功后刷新用户、角色目录和当前权限 query。

`api/http.ts` 在任何自有 API 返回 401 或 403 时通知一个应用级 listener。`App.tsx` 注册一次处理：

- 401：清空 query cache，跳转 `/login`。
- 403：使当前权限 query 失效并触发活动 query 刷新，不退出登录。

listener 只传递 HTTP status，不复制 response 解析或权限判断。

### 路由和菜单

`AdminRouteRecord` 增加可选 `permission: Permission`。权限使用位置：

- 文件路由要求 `file:list`。
- 授权管理路由 `/settings/authorization` 要求 `authorization:read`。
- `/403` 是已登录可访问、无 permission 的错误路由。

父布局 `beforeLoad` 继续检查 session。每个带 permission 的子路由在自己的 `beforeLoad` 中通过 RouterContext 的 QueryClient 读取当前权限：

- 401 跳登录。
- 权限 query 失败时抛出原错误，交给现有 ErrorBoundary 和重试动作。
- 权限 query 成功但缺少 permission 时跳 `/403`。
- 有权限时继续加载页面。

菜单生成函数接收当前权限集合并过滤带 permission 的 route record。权限未加载或加载失败时只显示没有 permission 要求的菜单，不默认显示受保护菜单。桌面侧栏和移动端菜单调用同一过滤函数。

首页的文件快捷入口、资料页的文件选择入口也按 permission 处理，避免菜单隐藏后仍留下未受控导航。

### 组件和页面

新增 `usePermission(permission)` 和 `PermissionGuard`。Guard 在权限加载中、失败或缺少权限时默认不渲染 children，可接受显式 fallback；它只控制 UI，不能代替 API middleware。

文件页面按动作拆分控制：

- `file:read`：图片预览和下载。
- `file:upload`：上传按钮。
- `file:rename`：重命名按钮。
- `file:delete`：删除按钮。

授权管理页面使用现有 `AdminPageHeader`、Ant Design Table、Tabs、Modal 或 Drawer：

- 用户页签显示用户名、邮箱和角色；`authorization:manage` 用户可以打开角色选择并保存。
- 角色页签显示角色、权限数量和保护状态；`authorization:manage` 用户可以编辑 `operator`、`viewer` 的权限，`admin` 只读。
- query loading 使用 Table loading 或 Spin；失败显示带重试按钮的 Alert；空数据使用明确 emptyText；mutation pending 禁用重复提交。
- 中英文文案写入现有 i18n 文件，按钮使用 lucide 图标并提供文字、Tooltip 或 `aria-label`。

## 兼容性与安全

- migration 给已有用户补 `operator`，现有文件 smoke tests 和自有文件能力保持不变。
- 所有新用户默认 `operator`，但不会自动成为管理员。
- `admin` 权限关系不可通过 API 修改，避免删除最后一个授权管理入口。
- 调用者不能修改自己的角色，避免通过用户角色接口直接自我提权或误删自己的管理权限。
- 管理权限只允许修改授权关系，不绕过 Better Auth session、用户所有权或数据库外键。
- 前端缓存最多影响按钮和菜单显示；API 每次受保护请求查数据库，撤销权限在下一次请求生效。
- 本任务不增加 Redis 或进程内 permission cache。

## Migration 与回滚

- 先修改 schema，再运行项目现有 `db:generate` 生成新的 migration 和 snapshot，不修改已提交的 `0000` migration。
- 使用 `db:check` 检查 migration 历史，并让 smoke tests 在临时 SQLite 执行完整 migration。
- 应用代码部署前必须先执行 migration。回滚应用代码前需要确认旧版本不会读取新表；新表可以暂时保留，不在自动回滚中删除用户授权数据。
- bootstrap 命令只改 `user_roles`。误指定管理员时，由另一名 `admin` 在管理页改回角色；只有一个管理员时先 bootstrap 正确账号，再修改错误账号。

## 验证范围

API smoke tests覆盖：

- 默认 `operator` 和 bootstrap `admin`。
- 401、403 和有权限 2xx。
- 多角色权限并集。
- viewer 写操作拒绝。
- 归档角色或权限立即失效。
- 替换用户角色和角色权限的事务结果。
- 禁止调用者修改自己角色和修改 `admin` 权限。
- `/api/me/permissions` 的当前用户隔离和 version 变化。
- 两个用户都拥有文件权限时仍不能访问对方文件。

Admin 通过类型、Lint、Format 和浏览器检查覆盖：

- admin、operator、viewer 三种账号的菜单和直接 URL 行为。
- 权限 query loading、失败和刷新。
- 管理 mutation pending、成功和失败反馈。
- 401 跳登录，403 留在登录态并刷新权限。
- 桌面和移动端菜单、表格、Modal 或 Drawer 不重叠，长邮箱和 permission key 不溢出。
