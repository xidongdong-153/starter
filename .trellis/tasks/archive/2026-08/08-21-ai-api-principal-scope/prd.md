# 建立 AI Principal 与资源 Scope

## Goal

建立 AI API 统一身份和资源范围模型，让 Better Auth 用户和产品应用凭据都能进入同一套 service 授权边界。首版应用凭据固定绑定一个 `tenantId + projectId`，API 不信任请求体覆盖范围。

## Dependencies

- 前置：`08-21-ai-api-contract-surface`。
- 后置：`08-21-ai-api-runtime-resource-scope`、Web 接入。

## Requirements

### PrincipalContext

定义 API 内部类型：

```ts
interface PrincipalContext {
  kind: 'starter_user' | 'product_app'
  principalId: string
  tenantId: string
  projectId: string
  externalUserId: string | null
  appId: string | null
}
```

- `starter_user`：由 Better Auth session 适配，兼容当前 Starter scope。
- `product_app`：由应用凭据适配，`tenantId/projectId` 从凭据记录派生，`externalUserId` 从请求体读取。
- `externalUserId` 是产品自己的用户标识，不能当作 Starter `user.id` 外键。
- `principalId` 是当前认证主体 ID；产品应用请求不能伪造最终用户的 principal 身份。

### ResourceScope

```ts
interface ResourceScope {
  tenantId: string
  projectId: string
  subjectType: string | null
  subjectId: string | null
}
```

- 所有运行资源读写必须带 scope。
- 首版凭据只允许一个固定 tenant/project；该 scope 由凭据记录提供。
- `subjectType/subjectId` 只做稳定业务引用，不读取产品数据库。
- scope 不从裸 URL、sessionId 或请求体 tenant/project 推导。

### Application Credential

Admin 控制面提供创建、轮换、撤销应用凭据：

- secret 只在创建/轮换响应中返回一次。
- 数据库只保存不可逆 hash、可识别前缀、`appId`、tenant/project scope、状态、创建/更新时间和最后使用时间。
- 不把完整 secret 写入日志、审计 before/after、响应 DTO、数据库或错误信息。
- 认证比较使用固定时间比较或成熟密码 hash 方案，不能明文比较数据库值。
- 撤销立即阻止新请求；已运行 Run 的处理规则必须明确为继续到终态或主动取消，不得静默改变历史。
- 首版不支持一个凭据跨 tenant/project、不支持浏览器持有应用凭据、不支持任意用户 impersonation。
- 首版不新增 tenant/project 表、租户 CRUD、成员管理或项目归档接口。
- `tenantId/projectId` 是 Admin 创建应用凭据时填写的不可变外部命名空间；凭据记录本身是该 app scope 的权威来源。
- 创建后不能通过 rotate 修改 tenant/project；需要变更 scope 时撤销旧凭据并创建新凭据。
- API 只校验 ID 格式、长度和凭据 scope 一致性，不负责判断外部产品是否真实存在该 tenant/project。

### Better Auth 适配

- 保留 `createRequireAuth` 作为 Starter 控制面和兼容运行面的入口。
- 新增 Principal adapter，不让 service 继续把 `currentUserId` 作为唯一身份参数。
- 兼容期可以把当前 Starter 安装映射为固定 tenant/project，但映射必须集中在 adapter/config，不散落在 repository。
- Admin 控制面仍按 Starter `ai:config:read`、`ai:config:manage`、`ai:usage:read` 校验。
- 产品应用凭据权限不能直接复用 Starter role permission；至少区分 app scope 校验与 Admin 管理权限。

## Out of Scope

- 不实现 OAuth/OIDC、API Key 对外开放平台、一个 app 多 scope 授权、组织成员管理或 FGA。
- 不删除 Better Auth，不迁移现有 user 表。
- 不在本任务改 Session/Run 表归属查询；由下一个 runtime resource scope 子任务执行。

## Acceptance Criteria

- [ ] Better Auth 和 product app 都能解析为统一 PrincipalContext。
- [ ] product app 的 tenant/project 只能来自凭据，篡改请求体 scope 会被拒绝。
- [ ] 应用凭据 secret 只出现一次，数据库、日志、审计和 DTO 不出现完整 secret。
- [ ] create/rotate/revoke 有状态、权限、幂等和审计测试。
- [ ] 撤销后的新请求失败，旧 Run 行为有明确测试或文档。
- [ ] service 层不再新增直接依赖 `currentUserId` 的公共运行接口。
- [ ] 现有 Better Auth/Admin 测试保持通过。

## Evidence

- `apps/api/src/modules/auth/auth.config.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/middleware/`
- `apps/api/src/modules/authorization/`
- `apps/api/src/infra/db/schema/`
- `apps/api/src/shared/id.ts`
- `apps/api/src/infra/ai/ai-credential-store.ts`
- `.trellis/spec/api/backend/authentication-guidelines.md`
- `.trellis/spec/api/backend/authorization-guidelines.md`
