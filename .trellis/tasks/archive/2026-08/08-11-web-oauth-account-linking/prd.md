# 配置 Web OAuth 登录并支持 Admin 账号绑定

## Goal

让公开 Web 只通过 GitHub 或 Google 完成注册和登录；让已登录 Admin 用户在个人资料页绑定 GitHub 或 Google，之后可以使用绑定的第三方账号登录同一个账户。

## Confirmed Facts

- `apps/api/src/modules/auth/auth.config.ts` 已配置 Better Auth 的 `socialProviders.github` 和 `socialProviders.google`，只有对应的 client ID 和 secret 同时存在时才启用。
- `apps/api/src/modules/auth/auth.route.ts` 的 `/api/config/auth` 已返回 `email`、`github`、`google` 三种配置状态；`apps/api/.env.example` 已包含 GitHub 和 Google 的环境变量。
- `apps/web/components/auth/auth-form.tsx` 已渲染 GitHub、Google 按钮，但同时渲染邮箱、密码表单和邮箱注册流程。
- `apps/admin/src/features/auth/components/SocialSignInButtons.tsx` 已支持按后端配置显示 GitHub、Google 登录按钮；Admin 当前仍保留邮箱密码登录和注册。
- `apps/admin/src/features/account/pages/ProfileSettings.tsx` 已在个人资料页读取 `AccountProfile.providers` 并展示 provider 标签，但没有绑定或解绑操作。
- `apps/api/src/modules/profile/profile.repository.ts` 已能读取当前用户的 `account.providerId`；`account` 表通过 `userId` 支持同一用户关联多个账号。
- Better Auth 的账号关联行为、OAuth 回调和绑定接口需要以当前项目使用的 Better Auth 版本 API 为准，并覆盖已登录用户绑定和 provider 已被其他用户占用的情况。

## Requirements

- R1. API 保留 GitHub 和 Google 的环境变量配置，并让 Web、Admin 根据 `/api/config/auth` 的结果只显示已配置的 provider。
- R2. Web 登录页不包含邮箱、密码输入框、邮箱登录按钮或指向邮箱密码注册流程的操作；已配置的 GitHub 和 Google 作为登录入口，并提供“还没有账户，去注册”的跳转。
- R3. Web 注册入口不包含用户名、邮箱、密码输入框或邮箱注册操作；用户点击 GitHub 或 Google 后，由 OAuth 流程完成首次注册或已有账号登录，并提供“已有账户，去登录”的跳转。
- R4. Web 未注册用户通过 GitHub 或 Google OAuth 后创建账户，并完成现有新用户资料、默认角色等初始化逻辑；已存在且能匹配的第三方账号登录原账户。
- R4a. 如果 OAuth provider 返回的邮箱已属于现有账号，且 provider 已证明该邮箱，允许 Better Auth 将 OAuth 账号自动关联到该现有用户，不创建重复用户；关联失败时不得改变原有账号关系。
- R5. Admin 个人资料页提供 GitHub 和 Google 的绑定状态，并允许当前已登录用户发起未绑定 provider 的 OAuth 绑定流程。
- R6. 绑定成功后，Admin 个人资料页能刷新并显示新的 provider；已有的个人资料字段、头像和其他登录方式不受影响。
- R7. 绑定流程不能把已属于其他用户的 GitHub 或 Google 账号转移到当前用户；冲突时给出可理解的错误，原账号关系保持不变。
- R8. 保留 Admin 现有邮箱密码登录和注册，除非后续规划明确要求移除；本次 Web-only 登录限制不改变 Admin 登录方式。
- R9. 为 API 账号关联、Web 登录入口和 Admin 绑定状态/操作补充与现有测试框架一致的验证。

## Acceptance Criteria

- [ ] GitHub、Google 任一 provider 未配置时，Web 和 Admin 都不显示对应按钮；配置后显示对应入口。
- [ ] Web 登录页和注册页只提供已配置的 GitHub、Google OAuth 入口，不出现邮箱、密码和用户名表单；登录页链接到注册页，注册页链接到登录页。
- [ ] 使用未注册的 GitHub 或 Google 账号完成 OAuth 后，能创建用户、初始化个人资料和默认角色，并建立对应 provider 账号关系。
- [ ] 使用已注册的 GitHub 或 Google 账号完成 OAuth 后，进入原用户账户，不产生重复用户。
- [ ] OAuth provider 返回的已验证邮箱属于现有账号时，登录后进入该现有账号并新增 provider 关联，不产生重复用户。
- [ ] Admin 用户在个人资料页能看到 GitHub、Google 当前绑定状态；点击未绑定 provider 后完成 OAuth，返回 Admin 并显示已绑定。
- [ ] 当 provider 账号已属于其他用户时，绑定失败且不会改变任一用户的账号关系。
- [ ] Admin 现有邮箱密码登录和注册流程继续可用。
- [ ] 相关 API smoke tests、类型检查、Lint 和 Prettier 检查通过。

## Out of Scope

- 本次不移除 Admin 的邮箱密码登录和注册。
- 本次不新增账号解绑、删除用户、修改邮箱或密码找回流程。
- 本次不改变 GitHub、Google OAuth 应用在第三方平台控制台中的创建和审核流程。
- 本次不增加新的登录 provider。

## Decisions

- 同邮箱自动关联：采用 Better Auth 的默认账号关联机制，但只接受 provider 已验证的邮箱；provider 账号已属于其他用户时仍然报冲突，不转移账号。
- Web 路由：保留 `/login` 与 `/register` 两个入口，降低现有导航和外部链接的兼容风险；两页都只展示 OAuth 操作，登录页链接到注册页，注册页链接到登录页。

## Constraints

- 遵循现有 Hono、Better Auth、Drizzle、Next.js、Vite React、TanStack Query 和共享 contracts 结构。
- 不把 OAuth client secret 写入 Web 或 Admin 前端环境变量。
- 修改完成后按项目要求依次运行类型检查、Lint、Format 检查，并运行 API 测试。
