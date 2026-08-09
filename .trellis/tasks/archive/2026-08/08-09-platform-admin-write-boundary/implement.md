# 执行计划

## 顺序

### 1. Contracts 与 OpenAPI 响应

- [x] `packages/contracts/src/index.ts` 的 `ApiErrorCodes` 按字母序插入 `AUTH_LAST_PLATFORM_ADMIN: 'AUTH.LAST_PLATFORM_ADMIN'`。
- [x] `apps/api/src/openapi/responses.ts` 增加 `conflictResponse`。
- [x] `authorization.route.ts` 的 `replaceUserRolesRoute` 增加 `409: conflictResponse`，导入 `conflictResponse`。

检查点：`pnpm check-types` 通过。`app-error.ts` 的 `AppErrorStatus` 已含 409，不需要改。

### 2. 写入上下文与 repository 改造

- [x] 在 `authorization.repository.ts` 定义并导出 `AuthorizationWriteContext`。
- [x] 扩展 `ReplaceUserRolesResult` 加 `actor-not-platform-admin` 和 `last-platform-admin`。
- [x] 扩展 `ReplaceRolePermissionsResult` 加 `actor-not-platform-admin`。
- [x] 补 `count` 到 `drizzle-orm` 的导入。
- [x] 实现 `isActivePlatformAdmin` 和 `countActivePlatformAdmins`，按 design 第 4 节。先试 `Parameters<...>` 推导 `TxLike`；推导失败就内联进各自 transaction，不用 `any`。
- [x] 实现 `sameKeys`，注意 `noUncheckedIndexedAccess` 下 `after[index]` 是 `string | undefined`。
- [x] `replaceUserRoles` 按 design 第 3 节的八步顺序改造，`assignedBy` 按 `actorType` 取 `actorId` 或 `null`。
- [x] `replaceRolePermissions` 同上，去掉平台管理员数量统计。
- [x] `bootstrapAdminByEmail` 加 before 读取和幂等短路，不加 actor 检查。

检查点：三个写函数都在 transaction 内完成 actor 检查、before 读取和写入。幂等短路在 actor 检查之后。

### 3. Service 错误翻译

- [x] `replaceUserRoles` 处理两个新 kind，翻译为 403 和 409，message 按 design 第 6 节。
- [x] `replaceRolePermissions` 处理 `actor-not-platform-admin`。
- [x] 保留现有 self-mutation 403 和 admin 角色权限只读 403，message 不变。
- [x] service 签名接收并透传写入上下文。

检查点：两个 403 的 message 不同，可区分原因。

### 4. 调用点

- [x] `authorization.route.ts` 两个写路由传 `{ actorType: 'user', actorId: c.var.currentUserId, requestId: c.var.requestId }`。
- [x] `apps/api/src/scripts/bootstrap-admin.ts` 传 `{ actorType: 'system', actorId: 'auth:bootstrap-admin', requestId: null }`。
- [x] 确认 `auth.config.ts` 的 user create hook 未被本任务改动。

检查点：`pnpm check-types` 通过，没有遗漏的调用点。

### 5. 测试

在 `apps/api/src/test/authorization.smoke.test.ts` 增加：

- [x] 给 `operator` 临时加 `authorization:manage`，用 operator 用户替换他人角色 → 403，关系不变。
- [x] 同一 operator 用户替换角色权限 → 403，关系不变。
- [x] admin 用户执行两个写操作 → 200。
- [x] 提交与当前相同的 roleKeys → 200 且 `assignedAt` 未变。
- [x] 提交与当前相同的 permissionKeys → 200 且 `assignedAt` 未变。
- [x] repository 级：只有一个 admin 的库，用 system 上下文撤销它 → `last-platform-admin`，关系不变。
- [x] `bootstrapAdminByEmail` 对已是纯 admin 的用户重复执行 → 不重写 `assignedAt`。
- [x] 确认现有 self-mutation 403 和 admin 权限只读 403 用例仍通过。

检查点：提权测试确实构造了非 admin 且持有 `authorization:manage` 的用户，不是靠 mock。

### 6. Spec 更新

- [x] `.trellis/spec/api/backend/authorization-guidelines.md` 补写平台管理员写入边界、`AUTH.LAST_PLATFORM_ADMIN` 409 和幂等语义。
- [x] 说明 `authorization:manage` 不是可委派权限。

### 7. 质量门禁

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

- [x] 六项全过。
- [x] `git diff --stat apps/admin` 为空。
- [x] 确认没有新增 migration 文件。

## 已知缺口

- Admin 仍会给持有 `authorization:manage` 的非 admin 用户显示编辑入口，点击收到 403。界面与后端不一致，本任务范围内不修。
- 最后一个平台管理员保护在当前 HTTP 路径上不可达，只有 repository 级测试。等账号停用功能出现后才有 HTTP 触发路径。
- `replaceUserRoles` 的 `removesAdmin` 判断读的是未过滤归档的 `beforeRoleKeys`。如果 `admin` 角色行本身被归档，`countActivePlatformAdmins` 会返回 0，system 上下文的替换会拿到 `last-platform-admin`。当前不可达：没有归档角色的接口，且 spec 8.3 规定系统角色不能归档。留作记录，不改。
- check 阶段补齐的项：repository 注释错字（撚 -> 撤）、角色权限 403 缺少「关系不变」断言、`replaceUserRolesRoute` 的 409 声明没有测试覆盖、implement.md 步骤 6 的 spec 更新未做。四项都已修。

## 回滚点

- 步骤 2 如果 `TxLike` 类型推导失败，按 design 第 4 节内联 helper，不引入 `any`，不改 Drizzle 版本。
- 步骤 2 如果幂等短路导致现有测试失败，先确认失败原因是测试断言了"每次刷新 `assignedAt`"这一旧行为还是真实回归。前者更新测试，后者回到设计。
- 全部改动无 migration，回滚只需还原代码。

## 验证命令

```bash
pnpm --filter @starter/api test
pnpm check-types
pnpm lint
pnpm format:check
pnpm build
pnpm --filter @starter/api db:check
```
