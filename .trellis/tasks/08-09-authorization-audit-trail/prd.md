# 授权变更审计

## Goal

新增追加式授权审计表，记录每次实际改变授权事实的写入，并提供分页查询接口和 Admin 只读页面。

## Background

父任务：`08-09-rbac-governance`。前置：S2 `08-09-platform-admin-write-boundary` 必须已完成，本任务依赖它引入的 `AuthorizationWriteContext` 和幂等短路。S1 `08-09-admin-test-harness` 提供本任务 Admin 侧的测试基础。

当前问题：`replaceUserRoles` 和 `replaceRolePermissions` 都是 `delete` + `insert`，`assignedAt` / `assignedBy` 只保留最后一次写入信息。撤销记录不存在，无法还原谁在何时移除了哪个角色或权限。

`user_roles` 和 `role_permissions` 是关联表，不是历史表。审计必须用独立的追加式表。

## Product Decision

- 只记录成功且实际改变状态的写入。失败和拒绝不写审计表。当前 `AppError` 4xx 也不写 Pino，所以"拒绝尝试可追查"仍是剩余风险，明确不在本任务解决。
- 一次 mutation 只写一条事件。用户角色替换同时增删多个角色时，before/after 覆盖完整集合，不拆成多条。
- `before_json` / `after_json` 只是 SQLite 存储格式。contracts 定义按 action 判别的联合类型，API 在 presenter 边界解析校验，Admin 收到结构化对象。
- 事件构造器按 action 明确选择字段，不序列化完整数据库 record。
- 审计表不设外键级联删除。用户或角色删除后，历史事件保留原 ID 文本。
- 审计读取用独立 permission `authorization-audit:read`，不要求持有者是 `admin`。`admin` 按现有规则自动获得新 permission。

## Requirements

### R1. 审计表

在 `apps/api/src/modules/authorization/authorization.schema.ts` 增加 `authorization_audit_events` 表：

| 字段          | 类型            | 说明                                       |
| ------------- | --------------- | ------------------------------------------ |
| `id`          | text, PK        | UUIDv7                                     |
| `actor_type`  | text, not null  | `user` 或 `system`                         |
| `actor_id`    | text, not null  | 用户 ID 或系统 actor 标识，不设外键        |
| `action`      | text, not null  | 事件类型，代码维护封闭集合                 |
| `target_type` | text, not null  | `user` 或 `role`                           |
| `target_id`   | text, not null  | 目标用户 ID 或 role key，不设外键          |
| `before_json` | text, not null  | 规范排序后的变更前值                       |
| `after_json`  | text, not null  | 规范排序后的变更后值                       |
| `reason`      | text, nullable  | 变更说明，本版本不强制填写                 |
| `request_id`  | text, nullable  | HTTP mutation 关联；CLI 和 hook 为空       |
| `created_at`  | integer, not null | 服务端写入时间                           |

索引至少覆盖 `created_at`、`actor_id`、`action`、`target_id` 的查询需要。

生成新的 Drizzle migration，只追加表、索引和 permission seed，不修改已提交的 migration。

### R2. 事件写入

覆盖四个入口，每次实际变化写一条：

| 入口                          | action                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| 用户角色替换 API              | `platform_admin.granted` / `platform_admin.revoked` / `user_roles.replaced`   |
| 角色权限替换 API              | `role_permissions.replaced`                                                   |
| Better Auth 新用户默认角色 hook | `user_roles.initialized`                                                     |
| `auth:bootstrap-admin`        | `platform_admin.granted` 或 `user_roles.replaced`                             |

用户角色替换的 action 三选一规则，按目标用户的 `admin` 成员关系变化判断：

- before 无 `admin`、after 有 → `platform_admin.granted`
- before 有 `admin`、after 无 → `platform_admin.revoked`
- 其余情况 → `user_roles.replaced`

三种情况的 before/after 都保存完整角色 key 集合，不只记 `admin` 的变化。

约束：

- 事件插入与关系写入在同一 transaction。任一步失败都不产生部分结果。
- S2 的幂等短路生效时不写事件。
- `actorType === 'user'` 时 `actor_id` 是当前用户 ID，`request_id` 是 `c.var.requestId`。
- `actorType === 'system'` 时 `actor_id` 是稳定标识（`better-auth:user.create`、`auth:bootstrap-admin`），`request_id` 为空。

### R3. 权限与契约

- `packages/contracts/src/index.ts` 的 `PermissionKeys` 增加 `AUTHORIZATION_AUDIT_READ: 'authorization-audit:read'`。
- migration seed 插入对应 permission 记录。
- 定义审计事件的 action 枚举和按 action 判别的响应 DTO 联合。
- 定义分页查询的请求 schema：时间范围、actor、action、target 过滤加分页参数。
- Admin 不接收原始 JSON 字符串。

### R4. 查询接口

```http
GET /api/authorization/audit-events
```

- 权限：`authorization-audit:read`。
- 支持按时间范围、actor、action、target 过滤。
- 分页。
- 固定按 `created_at DESC, id DESC` 排序。相同时间的事件不能因缺少第二排序键而跳页或重复。
- presenter 解析 `before_json` / `after_json` 并按 action 校验。损坏 payload 返回 500，不把原始字符串交给 Admin。
- 声明 401、403 response。

### R5. Admin 审计页

- 新增 route，要求 `authorization-audit:read`。
- 使用现有 Admin 表格、筛选和分页模式，不把审计结果写入 Zustand 或 localStorage。
- before/after 用 contracts 的结构化判别联合展示。
- 长 permission key、用户 ID 和 request ID 可复制，不撑破布局。
- 覆盖 loading、错误、空状态。
- 桌面和移动视口下没有文本或控件重叠。

### R6. 测试

API 侧在 `apps/api/src/test/authorization.smoke.test.ts` 或新建审计测试文件：

- 用户角色替换的三种 action 各有用例，before/after 与最终关系一致。
- 角色权限替换写 `role_permissions.replaced`。
- 新用户注册写 `user_roles.initialized`，actor 是 system，`request_id` 为空。
- `bootstrapAdminByEmail` 首次执行写事件，重复执行不写。
- 幂等无变化的 HTTP 请求不写事件。
- 关系写入失败时审计表无记录（transaction 回滚）。
- 分页在相同 `created_at` 下按 `id` 稳定排序。
- 损坏 JSON payload 返回 500。
- 非持有者访问查询接口返回 403。
- 审计事件不含密码、token、cookie 字段。

Admin 侧复用 S1 的测试基础：

- 审计 route 的 permission guard 行为。
- 审计页的 loading、错误、空状态渲染。

## Out of Scope

- 不记录失败和拒绝操作。
- 不做通用业务审计框架，只覆盖授权模块。
- 不增加审计事件的导出、归档和保留期策略。
- 不给 `AppError` 4xx 增加 Pino 日志。
- 不增加角色创建、编辑、归档、恢复接口和对应事件（`role.created` 等留给后续任务）。
- 不修改现有四张 RBAC 表的结构。
- 不为 migration seed、历史用户回填伪造用户审计事件。
- 不增加 reason 必填校验。

## Acceptance Criteria

- [ ] 四个入口的每次实际变化各产生一条审计事件，before/after 与最终数据库关系一致。
- [ ] 用户角色替换的三种 action 判断正确。
- [ ] 幂等无变化请求不写事件。
- [ ] 关系写入或审计写入任一失败时 transaction 回滚，不产生部分结果。
- [ ] system actor 的 `request_id` 为空，不是伪造值。
- [ ] 审计事件不含密码、token、cookie、文件内容和完整用户记录。
- [ ] 分页在相同 `created_at` 下按 `id` 稳定排序。
- [ ] 损坏 JSON payload 返回 500，Admin 组件内没有 `JSON.parse`。
- [ ] `authorization-audit:read` 已加入 contracts 和 migration seed，`admin` 自动获得。
- [ ] Admin 审计页覆盖 loading、错误、空状态，桌面和移动视口无重叠。
- [ ] migration 只追加，未修改已提交文件。
- [ ] `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm --filter @starter/api db:check` 全部通过。
