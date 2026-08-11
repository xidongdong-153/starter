# 执行计划

## 1. API 认证规则

- [x] 在 `apps/api/src/modules/auth/auth.config.ts` 显式开启 Better Auth account linking，配置同邮箱自动关联所需条件。
- [x] 保持 `/api/config/auth` 和环境变量行为不变，确认 provider 未完整配置时仍返回 false。
- [x] 检查 Better Auth 配置类型，确认 GitHub/Google 只接受已验证邮箱，且不允许不同邮箱的 Admin 绑定。

## 2. Web OAuth 页面

- [x] 重构 `apps/web/components/auth/auth-form.tsx`，删除邮箱、密码、用户名输入和 email sign-in/sign-up 调用。
- [x] 保留 provider 配置加载、pending、错误处理和 GitHub/Google 条件渲染。
- [x] 根据 `mode` 保留不同标题、说明和登录/注册互链；补充未配置 provider 时的明确状态。
- [x] 更新 `/login`、`/register` 页面 metadata，使文案匹配 OAuth 登录/注册。

## 3. Admin 账号绑定

- [x] 在 `apps/admin/src/api/auth/` 增加 `linkSocial` API 函数和对应 mutation，沿用 Better Auth cookie 和 callback URL。
- [x] 在 `apps/admin/src/features/account/pages/ProfileSettings.tsx` 增加 GitHub/Google 的配置状态、绑定状态、按钮 pending 和失败反馈。
- [x] 处理 OAuth 回调中的错误 query 参数，显示 provider 已绑定到其他账号、邮箱不一致、邮箱未验证等可读消息，并清理已消费参数。
- [x] 补齐 `apps/admin/src/i18n/locales/zh.ts` 和 `en.ts` 的绑定状态、操作和错误文案。
- [x] 绑定成功返回当前资料页后刷新 `profileQuery`，不影响已有资料和头像操作。

## 4. 测试

- [x] 更新或新增 API smoke test，覆盖 auth config、provider 列表和现有 profile provider 兼容性；能在测试环境验证的账号初始化行为继续覆盖。
- [x] 新增 Admin `linkSocial` API 单元测试，覆盖成功、callback 错误消息和未登录状态 fallback；ProfileSettings 的 provider 状态、pending 和错误分支通过类型检查、构建和页面检查。
- [x] 对 Web 做页面检查，确认登录页和注册页不再出现邮箱、密码、用户名字段，并保留页面互链。

## 5. 验证顺序

按项目质量门禁依次执行：

1. `pnpm check-types`
2. `pnpm lint`
3. `pnpm format:check`
4. `pnpm test`
5. `pnpm --filter @starter/web build`

实现后还要手工启动 API、Web、Admin，在 provider 配置为空和配置完整两种状态检查按钮显示；有真实 OAuth client credentials 时验证首次注册、同邮箱自动关联和 Admin 绑定回跳。

## 风险检查点

- API 配置改动后先运行 API type-check，避免 Better Auth 1.6.16 配置类型与预期不同。
- Web 删除表单后检查 `/login`、`/register` 和所有导航链接仍可达。
- Admin 绑定 callback 的 `callbackURL` 和 `errorCallbackURL` 必须使用允许的 trusted origin，不能把任意 query URL 直接交给 Better Auth。
- 不新增 migration；确认 git diff 没有环境文件、数据库、token 或构建产物。
