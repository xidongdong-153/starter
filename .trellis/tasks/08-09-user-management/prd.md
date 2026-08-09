# 实现用户管理的 Admin 与 API 功能

## Goal

为管理后台增加独立的只读用户目录。系统管理员可以按姓名或邮箱查找账号，按角色筛选，并打开详情查看账号基础信息、登录方式和公开资料；API 负责分页、数据聚合和访问控制。

## User Value

系统管理员可以在后台快速确认账号是谁、拥有哪些角色、是否验证邮箱以及账号资料，不需要直接查询 SQLite，也不需要在授权设置页中翻找用户。

## Scope Decision

本任务采用 A 档只读 MVP：

- 新增 Admin 用户管理页面 `/settings/users`。
- 新增 API 用户目录 `GET /api/users` 和用户详情 `GET /api/users/{userId}`。
- 列表支持 1-based `page`、`pageSize`、姓名或邮箱包含搜索和活动角色筛选。
- 列表显示用户基础字段和活动角色；详情显示登录方式和公开资料。
- 页面和接口沿用 `authorization:read`。现有 migration 只给 `admin` 角色预置该权限，因此默认只有系统管理员可见；不新增硬编码的角色判断。
- 现有 `/api/authorization/users` 和授权设置页保持原有响应和角色编辑行为，不在本任务中合并或改造。

## Confirmed Facts

- `apps/api/src/modules/auth/auth.schema.ts` 已有用户、登录账号和 session 表；用户字段包含姓名、邮箱、邮箱验证状态、头像地址和创建/更新时间。
- `apps/api/src/modules/profile/profile.schema.ts` 已有公开资料表；资料字段包含简介、联系邮箱、所在地、工作状态、社交链接和头像文件关系。
- `apps/api/src/modules/authorization/authorization.repository.ts` 已能读取活动角色关系；现有 `/api/authorization/users` 返回 `id`、`name`、`email` 和 `roleKeys`，但没有查询、分页或详情。
- Admin 已有 TanStack Query、Ant Design Table/Drawer、路由 permission 元数据、`authorization:read` 路由守卫和中英文 i18n。
- Better Auth Admin plugin 尚未配置。本任务不引入它，也不新增数据库表或 migration；插件调研见 `research/user-management-options.md`。

## Requirements

### R1. 服务端访问控制

- 两个用户目录接口都必须先通过 Better Auth session，再通过 `PermissionKeys.AUTHORIZATION_READ` middleware。
- 未登录返回现有 401；已登录但没有权限返回现有 403 `AUTH.FORBIDDEN`。
- API 只返回用户目录允许的字段，不返回密码、token、OAuth access token、refresh token 或其他账号密钥。

### R2. 用户列表

- `GET /api/users` 接受以下查询参数：`page`（默认 1，最小 1）、`pageSize`（默认 20，最小 1，最大 100）、`search`（最多 120 个字符）和 `roleKey`（可选）。
- `search` 同时匹配用户姓名和邮箱，使用不区分大小写的包含匹配；空白搜索按未提供处理。
- `roleKey` 只匹配活动角色；不传时返回所有用户，用户没有活动角色时返回空角色数组。
- 返回稳定排序的分页结果：用户邮箱升序、用户 ID 升序；响应包含 `items`、`total`、`page` 和 `pageSize`。
- 每个列表项包含 `id`、`name`、`email`、`image`、`emailVerified`、`createdAt`、`updatedAt` 和活动 `roleKeys`。

### R3. 用户详情

- `GET /api/users/{userId}` 按 UUIDv7 查询一个用户；用户不存在返回 404 `COMMON.NOT_FOUND`。
- 详情包含列表项全部字段、去重排序后的 `providers`，以及可为空的公开资料对象：简介、联系邮箱、所在地、工作状态、社交链接、头像 URL 和资料更新时间。
- 详情读取不改变用户、角色、资料、登录账号或 session 数据。

### R4. Admin 页面

- 新增 `/settings/users` 路由，路由元数据声明 `PermissionKeys.AUTHORIZATION_READ`，菜单放在“系统设置”分组。
- 页面提供搜索提交、角色筛选、清空筛选和受控分页；改变搜索或角色后回到第一页。
- 表格显示姓名/邮箱、角色、邮箱验证状态、注册时间和查看详情按钮；长文本可换行或横向滚动，不改变表格结构。
- 详情使用 Drawer 按需请求详情接口，显示账号基础信息、登录方式和公开资料；不提供任何写操作按钮。
- 页面处理列表和详情的 loading、失败、空数据、404 和重试状态；重复打开详情时使用 Query cache，关闭 Drawer 不清除可复用数据。
- 桌面侧栏、移动端菜单、标签栏和直接 URL 访问都使用现有 permission 过滤和 route guard。
- 新增中文和英文文案，图标按钮提供 Tooltip 或 `aria-label`。

### R5. 跨层契约与验证

- 在 `@starter/contracts` 定义列表查询 schema、用户目录列表项、详情和分页响应类型；API OpenAPI schema 与 Admin adapter 使用同一字段。
- API smoke tests 覆盖 401、403、列表默认分页、姓名/邮箱搜索、角色筛选、分页总数、详情成功、详情 404 和当前 RBAC 数据隔离。
- 按项目质量门禁依次运行类型检查、Lint、Format 检查和 API smoke tests；需要浏览器时补做桌面与移动视口手动检查。

## Acceptance Criteria

- [ ] 具有 `authorization:read` 的系统管理员访问 `/settings/users` 后能看到分页用户列表，并能通过姓名或邮箱搜索、按角色筛选。
- [ ] 管理员点击列表项的详情按钮后，Drawer 能显示账号基础信息、角色、登录方式和公开资料；关闭后再次打开不产生布局跳动。
- [ ] 未登录调用 `GET /api/users` 和 `GET /api/users/{userId}` 均返回 401；已登录但无 `authorization:read` 均返回 403；没有该权限的账号看不到菜单且直达 URL 会进入现有 403 页面。
- [ ] 列表分页的 `total` 与筛选条件一致，结果按邮箱和 ID 稳定排序；搜索不区分大小写且同时匹配姓名和邮箱。
- [ ] 不存在的用户详情返回 404；资料缺失时详情仍能返回用户基础信息，资料字段为 `null` 或空集合。
- [ ] 响应不包含密码、session token、OAuth token 和数据库内部授权关系字段。
- [ ] 现有授权设置页、角色编辑接口和 `/api/authorization/users` 的行为不发生回归。
- [ ] `pnpm check-types`、`pnpm lint`、`pnpm format:check` 和 `pnpm test` 全部通过。

## Out of Scope

- 创建用户、编辑用户、修改邮箱、设置或重置密码。
- 封禁/解封、会话列表、撤销会话、模拟登录和物理删除。
- 新用户或角色的写入、角色编辑 UI 重构、Better Auth Admin plugin 和新的数据库 migration。
- Web 公开站点的用户管理页面。
- Organization 多租户、用户组、审计日志和批量导出。
