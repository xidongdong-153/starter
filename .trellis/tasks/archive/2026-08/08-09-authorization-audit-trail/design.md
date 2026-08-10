# 授权变更审计设计

## 结论

审计插入复用 S2 已经打通的 transaction 路径：三个 repository 写函数已经在同一 `db.transaction` 内完成 actor 校验、before 读取和关系写入，本任务只在写入之后追加一条 insert。

`better-sqlite3` 的 transaction 是同步的，这是整个设计成立的前提：审计写入不需要队列、不需要事后补写、不需要额外的一致性机制。审计写入抛错会连带回滚关系变更。

分页查询复用 `users` 模块已有的 `page` / `pageSize` + `count` 范式，不引入 cursor 分页。

## 1. 表结构

在 `authorization.schema.ts` 追加，风格与现有四张表一致（`timestamp` helper、`sqliteTable`、数组形式的索引定义）：

```ts
export const authorizationAuditEvents = sqliteTable(
  "authorization_audit_events",
  {
    id: text("id").primaryKey(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    reason: text("reason"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("authorization_audit_created_at_idx").on(table.createdAt, table.id),
    index("authorization_audit_actor_idx").on(table.actorId, table.createdAt),
    index("authorization_audit_action_idx").on(table.action, table.createdAt),
    index("authorization_audit_target_idx").on(table.targetId, table.createdAt),
  ],
);
```

设计要点：

- `actorId` 和 `targetId` 不设 `references()`。用户或角色删除后历史必须保留，这与 `user_roles` 的级联删除策略相反，是有意的。
- 主排序索引是 `(created_at, id)` 复合索引，直接支撑 `ORDER BY created_at DESC, id DESC`。
- 三个过滤索引都以 `createdAt` 作为第二列，让"过滤 + 排序"走同一索引。
- `id` 用 UUIDv7（contracts 已有 `uuidSchema = z.uuidv7()`，`uuidv7` 包已在 catalog）。UUIDv7 单调递增，所以 `id DESC` 作为第二排序键与插入顺序一致。
- 不加 `relations()`。审计表不参与 Drizzle 关系查询，避免把它当成可 join 的业务表。

汇总到 `apps/api/src/infra/db/schema/index.ts`，然后 `pnpm --filter @starter/api db:generate`。

## 2. 事件类型

在 `apps/api/src/modules/authorization/` 定义封闭集合：

```ts
export const AuditActions = {
  PLATFORM_ADMIN_GRANTED: "platform_admin.granted",
  PLATFORM_ADMIN_REVOKED: "platform_admin.revoked",
  ROLE_PERMISSIONS_REPLACED: "role_permissions.replaced",
  USER_ROLES_INITIALIZED: "user_roles.initialized",
  USER_ROLES_REPLACED: "user_roles.replaced",
} as const;
```

action 决定 payload 形状：

| action                      | target_type | target_id | before / after 内容       |
| --------------------------- | ----------- | --------- | ------------------------- |
| `platform_admin.granted`    | `user`      | user ID   | `{ roleKeys: string[] }`  |
| `platform_admin.revoked`    | `user`      | user ID   | `{ roleKeys: string[] }`  |
| `user_roles.replaced`       | `user`      | user ID   | `{ roleKeys: string[] }`  |
| `user_roles.initialized`    | `user`      | user ID   | `{ roleKeys: string[] }`  |
| `role_permissions.replaced` | `role`      | role key  | `{ permissionKeys: Permission[] }` |

四个用户角色类 action 共用同一 payload 形状。判别联合的意义在于 Admin 展示时能按 action 决定文案和字段，而不是靠猜。

## 3. 用户角色替换的 action 判断

在 S2 已有的 before/after 集合基础上判断：

```ts
function resolveUserRolesAction(before: string[], after: string[]) {
  const hadAdmin = before.includes(RoleKeys.ADMIN);
  const hasAdmin = after.includes(RoleKeys.ADMIN);
  if (!hadAdmin && hasAdmin) return AuditActions.PLATFORM_ADMIN_GRANTED;
  if (hadAdmin && !hasAdmin) return AuditActions.PLATFORM_ADMIN_REVOKED;
  return AuditActions.USER_ROLES_REPLACED;
}
```

三种情况的 before/after 都写完整角色集合。`platform_admin.granted` 不是"只记 admin 变化"的事件，它是"这次变化里包含 admin 授予"的标签。

## 4. 事件构造器

关键约束是不序列化数据库 record。构造器只接受已经算好的 key 数组：

```ts
interface AuditEventInput {
  actorType: "user" | "system";
  actorId: string;
  action: AuditAction;
  targetType: "user" | "role";
  targetId: string;
  before: AuditPayload;
  after: AuditPayload;
  requestId: string | null;
}
```

`AuditPayload` 是 `{ roleKeys: string[] }` 或 `{ permissionKeys: Permission[] }`。数组在传入前已排序（S2 的 before 读取带 `orderBy`，after 是 `[...set].sort()`）。

插入时 `JSON.stringify(input.before)`。因为 payload 类型是封闭的，不可能带上 `passwordHash`、`token` 之类的字段，这比"记得不要序列化 record"更可靠。

## 5. 写入点

### 5.1 两个 repository 写函数

S2 的 transaction 顺序在第 7 步（`delete` + `insert`）之后追加：

```text
7. delete + insert 关系
8. insert 审计事件      ← 本任务新增
9. 返回 ok
```

第 5 步幂等短路直接返回，天然不写事件，不需要额外判断。

### 5.2 `bootstrapAdminByEmail`

S2 已加 before 读取和幂等短路。action 判断：before 无 `admin` → `platform_admin.granted`；before 有 `admin` 但集合变化 → `user_roles.replaced`。actor 是 `{ actorType: 'system', actorId: 'auth:bootstrap-admin', requestId: null }`。

### 5.3 Better Auth user create hook

`auth.config.ts` 的 hook 不走 repository，它直接在自己的 `db.transaction` 里 `tx.insert(profiles)` 和 `tx.insert(userRoles)`。

这里要加第三条 insert，action 是 `user_roles.initialized`，actor 是 `{ actorType: 'system', actorId: 'better-auth:user.create', requestId: null }`，before 是 `{ roleKeys: [] }`，after 是 `{ roleKeys: ['operator'] }`。

不把 hook 改成调用 repository。它的事务里还有 `profiles` 插入，属于 auth 模块职责，本任务只在现有 transaction 内追加一条 insert。审计构造器从新建的 `authorization.audit.ts` 导入，不会引入循环依赖，理由见第 9 节。

## 6. 查询接口

### 6.1 请求 schema

复用 `userManagementQuerySchema` 的形状：

```ts
export const authorizationAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.enum(AuditActionValues).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  targetId: z.string().trim().min(1).max(64).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
```

`action` 用 `z.enum`，未知 action 直接 400，不做模糊匹配。

### 6.2 响应 DTO

```ts
export type AuthorizationAuditEvent = {
  id: string;
  actorType: "user" | "system";
  actorId: string;
  targetType: "user" | "role";
  targetId: string;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
} & (
  | {
      action:
        | "platform_admin.granted"
        | "platform_admin.revoked"
        | "user_roles.replaced"
        | "user_roles.initialized";
      before: { roleKeys: string[] };
      after: { roleKeys: string[] };
    }
  | {
      action: "role_permissions.replaced";
      before: { permissionKeys: Permission[] };
      after: { permissionKeys: Permission[] };
    }
);

export interface AuthorizationAuditEventPage {
  items: AuthorizationAuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}
```

分页壳与 `UserManagementUserPage` 一致。

### 6.3 排序与分页

```ts
.orderBy(desc(authorizationAuditEvents.createdAt), desc(authorizationAuditEvents.id))
.limit(query.pageSize)
.offset((query.page - 1) * query.pageSize)
```

`desc` 需要补进 `drizzle-orm` 导入。`(created_at, id)` 复合索引直接支撑这个排序，相同时间戳不会跳页或重复。

### 6.4 Payload 解析

在 presenter 层解析，不在 route 也不在 Admin：

```ts
function parsePayload(action: string, json: string): AuditPayload {
  const parsed = payloadSchemaFor(action).safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new AppError(
      ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      "审计事件数据损坏",
      500,
    );
  }
  return parsed.data;
}
```

`JSON.parse` 本身也可能抛 `SyntaxError`。用 try/catch 包住，统一转成 500。这样损坏数据不会以 `SyntaxError` 形式冒到全局 error handler 变成未知异常（那条路径会写 Pino error，反而更吵）。

用 Zod 校验而不是类型断言，是因为这些 JSON 来自历史数据，schema 可能随版本变化。

## 7. Admin 页面

放在 `apps/admin/src/features/authorization/` 下，与现有授权设置页同目录。

route 加 `permission: PermissionKeys.AUTHORIZATION_AUDIT_READ`。

数据层复用现有形状：`authorization.api.ts` 加 fetch 函数，`authorization.query.ts` 加 query key 和 query options。审计是只读数据，不需要 mutation 和失效逻辑。

query key 加一层：

```ts
auditEvents: (query: AuthorizationAuditQuery) =>
  [...authorizationQueryKeys.all, 'audit-events', query] as const,
```

展示：Antd `Table` + 筛选表单 + `Pagination`。before/after 用 `Tag` 列出 key 差异，不显示原始 JSON。`actorId`、`targetId`、`requestId` 用 `Typography.Text` 的 `copyable` 加 `ellipsis`，满足"可复制但不撑破布局"。

不把查询参数写进 Zustand 或 localStorage。筛选状态放组件内 `useState`，或用 TanStack Router 的 search params。倾向后者：刷新和分享链接能保留筛选条件，且与 route 层一致。

## 8. 测试策略

### 8.1 API

现有 `authorization.smoke.test.ts` 已经 900 行以上，新建 `apps/api/src/test/authorization-audit.smoke.test.ts`，复用 `helpers.ts` 的临时数据库注入。

需要单独设计的两个用例：

一是 transaction 回滚。构造关系写入成功但审计插入失败的场景。可行做法：在测试里用一个 `actorId` 超长的上下文触发 SQLite 约束错误，或直接 spy repository 内部。倾向前者，因为不依赖实现细节。如果找不到稳定的触发方式，改为断言"审计插入抛错时关系表无变化"的等价用例，并在 implement.md 记录取舍。

二是损坏 payload。直接用 `sqlite.prepare('INSERT INTO ...').run()` 写一条 `before_json` 为 `'not json'` 的记录，然后请求查询接口断言 500。`helpers.ts` 已经暴露了 `sqlite` 句柄，可以直接写。

其余用例按 PRD R6 列表实现。

### 8.2 Admin

复用 S1 的 Vitest + jsdom 环境。覆盖审计 route 的 permission guard 和页面三态渲染。不测 Antd Table 内部行为。

## 9. 风险

- Better Auth hook 加审计插入后，注册流程的 transaction 变长。如果插入失败，用户注册整体失败。这是正确行为（不能有角色初始化却无审计记录），但要在测试里确认失败信息可读。
- `auth.config.ts` 导入 authorization 的审计构造器，增加模块间耦合。已核实不会形成循环：当前 authorization 单向导入 auth（`authorization.schema.ts` 导入 `user`，`authorization.route.ts` 导入 `createRequireAuth`），auth 模块没有任何对 authorization 的导入。而 `auth.config.ts` 已经从 `@api/infra/db/schema/index.js` 导入 `roles` 和 `userRoles`，那个汇总文件本身已经展开了 `authorization.schema.ts`。约束：审计构造器放在新文件 `authorization.audit.ts`，只允许导入 `@starter/contracts` 和 `@api/infra/db/schema/index.js`，不得导入 `@api/modules/auth/index.js` 或 `auth.config.ts`。
- 审计表会持续增长，没有保留期策略。单租户脚手架规模下可接受，但要在 spec 里写明这是已知的运维事项。
- `z.iso.datetime()` 的 `from` / `to` 需要转成 SQLite 的 `timestamp_ms` 整数比较。`timestamp` helper 是 `mode: 'timestamp_ms'`，Drizzle 会自动处理 `Date` 对象，传入前先 `new Date(query.from)`。
- Admin 页面的筛选参数如果走 search params，需要与 TanStack Router 的 `validateSearch` 配合。当前 Admin 没有用过 search params 校验，是新模式。如果成本超预期，降级为组件内 `useState` 并记录。

## 10. 回滚

- 审计表是追加数据。代码回滚后保留表，旧授权查询不读它，不影响运行。
- migration 只追加表、索引和一条 permission seed。回滚不删除已提交 migration，也不删除审计历史。
- `authorization-audit:read` permission 回滚时先停止 route 使用，再归档目录记录，不直接删 contracts 常量（`admin` 自动获得全部注册 permission，删常量会让数据库里的记录变成孤儿）。
- Better Auth hook 的审计插入回滚后，注册流程回到只写 profile 和默认角色，无数据残留问题。
