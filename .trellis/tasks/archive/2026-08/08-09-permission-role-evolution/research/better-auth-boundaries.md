# Better Auth 权限边界研究

本报告核对仓库固定版本 `better-auth` 1.6.16、当前认证与授权源码，以及 Better Auth 官方 Admin、Organization、Access Control、API Key、M2M、custom session 和 hooks 文档。结论是：当前自建 RBAC 应继续作为全局业务授权的唯一事实来源；Better Auth 继续负责认证和 session。Admin plugin、Organization plugin、API Key 和 OAuth Provider 都不能直接替换当前授权模块，它们只能在各自边界内按需接入。

## 结论摘要

| 分类 | 能力 | 结论 |
| --- | --- | --- |
| 直接复用 | Better Auth 登录、账号、session、`auth.api.getSession` | 已在使用，继续只提供身份认证 |
| 直接复用 | `databaseHooks.user.create.after` | 已用于创建 profile 和默认全局角色，属于认证生命周期副作用 |
| 需要适配 | Admin plugin 的封禁、会话撤销、密码管理 | 需要新增字段、解决 Admin plugin 管理员身份与当前 RBAC 的映射，并处理错误契约 |
| 需要适配 | Organization plugin | 仅在产品确认多租户后接入；接入后必须成为 Organization、member 和组织角色的唯一事实来源 |
| 需要适配 | Better Auth Access Control | 只用于 Admin 或 Organization plugin 自身端点；不能直接读取当前数据库动态角色 |
| 需要适配 | API Key | 是单独的 `@better-auth/api-key` 包；需要设计 key owner、权限快照、撤销和 Hono principal |
| 需要适配 | M2M `client_credentials` | 是 OAuth Provider 范围；机器身份不能伪装成当前用户 session |
| 需要适配 | `customSession` | 只适合给 session 响应增加只读上下文，不应承载 API 授权事实 |
| 自建保留 | `roles`、`permissions`、`user_roles`、`role_permissions` | 保留为全局平台角色和业务权限事实来源 |
| 自建保留 | Hono `requirePermission`、资源 owner 条件、统一错误契约 | Better Auth 插件不替代这些业务边界 |
| 自建保留 | `/api/me/permissions` 和 Admin 前端权限查询 | 比把业务权限塞入 session 更符合当前即时生效和独立缓存设计 |
| 脚手架不内置 | Organization、团队、动态组织角色 | 产品没有多租户需求时不增加这些表和交互 |
| 脚手架不内置 | API Key、OAuth Provider/M2M | 仅在公开 API、自动化或服务间调用出现后作为可选模块加入 |
| 脚手架不内置 | Admin 模拟登录、物理删除用户 | 风险和审计要求高，不作为通用模板默认功能 |

“直接复用”只包含当前已使用的 Better Auth 核心和 hooks。受调研的几个插件都需要数据库、接口或授权来源适配，没有可直接打开且不改变现有边界的插件。

## 版本与安装事实

### 当前仓库

- `pnpm-workspace.yaml` 固定 `better-auth: 1.6.16`。
- `apps/api/package.json`、`apps/admin/package.json` 和 `apps/web/package.json` 通过 catalog 使用该版本。
- `apps/api/src/modules/auth/auth.config.ts` 没有配置任何 Better Auth plugin。
- 仓库没有安装 `@better-auth/api-key` 或 `@better-auth/oauth-provider`。
- 当前 `apps/api/src/modules/auth/auth.schema.ts` 只有 Better Auth 核心的 `user`、`session`、`account`、`verification` 字段，没有 Admin plugin 的 `role`、`banned`、`banReason`、`banExpires`、`impersonatedBy`，也没有 Organization plugin 的表或 `session.activeOrganizationId`。

### 需要先处理的版本问题

`pnpm-workspace.yaml` 固定的 `@better-auth/cli` 是 1.4.21，运行时 `better-auth` 是 1.6.16。当前代码没有使用插件 schema，所以这个差异尚未妨碍现有功能；一旦添加 Admin、Organization 或其他 plugin 后运行 `auth:generate`，旧 CLI 可能生成与 1.6.16 plugin 不一致的 schema。

任何插件实现任务都应先单独核对并统一 Better Auth runtime、CLI 和独立插件包版本，再生成 Drizzle schema。不能直接使用当前 `auth:generate` 作为 1.6.16 plugin schema 的可靠依据。

Better Auth 官方 v1.6.16 release 还单独列出了 `@better-auth/api-key` 和 `@better-auth/oauth-provider` 的修复，说明这两项在该版本线中属于独立包，不是当前 `better-auth` 依赖自动提供的能力。

## 当前认证与授权边界

### Better Auth 负责的内容

`apps/api/src/modules/auth/auth.config.ts` 配置了：

- 邮箱密码、GitHub 和 Google 登录。
- Drizzle adapter 和 Better Auth session。
- 用户创建后的 database hook。
- hook 在同一个 SQLite transaction 中创建 profile，并给新用户写入当前自建的 `operator` 角色。

`apps/api/src/modules/auth/auth.guard.ts` 和 `auth.service.ts` 调用 `auth.api.getSession`，只把 `session.user.id` 写入 Hono 的 `currentUserId`。session 中没有角色或业务权限。

### 自建授权负责的内容

`apps/api/src/modules/authorization/` 当前拥有完整的全局 RBAC：

- `roles` 保存全局角色目录。
- `permissions` 保存代码注册过的 `resource:action` 权限。
- `user_roles` 支持一个用户拥有多个角色。
- `role_permissions` 保存角色与权限关系。
- `findCurrentAuthorization` 计算活动角色权限并集。
- `hasPermission` 每次从数据库读取最新授权关系。
- `admin` 是受保护的系统角色，读取全部已注册且未归档权限。
- `requirePermission` 在 Hono route 进入 service 前返回统一的 403；数据库失败继续成为 500，不伪装成拒绝访问。

`apps/api/src/modules/users/` 直接读取 Better Auth 的用户和账号表，再关联自建角色。用户列表和详情使用当前统一响应契约，不依赖 Better Auth Admin plugin。

`apps/api/src/test/authorization.smoke.test.ts` 已验证默认角色、多角色权限并集、管理员全权限、角色和权限归档立即失效、401/403/500 区分、禁止改自己的角色和禁止改 admin 权限。`apps/api/src/test/users.smoke.test.ts` 已验证用户目录的权限保护、分页、搜索、角色筛选、详情聚合和敏感字段排除。

因此当前事实来源已经明确：

1. Better Auth session 证明“请求来自哪个用户”。
2. 自建授权表回答“该用户当前能做什么”。
3. service/repository 的 owner 或资源条件回答“该用户能否操作这一个资源”。
4. Admin 前端的权限集合只控制导航、页面和按钮，不是安全边界。

## Admin plugin

### 官方能力

Admin plugin 提供创建和查询用户、修改用户资料、设置角色、封禁与解封、设置密码、列出和撤销 session、模拟登录、停止模拟和删除用户。插件给 `user` 增加以下字段：

- `role`
- `banned`
- `banReason`
- `banExpires`

插件还给 `session` 增加 `impersonatedBy`。默认管理员是 `user.role` 包含 `admin` 的用户，或者 ID 位于静态 `adminUserIds` 中的用户。一个用户的多个插件角色存为逗号分隔字符串。

Admin plugin 的 Access Control 是代码定义的 statement 和 role：`createAccessControl` 定义资源与动作，`newRole` 定义每个角色能调用哪些 Admin plugin 操作。它没有使用当前仓库的 `roles`、`user_roles` 或 `role_permissions` 表。

### 与当前 `roles` 的冲突

两套角色不能同时被称为“用户角色”并参与业务授权：

| 冲突点 | 当前自建 RBAC | Admin plugin |
| --- | --- | --- |
| 用户角色存储 | `user_roles` 多行关系 | `user.role` 一个逗号分隔字符串 |
| 角色目录 | `roles` 数据库表 | 服务端配置中的 role 对象 |
| 权限分配 | `role_permissions` 可由管理接口调整 | role statement 在代码中定义 |
| 权限用途 | 所有业务 API | Better Auth Admin plugin 端点 |
| 角色修改入口 | `PUT /api/authorization/users/{id}/roles` | `admin.setRole` |
| 管理员含义 | 当前系统 `admin` 角色拥有全部活动业务权限 | `adminRoles` 或 `adminUserIds` 可调用插件管理端点 |

直接启用 `admin()` 会出现以下错误路径：

1. migration 新增 `user.role`，但已有 `user_roles` 不会自动写入该列。
2. 当前 bootstrap admin 只更新 `user_roles`，Admin plugin 仍会把该用户视为普通用户。
3. 调用 `admin.setRole` 只更新 `user.role`，当前 Hono `requirePermission` 的结果不会改变。
4. 如果分别维护两套 `admin`，撤销其中一套不会撤销另一套能力。
5. Better Auth `/api/auth/admin/*` 返回插件自己的错误格式，不自动使用项目 `{ ok, data/error, meta }` 契约。

Admin plugin 1.6.16 没有官方配置项可以把“当前用户是否为管理员”委托给 `user_roles` 数据库查询。`adminUserIds` 也是静态配置，不适合作为可由后台修改的管理员事实来源。自定义 `ac` 和 `roles` 仍然读取 `user.role`，只能改变插件角色的能力，不能消除第二个角色字段。

### 推荐边界

当前用户列表、用户详情、角色分配和业务授权继续自建，不接入 Admin plugin 的 `listUsers`、`getUser` 或 `setRole`。

只有出现以下明确需求时才单独评估 Admin plugin：

- 封禁账号并阻止后续登录。
- 撤销指定用户的全部 session。
- 由管理员执行密码重置。
- 需要插件提供的模拟登录，且已有完整审计和高风险操作确认。

接入时需要选择并记录一种管理员桥接规则。较可控的方案是把 `user.role` 定义为“Better Auth 管理端点操作角色”的单向投影，而不是业务角色：

- 全局业务角色仍只写 `user_roles`。
- 只有拥有某个明确平台权限的用户才投影为插件管理角色，例如 `auth-admin`。
- 所有会改变该平台权限的入口必须在同一事务或可靠任务中更新投影。
- 部署前做一次全量重建，测试撤销后插件端点立即失效。
- 禁止 Admin 前端显示或修改 `user.role`，禁止调用 `admin.setRole`。

这仍然有同步成本。如果产品只需要“撤销 session”，优先评估在现有 Hono 管理接口中调用 Better Auth 的 session 管理 API，避免为了一个动作引入整套插件角色。若封禁需要影响登录流程，则 Admin plugin 的 schema 和 hook 更有价值，但必须完成上述桥接。

默认不内置模拟登录和物理删除用户。两项操作需要额外审计、通知、关联数据处理和更严格的管理员验证。

## Organization plugin

### 官方能力

Organization plugin 管理：

- `organization`
- `member`
- `invitation`
- session 的 `activeOrganizationId`
- 可选 `team`、`teamMember`
- 开启 dynamic access control 后的 `organizationRole`

默认组织角色是 `owner`、`admin`、`member`。成员可以有多个角色，仍以字符串保存。静态 Access Control 在代码里定义；dynamic access control 开启后，每个组织可以在 `organizationRole` 表中保存运行时角色和 permission JSON。

`activeOrganizationId` 表示当前 session 选中的工作区。官方文档明确允许不把 active organization 持久化到 session，也要求应用自行决定初始组织。它是请求上下文，不是对目标资源组织归属的证明。

### 唯一组织事实来源

如果未来采用 Organization plugin，必须遵守以下边界：

1. Better Auth 的 `organization` 是组织唯一事实来源，不再建立第二张业务 `organizations` 主表。
2. Better Auth 的 `member` 是用户所属组织及组织角色的唯一事实来源。
3. `invitation` 负责加入组织流程，不再自建另一套邀请状态。
4. 需要客户自定义组织角色时，只使用 `organizationRole`；不要再给当前 `roles` 增加 `organization_id`。
5. 当前 `roles/user_roles` 只保留平台级角色，例如 `platform-admin`。它们不能授予某个组织内的普通业务权限。
6. 组织资源必须持久化 `organization_id`。授权时从目标资源或明确 route 参数取得组织 ID，再验证 member 和组织权限。
7. `session.activeOrganizationId` 只提供默认选择。请求中的目标资源组织与 active organization 不一致时必须拒绝，不能只因为 session 有一个 active ID 就信任客户端资源归属。
8. 平台管理员跨组织访问必须走单独且显式的 platform-admin 分支，并写审计记录。不能把平台管理员自动写成每个组织的 owner。

这条边界避免三个角色来源同时存在：全局 `user_roles`、Organization `member.role`、自建 organization-scoped roles。稳定模型只能有两层：平台角色来自当前自建 RBAC，组织角色来自 Organization plugin。

### 从当前数据迁移的边界

Organization 不能通过“给现有查询加一个可选 orgId”渐进完成。当前所有 `operator`、`viewer` 都是全局授权，资源表也没有组织归属。建议按以下顺序另建迁移任务：

1. 先确认产品确实是多租户 SaaS，而不是单租户后台模板。
2. 统一 Better Auth runtime、CLI 和 plugin 版本，生成并人工复核 Organization schema。
3. 定义平台角色与组织角色的名称和职责。当前 `admin` 是否改名为 `platform-admin` 应在迁移设计中明确。
4. 给所有组织资源增加非空 `organization_id`，先完成数据归属规则。
5. 为现有数据创建默认 organization，并为现有用户生成 `member`。
6. 明确映射 `operator`、`viewer` 到组织角色；不能仅按同名字符串复制，因为当前权限可由数据库调整，而静态 Organization role 在代码中定义。
7. 如果必须保留运行时可编辑角色，开启 dynamic access control，并把每个角色的权限转换成 `organizationRole.permission`。否则使用代码定义的少量固定组织角色。
8. 将 API 授权输入改为 `{ userId, organizationId, permission }`，并验证资源归属和 membership。
9. 按业务模块切换读路径。一个模块切换后只能读取 Organization member/role，不再把全局 `operator/viewer` 权限与组织权限取并集。
10. 全部组织资源切换完成后，把现有 `user_roles` 中的租户业务角色移除或重新定义为纯平台角色。
11. 让旧 session 重新选择 active organization；不能假设新增字段后旧 session 已有正确上下文。

当前 `user_roles.assignedBy` 和 `role_permissions.assignedBy` 记录了分配人，Organization `member` 默认 schema 没有等价的 `assignedBy`。若该信息需要保留，应新增独立授权审计事件，不能假设 plugin migration 会自动承接。

### 何时启用 dynamic access control

脚手架默认不要开启 dynamic access control。只有同时满足以下条件才值得增加 `organizationRole`：

- 每个租户确实需要创建自己的角色。
- 不同租户的角色权限组合不能用固定 `owner/admin/member` 或少量代码角色表达。
- 产品愿意承担角色编辑器、影响分析、权限升级限制、角色删除保护和审计成本。

如果组织角色由产品代码固定，使用 plugin 静态 Access Control 更简单，也能让 TypeScript 推导 resource/action。

## Access Control 的适用范围

Better Auth 的 `createAccessControl` 接受 `{ resource: [actions] }` statement，再通过 `newRole` 创建代码角色。Admin 和 Organization plugin 都用这套工具保护自己的端点。

它与当前 RBAC 有三个本质差异：

- role 与 permission 默认在代码中，不从当前数据库表读取。
- Admin Access Control 读取 `user.role`；Organization Access Control 读取 `member.role`。
- Organization 的 dynamic access control 只把角色存到具体 organization，不提供全局平台角色替代品。

因此不建议把 `createRequirePermission` 改成 Better Auth `hasPermission`。当前 Hono guard 需要读取可由管理页修改并立即生效的数据库关系，还需要遵守项目 401/403/500 错误契约。Better Auth `hasPermission` 适合检查插件自己的 Admin 或 Organization 操作，不是通用业务策略引擎。

如果以后采用 Organization plugin，可以复用相同的 `PermissionKeys` resource/action 命名来生成 Access Control statement，但必须建立一个明确转换模块，不能在两边分别手写字符串。平台权限和组织权限即使名字相同，也应通过不同 subject/context 调用，避免无意继承。

## API Key 与 M2M

### API Key

官方 API Key plugin 已拆为 `@better-auth/api-key`。当前仓库未安装。它支持：

- 创建、查询、更新、删除和验证 key。
- key 前缀、过期、remaining/refill、metadata。
- key 自身的 resource/action permissions。
- 验证时限流。
- user-owned 或 organization-owned key。
- 可选从 user-owned key 模拟 session。

官方明确提示 `enableSessionForAPIKeys` 通常不推荐：key 泄露后可模拟用户。该能力也只支持 user-owned key，不支持 organization-owned key。

对于本脚手架，API Key 应是可选模块，不是默认认证方式。进入条件是出现公开 API、CLI、自动化脚本或外部集成。接入时应满足：

1. Hono principal 显式区分浏览器用户、API key 和机器客户端，不能把所有凭据都压成 `currentUserId`。
2. key 权限默认只能是创建者当前权限的子集。
3. 明确 key permission 是签发时快照还是每次与当前角色求交集。
4. 如果选择快照，角色撤销不会自动撤销 key 权限，必须提供 key 撤销和影响提示。
5. 如果选择每次求交集，验证路径要额外读取当前 RBAC，且 organization key 必须同时验证组织状态。
6. key secret 只在创建时返回，数据库只存安全摘要；日志不得记录原始 key。
7. 业务 API 仍通过自建授权适配层解释权限，不直接把 API Key plugin 的 mock session 当成普通用户 session。

Organization-owned key 依赖 Organization plugin 的 membership 和 `apiKey` 管理权限。没有 Organization plugin 时不要自建一个名称相同但关系不同的 organization key 模型。

### M2M

官方当前 OAuth Provider 文档使用独立的 `@better-auth/oauth-provider`，支持 `client_credentials`，用于机器到机器 access token。当前仓库没有安装这个包。固定版本 1.6.16 的 `better-auth` 包内还有 legacy `oidcProvider`，本地分发代码也包含 `client_credentials`；但官方 1.7 升级文档要求把旧 provider 迁移到独立 OAuth Provider，并说明 client 表和 token 表不是直接兼容。

因此不能根据最新文档直接在当前 1.6.16 配置中复制示例。M2M 实现前要先决定：

- 继续固定 1.6.16 并采用与该版本匹配的 provider 包；或
- 先完成 Better Auth 1.7 升级和 provider 数据迁移，再实现 M2M。

M2M token 的 subject 是 OAuth client/service，不是用户。资源服务器需要验证 issuer、audience、签名、有效期和 scope，再把 scope 映射为允许的业务权限。`client_credentials` 没有登录用户，不能创建虚构 user 记录来复用 `currentUserId`。

通用脚手架默认不内置 OAuth Provider。只有出现多个可信服务、第三方机器客户端、标准 token 颁发和撤销要求时才值得加入。少量内部定时任务如果与 API 同进程，应直接调用 service，不需要 M2M。

## custom session 与 hooks

### `customSession`

官方文档允许 `customSession` 修改 `getSession/useSession` 响应，例如附加 roles。1.6.16 本地类型表明该 plugin 覆盖 `getSession` 响应，并在回调中提供 `user`、`session` 和 endpoint context。

官方同时说明：secondary storage 和 cookie cache 不缓存 custom fields，每次获取 session 都会调用 custom session 函数。这意味着把当前权限并集放入 custom session 并不会减少授权数据库读取；它只会让所有 session 查询都承担额外权限查询。

当前继续保留 `/api/me/permissions` 更合适：

- 认证接口保持稳定，只返回身份和 session。
- 权限查询有独立的 React Query key、重试和失效逻辑。
- 权限响应有 `version`，适合前端识别变化。
- API guard 仍按数据库最新值授权，不信任客户端 session 响应。

未来若 Organization UI 需要在 session 响应中显示 active organization 名称，可以使用 `customSession` 增加只读展示字段。但 authorization guard 必须重新验证 membership 和目标资源 organization，不能直接信任 custom session 返回的角色或权限数组。

### hooks

Better Auth endpoint `hooks.before/after` 可以按 `ctx.path` 修改请求或响应、抛出 `APIError`、读取 auth context，并执行登录后副作用。database hooks 可以在 user、session、account 数据变化前后运行。当前 default role/profile 初始化已经正确使用 database hook。

推荐边界：

- 认证生命周期副作用继续使用 Better Auth database hooks。
- 对 Better Auth 自己的端点增加前置限制时使用 endpoint hooks。
- Hono 业务 API 继续使用 `requireAuth` 和 `requirePermission`。
- 不在 `hooks.after` 中异步修补关键授权关系；如果请求已经成功而 hook 写入失败，会产生用户已创建但角色缺失的问题。当前同步 transaction 行为应保留并测试。
- 不用 endpoint hook 代替项目错误处理中间件。`/api/auth/*` 本来就不使用项目 JSON 包装，业务 API 仍应返回当前统一错误契约。

如果将来用 hook 保护 Admin plugin 端点，hook 只能作为额外检查。Admin plugin 内部仍会读取 `user.role` 或 `adminUserIds`，所以 hook 不能独自解决两套管理员事实来源。

## 推荐决策

### 近期默认能力

- 保留 Better Auth 核心认证和 session。
- 保留当前数据库驱动的全局 RBAC。
- 保留独立 `/api/me/permissions`。
- 保留 Hono `requirePermission` 和资源 owner 条件。
- 把 Better Auth runtime/CLI 版本一致性加入任何 plugin 任务的前置检查。

### 条件成熟后增加

- 账号封禁和 session 管理：单独评估 Admin plugin，只采用身份治理部分，不采用 `setRole` 作为业务角色入口。
- 多租户：产品明确需要 Organization、成员邀请和组织隔离后，采用 Organization plugin，并按本报告迁移到唯一组织事实来源。
- API Key：出现外部自动化或公开 API 后，作为可选模块接入。
- M2M：出现独立服务或第三方机器客户端后，先处理 provider 版本路线，再采用 OAuth `client_credentials`。
- custom session：只在确有合并只读 session 上下文的收益时使用。

### 脚手架不内置

- Admin plugin 角色作为业务 RBAC。
- Organization 和动态组织角色的默认 schema。
- API Key session 模拟。
- OAuth Provider/M2M server。
- 模拟登录、物理删除用户。
- 同时从全局角色和组织角色向同一个组织资源授予权限。

## 后续实现任务的检查项

任何 Better Auth plugin 实现任务都应独立完成以下验证：

1. runtime、CLI、独立 plugin 包版本兼容。
2. 生成的 Drizzle schema 与 plugin 1.6.16 类型逐字段核对。
3. migration 对已有用户和 session 的回填策略明确。
4. 新增端点的 401、403、500 和项目错误契约明确。
5. 授权撤销后，下一次 API 请求立即失效。
6. 不存在两个可以独立修改同一角色含义的入口。
7. 浏览器用户、organization member、API key 和 OAuth client 的 principal 类型不混用。
8. 插件端点有 smoke test，且测试覆盖最小权限、撤销、归档或封禁后的行为。

## 官方来源

- [Better Auth Admin plugin](https://www.better-auth.com/docs/plugins/admin)：用户管理、`user.role`、封禁、session、模拟登录、Access Control 和 schema。
- [Better Auth Organization plugin](https://www.better-auth.com/docs/plugins/organization)：organization、member、invitation、active organization、组织角色、dynamic access control、teams 和 schema。
- [Better Auth Session Management](https://www.better-auth.com/docs/concepts/session-management)：session freshness、cookie cache、secondary storage 和 custom session；custom fields 每次获取 session 时重新计算。
- [Better Auth Hooks](https://www.better-auth.com/docs/concepts/hooks)：endpoint before/after hooks、`createAuthMiddleware`、`APIError` 和 auth context。
- [Better Auth Database](https://www.better-auth.com/docs/concepts/database)：核心 schema、plugin schema、additional fields 和 database hooks。
- [Better Auth API Key](https://www.better-auth.com/docs/plugins/api-key)：独立包安装、key 创建与验证、user/organization owner。
- [Better Auth API Key Advanced Features](https://www.better-auth.com/docs/plugins/api-key/advanced)：API key session、multiple configurations、organization key、storage 和 rate limiting。
- [Better Auth API Key Reference](https://www.better-auth.com/docs/plugins/api-key/reference)：permissions、referenceId、schema 和安全存储选项。
- [Better Auth OAuth 2.1 Provider](https://www.better-auth.com/docs/plugins/oauth-provider)：OAuth Provider、`client_credentials`、scope、token 和资源服务器验证。
- [Upgrading to Better Auth 1.7](https://www.better-auth.com/docs/guides/1-7-upgrade-guide)：从 1.6 legacy provider/MCP 到独立 provider 包时的 client/token schema 迁移边界。
- [Better Auth v1.6.16 release](https://github.com/better-auth/better-auth/releases/tag/v1.6.16)：固定版本发布日期和 Admin、Organization、API Key、OAuth Provider 相关修复。

## 仓库依据

- `pnpm-workspace.yaml`
- `apps/api/package.json`
- `apps/api/src/modules/auth/auth.config.ts`
- `apps/api/src/modules/auth/auth.schema.ts`
- `apps/api/src/modules/auth/auth.guard.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/authorization/authorization.schema.ts`
- `apps/api/src/modules/authorization/authorization.repository.ts`
- `apps/api/src/modules/authorization/authorization.guard.ts`
- `apps/api/src/modules/authorization/authorization.service.ts`
- `apps/api/src/modules/authorization/authorization.route.ts`
- `apps/api/src/modules/users/users.repository.ts`
- `apps/api/src/modules/users/users.service.ts`
- `apps/api/src/modules/users/users.route.ts`
- `apps/api/src/test/authorization.smoke.test.ts`
- `apps/api/src/test/users.smoke.test.ts`
- `apps/admin/src/api/client.ts`
- `apps/admin/src/app/router/auth-guard.ts`
- `apps/admin/src/hooks/usePermission.ts`
- `packages/contracts/src/index.ts`
