# 实现当前脚手架的用户权限 RBAC

## Goal

把全局 RBAC 做成当前 TypeScript 全栈脚手架的标准能力。新部署的项目可以定义权限、给用户分配角色、在 API 端保护接口，并在 Admin 中按权限显示菜单、路由和操作；API 的授权结果始终以服务端数据库为准。

## User Value

脚手架接入业务模块后，不需要重新设计用户、角色和权限的基础关系，也不会因为只隐藏前端按钮而留下未保护的 API。管理员可以在后台查看用户角色、调整角色权限，被撤销权限的账号在下一次受保护请求时立即失去访问权。

## Confirmed Facts

- API 使用 Better Auth cookie session、Hono、Drizzle ORM 和 SQLite。`apps/api/src/modules/auth/auth.guard.ts` 在认证成功后把 `session.user.id` 写入 `currentUserId`。
- API 自有 JSON 接口通过 `createSuccessResponse`、`createFailureResponse` 返回统一结构，`AppError` 已支持 HTTP 403，但 `packages/contracts/src/index.ts` 尚未定义 `AUTH.FORBIDDEN`。
- 数据库表由模块 schema 汇总到 `apps/api/src/infra/db/schema/index.ts`，测试通过 `apps/api/src/test/helpers.ts` 在临时 SQLite 中执行 migration。
- Admin 使用 TanStack Router、TanStack Query、Ant Design 和 React。`apps/admin/src/app/router/auth-guard.ts` 目前只检查登录态，`apps/admin/src/app/navigation/navigation.ts` 从路由记录生成菜单。
- 已归档探索任务 `.trellis/tasks/archive/2026-08/08-09-explore-user-permissions/research.md` 确认首版采用全局 User -> Role -> Permission 模型；不支持通配符、角色继承、用户直接分配 permission、Redis 或 Organization 多租户。

## Requirements

### R1. 持久化授权模型

- 新增 `roles`、`permissions`、`user_roles`、`role_permissions` 四张 SQLite 表，并生成可执行的 Drizzle migration。
- 角色和权限使用稳定唯一 key、系统数据标记、创建更新时间和归档时间；关联表使用复合主键、外键、必要索引和明确的删除行为。
- 权限 key 采用 `resource:action`。首版只支持精确匹配，角色权限按用户所有活动角色求并集。
- 权限目录由代码常量定义，数据库保存可分配目录和角色关系。管理员不能通过接口创建未注册的权限。
- 提供可重复执行的初始数据方案，预置 `admin`、`operator`、`viewer` 系统角色。`admin` 拥有全部权限且权限集合不可由管理接口修改；`operator` 保留当前账号对自有文件的全部操作；`viewer` 只能查看和读取自有文件。
- migration 给现有用户补 `operator` 角色，新注册用户也默认获得 `operator`，避免 RBAC 上线后破坏现有资料和文件流程。

### R2. API 授权边界

- 新增独立 authorization 模块，提供 `createRequirePermission(db, permission)` 形式的 Hono middleware。
- `requirePermission` 必须排在 `requireAuth` 后，从 `c.var.currentUserId` 查询数据库，不接受客户端提交的角色或权限集合。
- 授权查询只使用未归档角色、未归档权限和有效关联。数据库查询失败返回 500，不降级为允许或 403。
- 已登录但无权限统一返回 HTTP 403 和 `AUTH.FORBIDDEN`；未登录或 session 无效继续返回现有 401 code。
- 需要 RBAC 的管理接口同时声明 401、403 OpenAPI response。资源所有权判断仍由业务 service 独立执行。

### R3. 权限与管理 API

- 提供当前用户权限查询接口 `GET /api/me/permissions`，返回当前角色、精确权限集合和根据排序后授权集合生成的稳定版本值。
- 提供 `GET /api/authorization/users` 和 `GET /api/authorization/roles` 管理查询，以及替换用户角色、替换角色权限的 `PUT` 接口。
- 管理查询由 `authorization:read` 保护，管理 mutation 由 `authorization:manage` 保护；更新角色时至少保留一个活动角色，并禁止调用者修改自己的角色。
- 系统角色和系统权限不能被普通管理操作删除或改 key，归档项不能继续授予新关系；`admin` 角色始终包含全部活动权限，管理接口不能修改它的权限集合。

### R4. Admin 权限体验

- 在 `@starter/contracts` 定义权限 DTO、权限类型和 `AUTH.FORBIDDEN`，API 与 Admin 使用同一套 key 和 response 字段。
- 在 Admin 新增权限 API adapter、TanStack Query hooks、纯权限判断函数、`usePermission` 和 `PermissionGuard`。
- 路由记录增加可选 permission 元数据。菜单过滤、直接访问 URL 的路由守卫和页面内按钮控制使用同一权限声明。
- 权限加载中显示稳定的 loading 状态；加载失败不默认放行并提供重试；缺少页面权限显示现有风格的 403 页面；403 不触发退出登录，401 才跳转登录。
- 角色和权限管理页面至少支持用户列表、用户角色分配、角色权限勾选保存，并覆盖 loading、空数据、失败和 mutation pending 状态。

### R5. 现有业务接入

- 为文件管理定义 `file:list`、`file:read`、`file:upload`、`file:rename`、`file:delete`，分别接入 Admin 路由、按钮和对应 API middleware。
- 现有个人资料接口继续只要求登录。文件 repository 和 service 的 owner 条件保持不变，任何文件 permission 都只允许操作当前用户自己的资源。
- 现有账号在 migration 后继续拥有原来的自有文件能力；把用户改为 `viewer` 后，写操作在 UI 中隐藏，直接请求 API 返回 403。

### R6. 验证与维护

- API smoke tests 覆盖未登录 401、无权限 403、有权限、多角色并集、归档关系失效、权限变更即时生效、当前用户隔离和 owner 边界。
- Admin 至少通过类型检查、Lint、Format；交互代码覆盖权限 query 的 loading、失败、403 刷新和 401 跳转路径的可验证行为。
- 变更后按项目质量门禁依次通过 type-check、lint、format，并运行 API smoke tests；migration 在临时 SQLite 中执行成功。

## Initial Admin Bootstrap

- 新增可选环境变量 `AUTH_BOOTSTRAP_ADMIN_EMAIL`，只标识要提升的已存在账号，不参与普通注册流程。
- 新增显式且可重复执行的 `auth:bootstrap-admin` 命令。命令读取该邮箱，把目标用户的角色替换为系统 `admin`；未配置邮箱或用户不存在时返回明确错误并停止。
- API 启动和普通注册不会自动产生管理员，也不会根据注册顺序提权。

## Out of Scope

- Better Auth JWT、Access Token claim、Redis、WebSocket 和外部权限服务。
- 通配符权限、角色继承、用户直接 permission、完整审计日志、ABAC 规则引擎和 Organization 多租户。
- 自定义角色或权限的创建、删除和归档 UI。首版只管理预置角色的用户关系和非 `admin` 角色的权限集合。
- Web 公开站点的业务页面权限；本任务的权限 UI 和管理流程只覆盖 Admin。
- 与 RBAC 无关的用户资料、文件存储、主题和布局重构。

## Acceptance Criteria

- [x] 临时 SQLite 执行新增 migration 后存在四张授权表、约束和初始角色/权限数据。
- [x] 受保护 API 在无 session、无 permission、有 permission 三种情况下分别返回预期的 401、403、2xx。
- [x] 一个用户拥有多个角色时权限为活动角色权限的并集；归档角色或权限不再授权。
- [x] `GET /api/me/permissions` 只返回 cookie session 对应用户的数据，不能通过请求参数读取其他用户权限。
- [x] 角色分配和角色权限保存使用事务，普通用户无法修改自身或他人的授权关系。
- [x] Admin 菜单、路由守卫、`PermissionGuard` 和按钮控制共享同一 permission key；权限请求失败不默认放行。
- [x] 管理页面可以查看用户角色、调整角色、编辑角色权限并在保存后刷新显示。
- [x] 现有资源 owner 检查仍然有效，前端隐藏操作不能绕过 API 授权。
- [x] migration 给已有用户补 `operator`，新注册用户默认获得 `operator`；bootstrap 命令只把显式邮箱对应的已存在用户设为 `admin`，重复执行结果不变。
- [x] `pnpm check-types`、`pnpm lint`、`pnpm format:check` 和 `pnpm test` 全部通过。
