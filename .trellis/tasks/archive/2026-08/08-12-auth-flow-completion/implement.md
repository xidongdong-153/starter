# 认证闭环：执行计划

## 实施清单（按序）

1. 依赖与 catalog
   - `pnpm-workspace.yaml` catalog 加 `nodemailer`、`@types/nodemailer`
   - `apps/api/package.json` 通过 `catalog:` 引用
   - `pnpm install`

2. env（apps/api/src/shared/env.ts + .env.example + README）
   - 新增 `SMTP_HOST` / `SMTP_PORT`（默认 587）/ `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `ADMIN_BASE_URL`。
   - 不配置 `SMTP_HOST` 时使用日志模式；配置 `SMTP_HOST` 时必须同时配置 `SMTP_FROM`，否则启动失败。

3. Mailer（apps/api/src/infra/mail/mailer.ts）
   - `MailMessage` / `Mailer` 接口、`LogMailer`、`SmtpMailer`、`createMailer(env, logger)`

4. 邮件模板（apps/api/src/modules/auth/auth.mail.ts）
   - `buildVerificationEmail`、`buildResetPasswordEmail`（text + html）

5. auth.config.ts
   - `createAuth` 增加 mailer 参数；实现 `sendVerificationEmail`、`sendResetPassword` 回调；`requireEmailVerification` 不开启

6. create-runtime.ts
   - 创建 mailer 并注入 createAuth

7. Admin API 封装（apps/admin/src/api/auth/）
   - `forgot-password.api.ts`、`reset-password.api.ts`、`verify-email.api.ts`、`change-password.api.ts`
   - `auth.query.ts` 加 4 个 mutations；`index.ts` 导出

8. Admin 页面
   - `features/auth/pages/ForgotPassword.tsx`、`ResetPassword.tsx`、`VerifyEmail.tsx`
   - `features/auth/routes.tsx` 注册 3 个无布局路由
   - `features/auth/pages/Login.tsx` 加「忘记密码？」链接
   - `features/account/pages/ProfileSettings.tsx` 加密码区块 + 邮箱验证状态/重发按钮

9. i18n（apps/admin/src/i18n/locales/zh.ts、en.ts）

10. 测试（apps/api/src/test/auth-flow.smoke.test.ts）
    - 验证流程 / 重置流程 / 修改密码流程 / LogMailer 单元测试

## 验证命令

```bash
pnpm --filter @starter/api test          # 新增 + 既有 smoke tests 全过
pnpm check-types                         # 类型检查
pnpm lint                                # lint，--max-warnings 0
pnpm format:check                        # 格式检查
```

## 风险点 / 回滚点

- 步骤 5 是行为切换点：改完先跑 `pnpm --filter @starter/api test` 确认注册链路仍正常。
- 通过注入捕获 Mailer 获取验证/重置链接。
- 验证 token 按 Better Auth JWT 处理，不从 `verification` 表读取。
- 修改密码测试创建两个会话，断言 `revokeOtherSessions: true` 后第二个会话失效。
- nodemailer 为 CJS，ESM 默认导入；类型包版本对齐 catalog。
- 回滚：还原 auth.config.ts 回调 + 移除 mailer 注入即可，无迁移。

## 完成后检查

- [x] 全量 `pnpm --filter @starter/api test` 通过
- [x] `pnpm check`（类型 + lint + format）通过
- [x] 手动流程：注册 → 日志出现验证邮件 → 访问 verify-email 页面验证成功
- [x] README 补充 SMTP 配置说明
