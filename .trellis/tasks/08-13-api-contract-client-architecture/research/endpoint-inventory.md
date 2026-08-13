# 当前 API 接口盘点

## 结论

当前路由注册入口是 `apps/api/src/routes/index.ts`。自有业务路由共有 31 个：

- 普通 JSON：28 个，统一返回 `{ ok, data, meta }` 或 `{ ok, error, meta }`，都适合保留在 `AppType` 并作为 Hono RPC 路由。
- `multipart/form-data`：1 个，`POST /api/files`，保留专用上传客户端。
- 二进制内容：2 个，文件内容和公开头像，保留原始 `Response` 客户端。
- Better Auth：Hono 只注册 `GET|POST /api/auth/*` 通配入口，实际子路由由 Better Auth 1.6.16 管理，不进入自有 JSON envelope 或自有 OpenAPI。
- 文档：`GET /doc` 和 `GET /reference`，只在 `OPENAPI_ENABLED=true` 时注册。

当前 Web/Admin 都没有使用 `@starter/api/rpc` 或 `hono/client`。Web 有 2 个普通 JSON 请求函数，Admin 有 25 个；去重后共有 26 个已被前端调用的普通 JSON 端点需要迁移到 app 内 RPC adapter。`GET /` 和 `GET /api/me` 当前没有 Web/Admin 调用方，但仍属于普通 JSON RPC 类型的一部分。

## 记号

下表用以下缩写表示当前 schema 和 DTO 来源：

- `contracts`：`packages/contracts/src/index.ts`。
- `openapi`：`apps/api/src/openapi/responses.ts` 或对应模块的 `*.openapi.ts`。
- `route-local`：对应 `*.route.ts` 内声明的 Zod schema。
- `Better Auth`：Better Auth 服务端 endpoint 定义和 `createAuthClient` 推导的类型。
- 状态码列是路由 OpenAPI 明确声明的状态码，不包含全局错误边界可能返回的 `500`、超时可能返回的 `504`，也不表示声明与运行时已经完全一致。

## 普通 JSON 接口

### System 与 Auth

| Method | Path | 调用方 | 输入 schema | 成功响应数据 schema / DTO | OpenAPI 状态码 | 当前测试 |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/` | 无 | 无 | `serviceInfoSchema`，仅 `openapi` | 200 | `/doc` 会生成该路由，但没有直接业务 smoke 断言 |
| GET | `/health` | Admin `system/health.api.ts` | 无 | `healthSchema`；Admin 另写 `HealthResponse` | 200 | `auth.smoke.test.ts`；`openapi.smoke.test.ts` 在关闭文档后验证接口仍可用 |
| GET | `/api/system/logs` | Admin `system/logs.api.ts` | `systemLogsQuerySchema` 在 `system.openapi.ts`；`contracts` 只有平行 `SystemLogsQuery` type | `systemLogsResponseSchema`；`contracts` 有平行 DTO | 200/400/401/403 | `system-logs.smoke.test.ts` 覆盖权限、过滤、分页、requestId 和未配置目录 |
| GET | `/api/config/auth` | Web、Admin 各自的 `auth-config.api.ts` | 无 | `authConfigSchema`；`contracts.AuthConfig` 平行定义 | 200 | `auth.smoke.test.ts`；两端没有 contract test |
| GET | `/api/me` | 无；Admin/Web 会话读取实际走 Better Auth `/get-session` | 无 | `currentSessionSchema`，仅 `openapi` | 200/401 | `auth.smoke.test.ts` 覆盖 200；未登录由 auth guard 的通用测试间接覆盖 |

### Profile

| Method | Path | 调用方 | 输入 schema | 成功响应数据 schema / DTO | OpenAPI 状态码 | 当前测试 |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/profile` | Admin `profile/profile.api.ts` | 无 | `accountProfileSchema`；`contracts.AccountProfile` 平行定义 | 200/401 | `profile.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| PATCH | `/api/profile` | Admin `profile/profile.api.ts` | `contracts.updateProfileSchema` | `accountProfileSchema`；`contracts.AccountProfile` 平行定义 | 200/400/401 | `profile.smoke.test.ts` |
| PUT | `/api/profile/avatar` | Admin `profile/profile.api.ts` | `contracts.setAvatarSchema`，JSON `{ fileId }` | `fileIdSchema` 在 `profile.openapi.ts`；客户端手写 `{ fileId: string }` | 200/400/401/404 | `profile.smoke.test.ts`；`files.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| DELETE | `/api/profile/avatar` | Admin `profile/profile.api.ts` | 无 | `openapi.okSchema`；客户端手写 `{ ok: boolean }` | 200/401 | `profile.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| GET | `/api/profiles/{userId}` | Web `profile.api.ts` | `userParamsSchema` 组合 `contracts.uuidSchema` | `publicProfileSchema`；`contracts.PublicProfile` 平行定义 | 200/400/404 | `profile.smoke.test.ts`；`auth.smoke.test.ts` 覆盖非法 UUID；Web 只用手写 guard 校验 |

`PUT /api/profile/avatar` 只是把已上传文件设为头像，输入是 JSON，应进入普通 RPC。它不是文件上传例外。

### Files

| Method | Path | 调用方 | 输入 schema | 成功响应数据 schema / DTO | OpenAPI 状态码 | 当前测试 |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/files` | Admin `files/files.api.ts` | 无 | `fileListSchema`；`contracts.FileItem[]` 平行定义 | 200/401/403 | `files.smoke.test.ts`；`permission-matrix.smoke.test.ts`；`authorization.smoke.test.ts` |
| PATCH | `/api/files/{fileId}` | Admin `files/files.api.ts` | param 为 `route-local fileParamsSchema` + `contracts.uuidSchema`；body 为 `contracts.renameFileSchema` | `fileItemSchema`；`contracts.FileItem` 平行定义 | 200/400/401/403/404 | `files.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| DELETE | `/api/files/{fileId}` | Admin `files/files.api.ts` | param 为 `route-local fileParamsSchema` + `contracts.uuidSchema` | `openapi.okSchema`；客户端手写 `{ ok: boolean }` | 200/401/403/404 | `files.smoke.test.ts`；`permission-matrix.smoke.test.ts` |

`POST /api/files` 和 `GET /api/files/{fileId}/content` 不在此表，分别属于 multipart 和二进制例外。

### Users

| Method | Path | 调用方 | 输入 schema | 成功响应数据 schema / DTO | OpenAPI 状态码 | 当前测试 |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/users` | Admin `users/users.api.ts` | `users.openapi.ts` 重写了 `contracts.userManagementQuerySchema` | `userManagementUserPageSchema`；`contracts.UserManagementUserPage` 平行定义 | 200/400/401/403 | `users.smoke.test.ts` 覆盖权限、分页、搜索、筛选、排序和敏感字段排除 |
| GET | `/api/users/{userId}` | Admin `users/users.api.ts` | `userIdParamsSchema` 在 `users.openapi.ts` | `userManagementUserDetailSchema`；`contracts.UserManagementUserDetail` 平行定义 | 200/401/403/404 | `users.smoke.test.ts` 覆盖详情、缺失资料和 404 |
| PATCH | `/api/users/{userId}/status` | Admin `users/users.api.ts` | param 为 `userIdParamsSchema`；body 直接复用 `contracts.updateUserStatusSchema` | `updateUserStatusResponseSchema`；客户端手写 `{ id, status }` | 200/400/401/403/404 | `user-status.smoke.test.ts` 覆盖 200/400/401/403/404、会话失效和审计 |

### Authorization

| Method | Path | 调用方 | 输入 schema | 成功响应数据 schema / DTO | OpenAPI 状态码 | 当前测试 |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/me/permissions` | Admin `authorization.api.ts` | 无 | `currentPermissionsSchema`；`contracts.CurrentPermissions` 平行定义 | 200/401 | `authorization.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| GET | `/api/authorization/users` | Admin `authorization.api.ts` | 无 | `authorizationUsersSchema`；`contracts.AuthorizationUser[]` 平行定义 | 200/401/403 | `authorization.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| PUT | `/api/authorization/users/{userId}/roles` | Admin `authorization.api.ts` | param 在 `authorization.openapi.ts`；body 复用 `contracts.replaceUserRolesSchema` | `authorizationUserSchema`；`contracts.AuthorizationUser` 平行定义 | 200/400/401/403/404/409 | `authorization.smoke.test.ts`、`authorization-audit.smoke.test.ts`、`role-lifecycle.smoke.test.ts`、`permission-matrix.smoke.test.ts` |
| GET | `/api/authorization/roles` | Admin `authorization.api.ts` | query 由 `authorizationRoleCatalogQuerySchema` 包装 `contracts.roleCatalogStatusSchema` | `authorizationRoleCatalogSchema`；`contracts.AuthorizationRoleCatalog` 平行定义 | 200/400/401/403/500 | `authorization.smoke.test.ts`、`role-lifecycle.smoke.test.ts`、`permission-matrix.smoke.test.ts` |
| POST | `/api/authorization/roles` | Admin `authorization.api.ts` | `contracts.createRoleSchema` | `authorizationRoleSchema`；`contracts.AuthorizationRole` 平行定义 | 200/400/401/403/409/500 | `role-lifecycle.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| PATCH | `/api/authorization/roles/{roleKey}` | Admin `authorization.api.ts` | param 使用 `contracts.roleKeySchema`；body 为 `contracts.updateRoleSchema` | `authorizationRoleSchema`；`contracts.AuthorizationRole` 平行定义 | 200/400/401/403/404/500 | `role-lifecycle.smoke.test.ts` |
| POST | `/api/authorization/roles/{roleKey}/archive` | Admin `authorization.api.ts` | param 使用 `contracts.roleKeySchema` | `authorizationRoleSchema`；`contracts.AuthorizationRole` 平行定义 | 200/400/401/403/404/409/500 | `role-lifecycle.smoke.test.ts` |
| POST | `/api/authorization/roles/{roleKey}/restore` | Admin `authorization.api.ts` | param 使用 `contracts.roleKeySchema` | `authorizationRoleSchema`；`contracts.AuthorizationRole` 平行定义 | 200/400/401/403/404/500 | `role-lifecycle.smoke.test.ts` |
| GET | `/api/authorization/roles/{roleKey}/impact` | Admin `authorization.api.ts` | param 使用 `contracts.roleKeySchema` | `authorizationRoleImpactSchema`；`contracts.AuthorizationRoleImpact` 平行定义 | 200/400/401/403/404/500 | `role-lifecycle.smoke.test.ts`；`permission-matrix.smoke.test.ts` |
| GET | `/api/authorization/permissions/{permissionKey}/impact` | Admin `authorization.api.ts` | param 使用 `contracts.permissionSchema` | `authorizationPermissionImpactSchema`；`contracts.AuthorizationPermissionImpact` 平行定义 | 200/400/401/403/404/500 | `role-lifecycle.smoke.test.ts` |
| PUT | `/api/authorization/roles/{roleKey}/permissions` | Admin `authorization.api.ts` | param 使用 `contracts.roleKeySchema`；body 为 `contracts.replaceRolePermissionsSchema` | `authorizationRoleSchema`；`contracts.AuthorizationRole` 平行定义 | 200/400/401/403/404 | `authorization.smoke.test.ts`、`authorization-audit.smoke.test.ts`、`role-lifecycle.smoke.test.ts`、`permission-matrix.smoke.test.ts` |
| GET | `/api/authorization/audit-events` | Admin `authorization.api.ts` | 直接重导 `contracts.authorizationAuditQuerySchema` | `authorizationAuditEventPageSchema`；`contracts.AuthorizationAuditEventPage` 平行定义 | 200/400/401/403/500 | `authorization-audit.smoke.test.ts`、`role-lifecycle.smoke.test.ts`、`permission-matrix.smoke.test.ts` |

## Better Auth 接口

API 在 `auth.route.ts` 中注册 `app.on(["GET", "POST"], "/api/auth/*", runtime.auth.handler)`。输入校验、响应类型、Cookie、重定向和状态码由 Better Auth 管理，响应不使用自有 envelope，也不进入 `/doc`。以下只列当前应用或测试实际依赖的子路由，不枚举 Better Auth 其余内置端点。

| Method | Path | 当前调用方 | 类型和运行时校验来源 | 测试覆盖 |
| --- | --- | --- | --- | --- |
| GET | `/api/auth/get-session` | Web `useSession/getSession`；Admin `session.api.ts` | Better Auth client/server | `auth.smoke.test.ts`、`auth-flow.smoke.test.ts` |
| POST | `/api/auth/sign-out` | Web、Admin | Better Auth client/server | `auth.smoke.test.ts` |
| POST | `/api/auth/sign-up/email` | Admin；API 测试 helper | Better Auth client/server；项目配置密码最少 8 位 | `auth.smoke.test.ts` 经 helper；大量 smoke 测试用 helper 注册 |
| POST | `/api/auth/sign-in/email` | Admin；API 测试 helper | Better Auth client/server；项目 database hook 拒绝 suspended 用户创建 session | `auth-flow.smoke.test.ts`、`user-status.smoke.test.ts`，并被测试 helper 广泛使用 |
| POST | `/api/auth/sign-in/social` | Web、Admin | Better Auth client/server；provider 由 GitHub/Google 配置决定 | 没有真实 OAuth API smoke test |
| GET | `/api/auth/callback/{id}` | OAuth provider 回调浏览器 | Better Auth client/server | 没有真实 OAuth API smoke test |
| POST | `/api/auth/link-social` | Admin `link-social.api.ts` | Better Auth client/server | 只有 `apps/admin/src/test/link-social.test.ts` mock 客户端单测，没有 API smoke test |
| POST | `/api/auth/request-password-reset` | Admin | Better Auth client/server；项目回调发送邮件 | `auth-flow.smoke.test.ts` |
| POST | `/api/auth/reset-password` | Admin | Better Auth client/server | `auth-flow.smoke.test.ts` |
| GET | `/api/auth/verify-email` | Admin | Better Auth client/server | `auth-flow.smoke.test.ts` |
| POST | `/api/auth/send-verification-email` | Admin | Better Auth client/server；项目回调发送邮件 | 注册自动发信有测试；显式重发端点没有 API smoke test |
| POST | `/api/auth/change-password` | Admin | Better Auth client/server | `auth-flow.smoke.test.ts` |

Better Auth 的保留边界是整个 `/api/auth/*`，不是只保留上表中的路径。实现阶段不能用 Hono RPC 重写这些调用，也不能把它们包装进自有 envelope。

## Multipart 上传

| Method | Path | 调用方 | 输入校验 | 响应 | 状态码与测试 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/files` | Admin `files/files.api.ts` | OpenAPI `uploadFileSchema` 只声明 `file: z.any()`；路由再检查 `file instanceof File`；service 检查 10 MiB 上限；全局 body limit 也可能先拒绝 | 成功仍是 `ApiSuccess<FileItem>` JSON，`fileItemSchema` 与 `contracts.FileItem` 平行定义 | OpenAPI 声明 201/401/403/413；运行时还会对缺少文件返回 400。`files.smoke.test.ts`、`profile.smoke.test.ts`、`authorization.smoke.test.ts`、`permission-matrix.smoke.test.ts` 覆盖成功、权限和所有权流程，未发现 413 的直接 smoke 断言 |

该端点继续使用 `FormData` 和专用上传函数。Admin adapter 不应设置 `Content-Type`，由浏览器生成 multipart boundary。路径、Cookie、错误转换仍可复用 app 内基础 HTTP 能力，但不通过普通 JSON RPC adapter 强制发送 JSON。

## 文件与头像二进制

| Method | Path | 调用方 | 运行时校验 | 成功响应 | 错误与测试 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/files/{fileId}/content` | Admin `downloadFileBlob`，路径来自 `FileItem.contentUrl` | auth + `file:read` permission + `uuidSchema` path + 文件所有权 | 原始 `Response`；文件 MIME、`Content-Length`、inline `Content-Disposition` | 400/401/403/404 走自有 JSON failure；成功 200。`files.smoke.test.ts`、`authorization.smoke.test.ts`、`permission-matrix.smoke.test.ts` |
| GET | `/api/profiles/{userId}/avatar` | Web 公开资料头像；Admin 当前用户和用户管理头像，URL 来自 profile DTO | `uuidSchema` path；公开访问 | 原始 `Response`；图片 MIME、`Content-Length`、`Cache-Control: public, max-age=300` | 400/404 走自有 JSON failure；成功 200。`profile.smoke.test.ts`、`files.smoke.test.ts` |

这两个路由使用普通 `app.get`，没有 `createRoute`，因此不在 `/doc` 中，也不会提供可用的普通 JSON RPC 响应类型。客户端必须保留原始 `Response`、`blob()` 或直接图片 URL 的处理方式。

## OpenAPI 与 Scalar

| Method | Path | 条件 | 响应 | 测试 |
| --- | --- | --- | --- | --- |
| GET | `/doc` | `OPENAPI_ENABLED=true` | OpenAPI 3.0 JSON，由 `OpenAPIHono` 已注册的 `createRoute` 路由生成 | `openapi.smoke.test.ts` 检查文档版本、部分路径、部分错误状态和 cookie security scheme |
| GET | `/reference` | `OPENAPI_ENABLED=true` | Scalar HTML，加载 `/doc`，前端资源固定为 `@scalar/api-reference@1.64.1` CDN | `openapi.smoke.test.ts` 检查 HTML、`/doc` 和 CDN URL |

`openapi.smoke.test.ts` 还验证关闭开关后两个路径返回 404，`/health` 不受影响。当前测试只检查部分路径或响应状态是否出现在文档中，不会拿共享响应 schema 解析真实响应，因此不能发现数据字段漂移。

## 当前请求和响应边界

### API 运行时校验

- `OpenAPIHono` 的 `defaultHook` 把 `createRoute` 的 path、query 和 JSON/form 校验错误转成 `COMMON.INVALID_REQUEST`。
- 两个二进制路由用 `zValidator` 校验 path。
- auth guard 校验 Cookie 对应 session；authorization guard 校验 permission。
- multipart 上传除 Zod form 声明外，还有 `File` 实例和文件大小检查。
- 普通 JSON 响应没有在生产发送前执行 Zod parse。service/presenter 主要靠 TypeScript 返回类型或 `satisfies`，OpenAPI response schema 只用于文档和类型推导。

### Web

- `apps/web/lib/http.ts` 校验 envelope 和 `meta` 的基本形状，返回 `unknown`。
- `getAuthConfig` 和 `getPublicProfile` 再用手写 type guard 检查数据。
- Better Auth 使用 `apps/web/lib/auth-client.ts`。
- 头像直接使用 API URL，不读取 JSON。

### Admin

- `apps/admin/src/api/http.ts` 的 `apiRequest<TData>` 依赖调用方手写泛型断言，不做 Zod 解析。
- 为兼容旧响应，它既接受 envelope，也接受裸 JSON。
- `fetchApi` 保留原始 `Response`，并负责 `credentials: include`、FormData header 例外和 401/403 通知。
- Better Auth 使用 `apps/admin/src/api/client.ts` 中的 `createAuthClient`。

## 已确认的 schema 和文档漂移

1. `PATCH /api/users/{userId}/status` 实际成功数据是 `{ from, id, status }`，`users.openapi.ts` 只声明 `{ id, status }`，Admin 也只写了 `{ id, status }` 泛型。`user-status.smoke.test.ts` 明确断言实际存在 `from`。
2. `contracts.AuthorizationAuditEvent` 包含 `user.status_changed` 分支，`authorization.openapi.ts` 的 `authorizationAuditEventSchema` union 没有该分支。状态变更事件可以由接口写入并由审计接口返回，因此 `/doc` 少了一种真实响应。
3. `profile.openapi.ts` 把 `PublicProfile.avatarUrl` 声明为绝对 URL，presenter 实际返回 `/api/profiles/{userId}/avatar` 相对路径。`users.openapi.ts` 对用户详情里的 `profile.avatarUrl` 也声明绝对 URL，service 同样返回相对路径。当前 smoke tests 用 TypeScript cast 读取响应，没有执行这些 schema，所以未发现冲突。
4. 通用 envelope 在两处平行定义：`contracts` 是 TypeScript interface，`apps/api/src/openapi/responses.ts` 是 Zod schema。OpenAPI 的 `apiErrorSchema.code` 允许任意 string，`contracts.ApiErrorCode` 只允许已登记错误码。
5. `systemLogsQuerySchema` 和 `userManagementQuerySchema` 在 API OpenAPI 文件中重写；`contracts` 分别只有平行 type 或另一份 Zod schema。默认值和约束以后可能分别变化。
6. `AuthConfig`、Profile、Files、Users、Authorization 的多数响应同时存在 contracts DTO 和模块 OpenAPI Zod schema。测试 helper 的 `readSuccess<T>` 只是类型断言，不做运行时解析。
7. `PUT /api/profile/avatar` 运行时可因非图片文件返回 422，但 OpenAPI 没有声明 422。`POST /api/files` 缺少文件时实际返回 400，但 OpenAPI 只列 201/401/403/413。
8. 多个带 UUID path 的路由依靠运行时 schema 返回 400，但 OpenAPI 没有统一列出 400，例如 `GET /api/users/{userId}` 和 `DELETE /api/files/{fileId}`。
9. OpenAPI tags 只在文档元信息中登记 System/Auth/Profile/Files；实际路由还使用 Users 和 Authorization tag，文档仍能生成 operation，但 tags 元信息不完整。

这些问题应在迁移 RPC 客户端之前用共享 Zod schema处理。否则 `AppType` 可以改善 path、method 和请求参数类型，却仍会把错误或不完整的响应 schema 推给 Web/Admin。

## 普通 JSON RPC 迁移清单

### Web app 内 adapter

- `GET /api/config/auth`
- `GET /api/profiles/{userId}`

保留领域函数 `getAuthConfig`、`getPublicProfile`；函数内部改用 Web RPC adapter。Web Better Auth 和头像 URL 不迁移到普通 RPC。

### Admin app 内 adapter

- `GET /health`
- `GET /api/system/logs`
- `GET /api/config/auth`
- `GET|PATCH /api/profile`
- `PUT|DELETE /api/profile/avatar`
- `GET /api/files`
- `PATCH|DELETE /api/files/{fileId}`
- `GET /api/users`
- `GET /api/users/{userId}`
- `PATCH /api/users/{userId}/status`
- `GET /api/me/permissions`
- `GET /api/authorization/users`
- `PUT /api/authorization/users/{userId}/roles`
- `GET|POST /api/authorization/roles`
- `PATCH /api/authorization/roles/{roleKey}`
- `POST /api/authorization/roles/{roleKey}/archive`
- `POST /api/authorization/roles/{roleKey}/restore`
- `GET /api/authorization/roles/{roleKey}/impact`
- `GET /api/authorization/permissions/{permissionKey}/impact`
- `PUT /api/authorization/roles/{roleKey}/permissions`
- `GET /api/authorization/audit-events`

这里按 HTTP operation 计 25 个端点。领域请求函数和 React Query 层继续保留；页面、组件不直接创建 `hc` client。

### 没有当前调用方但继续进入 AppType

- `GET /`
- `GET /api/me`

不需要为它们新增页面调用函数，只需要保证路由类型和共享响应 schema正确。

### 明确不迁移到普通 JSON RPC

- 整个 `/api/auth/*`：Better Auth 专用 client。
- `POST /api/files`：FormData 上传函数。
- `GET /api/files/{fileId}/content`：原始 `Response` / Blob 下载。
- `GET /api/profiles/{userId}/avatar`：公开二进制图片 URL。
- `GET /doc`、`GET /reference`：文档和 Scalar 页面。

## 测试缺口

- 没有任何测试用共享成功/失败响应 schema 解析代表性真实响应。
- 没有测试比较 `/doc` response schema 与同一路由真实响应。
- Web 两个普通 JSON 领域函数没有针对共享 schema 或 RPC 类型的测试。
- Admin API 函数使用手写泛型，没有路径、method、参数和响应类型的编译期 contract test。
- Better Auth 的 social sign-in、OAuth callback、link-social 和显式 send-verification-email 没有 API 集成 smoke test；link-social 只有 Admin mock 单测。
- multipart 缺少超限 413 和缺少文件 400 的直接 smoke 断言。
- 公开头像没有直接验证 `Content-Type`、`Content-Length` 和 cache header；文件下载测试验证字节，但未完整验证响应 header。
- `GET /` 没有直接 smoke test。

## 参考文件

- 路由总入口：`apps/api/src/routes/index.ts`
- RPC 类型导出：`apps/api/src/rpc.ts`
- 模块路由与 OpenAPI：`apps/api/src/modules/*/*.route.ts`、`apps/api/src/modules/*/*.openapi.ts`
- envelope schema：`apps/api/src/openapi/responses.ts`
- contracts：`packages/contracts/src/index.ts`
- Web HTTP 边界：`apps/web/lib/http.ts`、`apps/web/lib/auth-client.ts`、`apps/web/lib/api/`
- Admin HTTP 边界：`apps/admin/src/api/http.ts`、`apps/admin/src/api/client.ts`、`apps/admin/src/api/*/`
- API smoke tests：`apps/api/src/test/*.smoke.test.ts`
