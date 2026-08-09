# 平台管理员写入边界设计

## 结论

改动集中在 `authorization.repository.ts` 的三个写函数，加上 service 的错误翻译、route 的上下文传参和 contracts 的一个 error code。不新增表、不新增接口、不动 Admin。

关键前提：`better-sqlite3` 的 `db.transaction` 是同步的。现有 `replaceUserRoles` 和 `replaceRolePermissions` 已经是同步函数，返回值直接是结果对象而不是 Promise。所以 actor 校验、before 读取、关系写入天然落在同一 transaction 内，不需要引入额外机制。S3 的审计插入同理。

## 1. 写入上下文

```ts
export interface AuthorizationWriteContext {
  actorType: "user" | "system";
  actorId: string;
  requestId: string | null;
}
```

替换现有的 `assignedBy: string` 参数。`assignedBy` 的写入规则保持当前行为：

| actorType | `assignedBy` 写入值 | 当前对应行为                          |
| --------- | ------------------- | ------------------------------------- |
| `user`    | `actorId`           | HTTP 写操作现在传 `actorUserId`       |
| `system`  | `null`              | hook 和 bootstrap 现在传 `null`       |

`requestId` 本任务不落库，只为 S3 的审计表准备。放进本任务是因为三个写函数的签名只改一次。

调用点：

| 调用点                        | 上下文                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `replaceUserRoles` route      | `{ actorType: 'user', actorId: c.var.currentUserId, requestId: c.var.requestId }`  |
| `replaceRolePermissions` route | 同上                                                                              |
| `bootstrap-admin` 脚本         | `{ actorType: 'system', actorId: 'auth:bootstrap-admin', requestId: null }`        |

`auth.config.ts` 的 user create hook 不走 repository，它直接用 `tx.insert(userRoles)`。本任务不改它，S3 需要审计时再处理。

## 2. Repository 返回类型扩展

保持现有 discriminated union 风格，不在 repository 抛 `AppError`：

```ts
export type ReplaceUserRolesResult =
  | { kind: "ok"; user: AuthorizationUserRecord; roleKeys: string[] }
  | { kind: "user-not-found" }
  | { kind: "invalid-role-keys"; invalidKeys: string[] }
  | { kind: "actor-not-platform-admin" }
  | { kind: "last-platform-admin" };

export type ReplaceRolePermissionsResult =
  | { kind: "ok"; role: AuthorizationRoleRecord; permissionKeys: string[] }
  | { kind: "role-not-found" }
  | { kind: "invalid-permission-keys"; invalidKeys: string[] }
  | { kind: "actor-not-platform-admin" };

export type BootstrapAdminResult =
  | { kind: "ok"; user: AuthorizationUserRecord }
  | { kind: "user-not-found" }
  | { kind: "admin-role-not-found" };
```

`replaceRolePermissions` 不需要 `last-platform-admin`：修改角色权限不改变 `user_roles`，而 `admin` 角色的权限集合本身已经由 service 挡住。`BootstrapAdminResult` 不变，系统入口跳过 actor 检查。

## 3. Transaction 内检查顺序

`replaceUserRoles` 的 transaction 内顺序：

```text
1. 读取目标 user            → user-not-found
2. 校验 roleKeys 有效性      → invalid-role-keys
3. actor 平台管理员检查      → actor-not-platform-admin   (actorType === 'system' 跳过)
4. 读取 before roleKeys（排序）
5. before === after ?       → 幂等返回 ok，不写库
6. 目标从有 admin 变无 admin ?
     统计活动平台管理员数量  → last-platform-admin
7. delete + insert
8. 返回 ok
```

顺序要点：

- 第 3 步在第 1、2 步之后，与现有 kind 判断风格一致：先回答"目标和输入是否合法"，再回答"你能不能做"。
- 第 5 步幂等短路在第 3 步之后，无权 actor 不能通过提交相同值绕过检查。
- 第 6 步只在实际会移除 admin 时才统计，避免每次替换都多一次 count。

`replaceRolePermissions` 顺序相同，去掉第 6 步。

`bootstrapAdminByEmail` 顺序：读取 user → 读取 admin 角色 → 读取 before → before 已是纯 `[admin]` 则幂等返回 → delete + insert。不加 actor 检查。

## 4. 平台管理员查询

actor 检查复用现有 `hasPermission` 里 admin 分支的查询形状，但要在 `tx` 上执行：

```ts
function isActivePlatformAdmin(tx: TxLike, userId: string): boolean {
  return Boolean(
    tx
      .select({ id: roles.id })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(roles.key, RoleKeys.ADMIN),
          isNull(roles.archivedAt),
        ),
      )
      .get(),
  );
}
```

数量统计用 `count()`，只在需要时调用：

```ts
function countActivePlatformAdmins(tx: TxLike): number {
  return (
    tx
      .select({ value: count() })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(user, eq(userRoles.userId, user.id))
      .where(and(eq(roles.key, RoleKeys.ADMIN), isNull(roles.archivedAt)))
      .get()?.value ?? 0
  );
}
```

`innerJoin(user)` 是必要的：`user_roles` 的 `userId` 有级联删除，但显式 join 保证统计的是现存 user 记录，符合 PRD R3 的定义。

`TxLike` 的类型取法：现有代码在 `db.transaction((tx) => ...)` 回调里直接用 `tx`，没有显式标注。实现时优先用 `Parameters<Parameters<AppDatabase['transaction']>[0]>[0]` 推导，避免手写 Drizzle 内部类型。如果推导过不了 `tsc`，把两个 helper 内联进各自 transaction，不引入 `any`。

## 5. 幂等比较

before 与 after 都规范化成排序后的 string 数组再比较：

```ts
function sameKeys(before: string[], after: string[]): boolean {
  return (
    before.length === after.length &&
    before.every((key, index) => key === after[index]);
  );
}
```

`replaceUserRoles` 的 after 是 `[...activeRoleKeys].sort()`，已经排序。before 需要新增一次查询，带 `orderBy(asc(roles.key))`。

`replaceRolePermissions` 同理，before 查 `role_permissions` 关联的 permission key，排序。

注意：`tsconfig` 启用了 `noUncheckedIndexedAccess`，`after[index]` 是 `string | undefined`。长度相等的前提下逻辑安全，但类型上要处理。用 `before.every((key, index) => key === after[index])` 即可，因为 `key` 是 `string`，与 `undefined` 比较返回 false，不会误判成相等。

## 6. Service 错误翻译

```ts
if (result.kind === "actor-not-platform-admin") {
  throw new AppError(
    ApiErrorCodes.AUTH_FORBIDDEN,
    "只有平台管理员可以修改授权关系",
    403,
  );
}
if (result.kind === "last-platform-admin") {
  throw new AppError(
    ApiErrorCodes.AUTH_LAST_PLATFORM_ADMIN,
    "至少需要保留一个平台管理员",
    409,
  );
}
```

现有的 self-mutation 403 message 是"不能修改自己的角色"，保持不变。两个 403 的 message 不同，满足 PRD R5。

## 7. Contracts 与 OpenAPI

`packages/contracts/src/index.ts` 的 `ApiErrorCodes` 按字母序插入：

```ts
AUTH_FORBIDDEN: 'AUTH.FORBIDDEN',
AUTH_LAST_PLATFORM_ADMIN: 'AUTH.LAST_PLATFORM_ADMIN',
AUTH_SESSION_INVALID: 'AUTH.SESSION_INVALID',
```

`apps/api/src/openapi/responses.ts` 当前没有 conflict response，需要新增：

```ts
export const conflictResponse = apiFailureResponse("状态冲突");
```

`replaceUserRolesRoute` 的 `responses` 增加 `409: conflictResponse`。`replaceRolePermissionsRoute` 不加 409。

`AppErrorStatus` 已包含 409，不需要修改 `app-error.ts`。

## 8. 测试策略

`apps/api/src/test/authorization.smoke.test.ts` 已有完整的 helper 和临时数据库注入。新增用例复用现有模式。

提权测试需要构造一个"持有 `authorization:manage` 但不是 admin"的用户：给 `operator` 角色临时加上 `authorization:manage`，再用 operator 用户发请求。这条路径当前 seed 不存在，必须在测试里显式构造，正好证明收紧生效。

幂等测试的断言方式：读取 `user_roles.assignedAt`，执行相同 roleKeys 的替换，再读一次，断言时间戳未变。这比断言"没有 delete 发生"更直接。

最后一个平台管理员测试直接调 repository，不走 HTTP。理由已写在 PRD Product Decision：HTTP 路径上不可达。测试要构造只有一个 admin 的库，用 `{ actorType: 'system', ... }` 绕过 actor 检查去撤销它。

## 9. 风险

- `count()` 的导入来自 `drizzle-orm`，当前 repository 只导入了 `and, asc, eq, inArray, isNull`。需要补导入。
- `TxLike` 类型推导可能过不了 `noUncheckedIndexedAccess` 之外的严格检查。design 第 4 节已给出内联降级方案。
- 幂等短路改变了现有行为：之前每次替换都会刷新 `assignedAt`，现在相同值不刷新。这是有意的，但如果有代码依赖 `assignedAt` 作为"最后一次操作时间"，语义会变。已确认当前 `assignedAt` 只在 presenter 中未被使用，DTO 不暴露它，所以无影响。
- 收紧后 `authorization:manage` 对普通角色只剩读的意义。本任务不改 Admin，所以 Admin 仍会给持有该权限的非 admin 用户显示编辑入口，点击后收到 403。这是已知的界面与后端不一致，记录在 implement.md 的已知缺口，不在本任务修。

## 10. 回滚

- 全部改动是代码级，无 migration，无数据变更。
- 回滚后旧代码继续工作：`assignedBy` 字段语义未变，没有新增列。
- `AUTH.LAST_PLATFORM_ADMIN` 回滚时从 contracts 移除即可，没有数据库记录引用它。
- 幂等短路回滚不影响数据一致性，只是恢复"每次替换刷新 `assignedAt`"的旧行为。
