# 技术设计

## 设计结论

新增一个只读 `users` API 模块和一个 `users` Admin feature。用户目录使用 `/api/users` 路径，继续由现有 `authorization:read` permission 保护。现有 authorization 模块中的 `/api/authorization/users` 保持不变，继续服务角色分配页面，避免改变已有响应契约。

本任务不接入 Better Auth Admin plugin。当前 RBAC 已将 `user_roles` 作为角色来源；Admin plugin 还会增加 `user.role`、`banned` 等字段并使用另一套管理访问判断。只读目录不需要这些字段，新增插件会扩大 migration 和兼容范围。

## 模块边界

### `packages/contracts`

定义跨 API 和 Admin 的可序列化契约：

- `userManagementQuerySchema`：`page`、`pageSize`、`search`、`roleKey`。
- `UserManagementQuery`：前端构造请求参数使用的类型。
- `UserManagementUser`：列表项。
- `UserManagementUserPage`：`items`、`total`、`page`、`pageSize`。
- `UserManagementProfile`：详情中的公开资料，可为空。
- `UserManagementUserDetail`：列表项加 `providers` 和 `profile`。

日期使用 ISO 字符串。DTO 不包含数据库 ID 以外的内部关系 ID、`assignedBy`、密码、session token、OAuth token 或时间戳原始值。

### `apps/api/src/modules/users`

模块只负责读取用户目录，不提供写操作：

```text
apps/api/src/modules/users/
  index.ts
  users.openapi.ts
  users.repository.ts
  users.route.ts
  users.service.ts
```

Repository 查询 `auth.schema`、`profile.schema` 和 `authorization.schema` 中已有表。它不创建表、不修改用户关系，也不调用 Better Auth Admin plugin。

## API 数据流

```text
cookie session
  -> requireAuth
  -> currentUserId
  -> requirePermission(authorization:read)
  -> users route
  -> users service
  -> users repository
  -> presenter / contracts DTO
  -> { ok, data, meta }
```

### 列表接口

```http
GET /api/users?page=1&pageSize=20&search=alice&roleKey=viewer
```

Repository 按以下顺序处理：

1. 构造用户过滤条件。`search` 对 `user.name` 和 `user.email` 做不区分大小写的包含匹配；查询值中的 `%` 和 `_` 按普通字符处理，避免搜索语义被通配符改变。
2. `roleKey` 通过活动 `roles` 和 `user_roles` 过滤，归档角色不匹配。
3. 单独执行 `count distinct user.id`，再按 `user.email ASC, user.id ASC` 查询当前页；使用 `limit` 和 `offset`，不把全部用户载入内存。
4. 只对当前页用户查询活动角色关系，按用户 ID、角色 key 排序并聚合；没有角色时返回 `[]`。
5. Presenter 将 Date 转成 ISO 字符串，返回 `UserManagementUserPage`。

页码是 1-based。超出最后一页时返回空 `items` 和原请求的 `page`，不自动改写请求；Admin 分页组件根据 `total` 负责回到有效页。

### 详情接口

```http
GET /api/users/{userId}
```

Repository 读取：

- `user` 的基础字段。
- 活动角色 key。
- `account.providerId`，只返回 provider ID，不返回账号凭证字段。
- `profiles` 的公开资料；不存在 profile 时返回 `null`。
- 头像存在时生成现有 `/api/profiles/{userId}/avatar` URL，不读取文件内容。

用户不存在时由 service 转换为 `COMMON.NOT_FOUND`。资料不存在不是用户不存在，仍返回详情并将 `profile` 设为 `null`。

## OpenAPI 与错误

`users.openapi.ts` 声明列表 query、分页响应、详情响应和用户路径参数。两个接口声明 200、401、403；详情另声明 404，列表 query 校验失败声明 400。

路由创建时复用：

```ts
const requireAuth = createRequireAuth(runtime.auth)
const requireUsersRead = createRequirePermission(
  runtime.db,
  PermissionKeys.AUTHORIZATION_READ,
)
```

middleware 顺序固定为 `requireAuth` 后 `requireUsersRead`。数据库错误不转换成 403，由现有全局错误处理返回 500。

## Admin 数据流

新增：

```text
apps/admin/src/api/users/
  index.ts
  users.api.ts
  users.query.ts
apps/admin/src/features/users/
  pages/UserManagement.tsx
  routes.tsx
```

`users.query.ts` 使用 TanStack Query：

- 列表 query key 包含 `page`、`pageSize`、`search`、`roleKey`。
- 详情 query key 包含 `userId`，只有 Drawer 打开且有 ID 时启用。
- 列表保留上一页数据，切换分页时表格不闪成空白；新过滤条件提交后重置到第一页。
- 详情 query 成功后由 cache 复用；mutation 不存在，因此不需要写入失效逻辑。

页面使用现有 `AdminPageHeader`、Ant Design `Table`、`Input.Search`、`Select`、`Drawer`、`Descriptions`、`Tag` 和 `Alert`。列表只显示只读字段，详情 Drawer 不出现写操作。

路由记录：

- `id: settings.users`
- `path: /settings/users`
- `permission: PermissionKeys.AUTHORIZATION_READ`
- `menu.group: settings`
- `menu.order: 8`
- `icon: UsersRound`
- `layout.contentWidth: full`

将 `usersRoutes` 加入 `appRouteRecords`。现有菜单过滤、标签栏过滤、`beforeLoad` 和 `/403` 行为自动复用，不另写权限判断。

## 兼容性

- 不修改 `GET /api/authorization/users` 的数组响应，不影响 `AuthorizationSettings` 和已有 role mutation。
- 不修改数据库 schema、migration、Better Auth 配置或注册流程。
- 新 DTO 只新增 `@starter/contracts` 导出，不改变已有 DTO 字段。
- 用户没有 profile 时详情仍可展示；旧账号、测试中直接插入的用户和社交登录账号都能被读取。
- API 只读查询不会改变文件 owner、角色分配或 session 行为。

## 风险与处理

- **分页重复或漏项**：固定邮箱和 ID 的二级排序，并在 role join 后使用 distinct count。
- **搜索特殊字符**：在 repository 中转义 LIKE 通配符，测试 `%`、`_` 不会扩大结果。
- **权限缓存残留**：沿用现有 401/403 listener 和 route guard；新页面不自行缓存权限或 session。
- **敏感字段泄露**：presenter 使用白名单字段，测试检查响应文本中没有 token 和 password 字段。
- **详情头像权限**：只返回已有公开头像 URL，不在新接口中读取或复制文件内容。

## 回滚

本任务没有 migration。若产品代码需要回滚，删除新 users route、contracts 导出、Admin feature 和菜单记录即可；现有 authorization endpoints、表结构和 RBAC 数据不受影响。
