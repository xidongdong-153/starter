# API 认证规范

## 场景：GitHub/Google OAuth 与账号关联

### 1. 范围与触发条件

- 适用范围：`apps/api/src/modules/auth/auth.config.ts` 中的 Better Auth 配置。
- 触发条件：启用 GitHub/Google OAuth 登录、同邮箱自动关联，或 Admin 调用 `linkSocial` 绑定第三方账号。
- 目标：允许已验证的 provider 账号登录或绑定现有用户，不转移已经属于其他用户的 provider 账号。

### 2. 签名

```ts
createAuth(db: AppDatabase, env: AppEnv, logger: AppLogger): AppAuth
```

Better Auth 客户端使用以下标准动作：

```ts
authClient.signIn.social({ provider, callbackURL })
authClient.linkSocial({ provider, callbackURL, errorCallbackURL })
```

### 3. 契约

- 环境变量：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。每个 provider 的 ID 和 secret 必须同时存在才启用。
- API 配置：`/api/config/auth` 返回 `{ providers: { email: true, github: boolean, google: boolean } }`。
- 账号关联配置必须保持：

```ts
account: {
  accountLinking: {
    enabled: true,
    requireLocalEmailVerified: false,
  },
}
```

- `allowDifferentEmails` 不设为 `true`。显式绑定时 OAuth 邮箱必须与当前账号邮箱一致。
- 不设置 `trustedProviders`。GitHub/Google 必须返回 `emailVerified`，不能只根据 provider 名称跳过验证。
- OAuth secret 只存在 API 环境变量中，不进入 Web 或 Admin bundle。

### 4. 校验与错误矩阵

| 条件 | 结果 |
| --- | --- |
| provider ID 和 secret 未同时配置 | `/api/config/auth` 返回对应 provider 为 `false`，客户端隐藏按钮 |
| provider 返回已验证邮箱，且没有对应账号 | 创建用户和 account，触发现有 profile、默认角色初始化 |
| provider account 已存在 | 登录已关联的用户 |
| provider 已验证邮箱匹配现有用户 | 自动关联到现有用户，不创建重复用户 |
| provider 邮箱未验证或缺失 | Better Auth 拒绝关联或创建，客户端显示 OAuth 失败 |
| 显式绑定时邮箱与当前账号不一致 | 回调返回 `email_doesn't_match` 或同类错误，不写入 account |
| provider account 已属于其他用户 | 回调返回 `account_already_linked_to_different_user`，不转移 account |
| OAuth callback 失败 | 使用 `errorCallbackURL` 返回前端，并由前端按错误 code 显示文案 |

`requireLocalEmailVerified: false` 只兼容本项目当前不发送邮箱验证邮件的实现，不得同时关闭 provider 邮箱验证或允许不同邮箱关联。

### 5. 正确、基础和错误案例

- 正确：已登录邮箱账号在 Admin 个人资料页绑定同邮箱且已验证的 GitHub 账号。
- 基础：未配置 GitHub client ID/secret，Web 和 Admin 不显示 GitHub 按钮。
- 错误：收到 provider 回调后直接按邮箱字符串创建新用户，跳过 Better Auth 的账号关联检查。

### 6. 必需测试

- API smoke test 断言未配置 provider 时 `/api/config/auth` 返回 `github: false`、`google: false`，且 `email: true` 保持兼容。
- 现有 auth smoke test 继续断言注册用户的 `credential` provider、session 和默认初始化流程。
- 现有 profile smoke test 继续断言 `AccountProfile.providers` 能返回账号关联列表。
- 有真实 OAuth 凭据时，手工验证首次注册、同邮箱自动关联、provider 已被其他用户占用和 Admin 绑定回跳。
- Admin UI 检查绑定按钮的配置状态、已绑定状态、pending 状态和 callback 错误提示。

### 7. 错误写法与正确写法

错误：

```ts
account: { accountLinking: { allowDifferentEmails: true } }
```

正确：

```ts
account: {
  accountLinking: {
    enabled: true,
    requireLocalEmailVerified: false,
  },
}
```

前者会允许已登录用户把另一个邮箱的 provider 账号绑定进来；后者只放宽本地邮箱验证条件，仍要求 provider 已验证并匹配当前账号邮箱。

## 场景：用户生命周期状态（status）

### 1. 范围与触发条件

- 适用范围：`user` 表的 `status` 列（active / suspended）+ 用户禁用/启用接口。
- 触发条件：管理员在用户管理页禁用/启用用户，或实现"封禁"类需求。
- 目标：被禁用用户无法登录、已有会话即时失效；启用后恢复登录。

### 2. 签名

```ts
// 三层拦截
// 1) 登录拦截：Better Auth 配置（auth.config.ts）
user: { additionalFields: { status: { type: "string", required: false, defaultValue: "active", input: false } } }
databaseHooks: { session: { create: { before: async (newSession) => { /* user.status === "suspended" 时 return false */ } } } }

// 2) 会话失效：禁用操作事务内 DELETE FROM session WHERE user_id = ?
// 3) guard 兜底（auth.service.ts requireSession）
if (session.user.status === "suspended") {
  throw new AppError(ApiErrorCodes.AUTH_USER_SUSPENDED, "账号已被禁用", 401);
}

// 管理接口
PATCH /api/users/{userId}/status
// body: { "status": "suspended" | "active" }，权限 authorization:manage
```

### 3. 契约

- `user.status` 取值只有 `active` / `suspended`，默认 `active`；DB 层无 CHECK（见 database-guidelines），
  由 contracts 的 `userStatusSchema`（z.enum）在接口入口强校验。
- `UserManagementUser` 含 `status` 字段；`updateUserStatusSchema` 校验请求体。
- 审计 action：`user.status_changed`，before/after 均为 `{ status }`。
- 新错误码：`AUTH.USER_SUSPENDED`（401）。

### 4. 校验与错误矩阵

| 条件 | 结果 |
| --- | --- |
| suspended 用户登录（密码/OAuth） | 创建 session 被拒，登录失败（`FAILED_TO_CREATE_SESSION`），不暴露封禁细节 |
| suspended 用户旧会话请求自有 API | 401（禁用时 session 已删除，通常是 AUTH.UNAUTHENTICATED；guard 检查兜底时返回 AUTH.USER_SUSPENDED） |
| 未登录调用状态接口 | 401 |
| 无 authorization:manage 权限 | 403 |
| 目标用户不存在 | 404 |
| 管理员禁用自己 | 400 COMMON.INVALID_REQUEST |
| 目标状态与当前一致 | 200 幂等成功，不写审计 |

### 5. 正确、基础和错误案例

- 正确：禁用即删全部 session + 状态置 suspended，用户下次请求 401，重新登录被拒。
- 基础：管理员先禁用再启用，用户重新登录恢复访问。
- 错误：只改 status 不删 session，或只在登录接口拦、不处理已登录会话——封禁不即时生效。

### 6. 必需测试

`apps/api/src/test/user-status.smoke.test.ts` 覆盖：登录拦截、旧会话 401、guard 兜底
（直接改库保留 session）、权限矩阵、防呆、幂等、审计写入。
