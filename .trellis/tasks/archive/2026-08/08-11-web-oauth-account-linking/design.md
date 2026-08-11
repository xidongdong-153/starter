# 技术设计

## 边界

- API 继续由 `apps/api/src/modules/auth/auth.config.ts` 创建 Better Auth 实例，并显式配置账号关联规则。
- Web 和 Admin 继续各自创建 `better-auth/react` 客户端，OAuth secret 只留在 API 环境变量中。
- Admin 绑定直接调用 Better Auth 的 `/api/auth/link-social`，不新增 Hono 业务路由；绑定结果仍通过现有 `/api/profile` 读取 `account.providerId`。
- `packages/contracts` 的 `AuthConfig` 和 `AccountProfile` 字段保持兼容，不增加 OAuth token 或账号 ID 到客户端 DTO。

## 数据流

### Web 登录和注册

1. `apps/web/components/auth/auth-form.tsx` 根据 `mode` 读取 `/api/config/auth`。
2. 页面只渲染后端已配置的 GitHub/Google 按钮；未配置任何 provider 时显示明确的不可用状态。
3. 点击按钮调用现有 `authClient.signIn.social({ provider, callbackURL })`。
4. Better Auth 处理 OAuth 回调：已有 provider 账号直接登录；没有 provider 账号但存在同邮箱用户时，按账号关联配置关联到该用户；否则创建用户。
5. 新用户继续触发现有 `databaseHooks.user.create.after`，创建 profile、默认 operator 角色和审计记录。
6. OAuth 完成后按页面模式跳回 Web 首页；登录页和注册页只通过底部链接互相切换。

### Admin 绑定

1. `ProfileSettings` 读取现有 profile query 和 auth config query。
2. 对 GitHub/Google 分别显示“已绑定”或“绑定”状态；未配置的 provider 不显示可操作按钮。
3. 点击绑定时调用 `authClient.linkSocial({ provider, callbackURL, errorCallbackURL })`，Better Auth 将当前 session 写入 OAuth state 并跳转到 provider。
4. OAuth callback 校验当前 session、provider 邮箱和账号归属；账号已属于其他用户时拒绝，不修改数据库关系。
5. 成功或失败都回到 Admin 个人资料页；页面刷新 profile query。失败 query 参数映射为本地化的可读消息，并在消费后清理 URL。

## Better Auth 配置

在 `createAuth` 中增加显式账号关联配置：

- `enabled: true`：允许显式 `linkSocial` 和隐式同邮箱关联。
- `requireLocalEmailVerified: false`：兼容当前项目邮箱验证不发送邮件的现状，允许已登录邮箱账号通过已验证的 GitHub/Google 邮箱自动关联。
- 不设置 `allowDifferentEmails: true`：Admin 绑定仍要求 OAuth 邮箱与当前账号邮箱一致，防止绑定到另一个邮箱身份。
- 不设置 `trustedProviders`：GitHub/Google 必须返回 `emailVerified`，不能仅凭 provider 名称跳过邮箱验证。

Better Auth 1.6.16 的回调逻辑会在隐式关联时检查 provider 邮箱验证状态、账号关联开关和本地邮箱条件；同一 provider account 已属于其他用户时不会转移账号。

## UI 设计

- Web 保留 `/login` 和 `/register` 两个页面路径，标题和说明按 `mode` 区分。
- Web 删除邮箱、密码、用户名输入和邮箱提交逻辑；保留 provider 配置异步加载、pending、错误和空 provider 状态。
- 登录页底部显示“还没有账户？去注册”；注册页显示“已有账户？去登录”。
- Admin 个人资料页沿用现有账号信息区域，在 provider 标签区域增加 GitHub/Google 的绑定操作；使用现有 `react-icons/si` 图标、Ant Design Button/Tag 和 i18n。
- 绑定期间按钮显示 loading；OAuth callback 错误使用 Alert 或 message，不能依赖中文错误文本做逻辑判断。

## 测试边界

- API smoke tests 覆盖 Better Auth 配置可读取、profile provider 列表保持兼容；OAuth provider 的真实授权由浏览器和第三方平台完成，不在本地 smoke test 伪造真实 OAuth 回调。
- Admin 测试覆盖 provider 配置、绑定状态、mutation pending 和 callback 错误参数的纯函数或组件分支；不测试 Ant Design 内部行为。
- Web 测试沿用当前项目可用的 type-check/build 和手工页面检查，重点确认两个页面没有邮箱密码表单、provider 未配置时不出现按钮。

## 风险与回滚

- 风险：关闭 `requireLocalEmailVerified` 会允许已验证 OAuth 邮箱关联到未验证的本地邮箱账号。该行为是本次“同邮箱自动合并”的明确产品选择；仍保留 provider 邮箱验证和相同邮箱检查。
- 风险：OAuth provider 未返回 verified email 时，Better Auth 会拒绝关联或创建流程；UI 显示回调错误，不创建半成品关联。
- 回滚：删除账号关联配置并恢复 Web 邮箱表单；Admin 绑定入口可以单独隐藏。数据库无需 migration，已建立的 account 关系不会被自动删除。
