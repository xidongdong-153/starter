# 认证闭环：技术设计

## 1. 架构与边界

```
createRuntime (apps/api/src/bootstrap/create-runtime.ts)
 ├─ env（新增 SMTP_* / ADMIN_BASE_URL；不配置 SMTP_HOST 时使用日志模式，配置 SMTP_HOST 时必须配置 SMTP_FROM）
 ├─ logger
 ├─ mailer = createMailer(env, logger)          ← 新增 infra/mail/
 └─ auth = createAuth(db, env, logger, mailer)  ← 注入 mailer
```

- 邮件只负责"发送"：`infra/mail/` 提供 Mailer 接口与两种实现，与认证模块解耦。
- 邮件内容构造放 `modules/auth/auth.mail.ts`（模板依赖 Better Auth 回调的 token/user 形态）。
- Better Auth 端点全部复用原生实现（verify-email / send-verification-email / request-password-reset / reset-password / change-password），不自建端点。已核实 1.6.16 中这些端点与 client 方法齐全。
- 前端只新增页面和 API 封装，不碰自有 JSON 接口层；contracts 不改动（Better Auth 端点不走 `{ok,data}` 包装）。

## 2. Mailer 接口与实现

```ts
// apps/api/src/infra/mail/mailer.ts
interface MailMessage { to: string; subject: string; text: string; html?: string }
interface Mailer { sendMail(message: MailMessage): Promise<void> }
createMailer(env, logger): Mailer
```

- 未配置 `SMTP_HOST` → `LogMailer`：`logger.info({ to, subject }, text)`，本地开发零依赖可调试。
- 配置 `SMTP_HOST` → `SmtpMailer`：nodemailer `createTransport`。
  - `SMTP_HOST` 存在时必须同时配置 `SMTP_FROM`，否则 `parseEnv` 在 API 启动阶段抛错。
  - `SMTP_PORT === 465` → `secure: true`；否则 `secure: false`（STARTTLS）。
  - `from` 固定取 `SMTP_FROM`。
- 依赖：`nodemailer` + `@types/nodemailer`，加入 `pnpm-workspace.yaml` catalog。

## 3. env 新增（未配置 SMTP 时不影响现有启动）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SMTP_HOST` | 空 | 配置后启用 SMTP 发送，否则日志模式 |
| `SMTP_PORT` | `587` | 465 → secure |
| `SMTP_USER` | 空 | transport auth.user |
| `SMTP_PASS` | 空 | transport auth.pass |
| `SMTP_FROM` | 空；配置 `SMTP_HOST` 时必填 | 发件人地址 |
| `ADMIN_BASE_URL` | `http://localhost:2333` | 邮件内链接指向 Admin 前端 |

同步更新 `apps/api/src/shared/env.ts`、`.env.example`、README。

## 4. 邮件模板（modules/auth/auth.mail.ts）

- `buildVerificationEmail({ link, name })`：标题「验证你的 Starter 邮箱」，正文含链接与「1 小时内有效」说明。
- `buildResetPasswordEmail({ link, name })`：标题「重置你的 Starter 密码」，正文含链接与有效期说明。
- 纯文本 + 简单 HTML 双份；文案遵循 xdd-plain-docs 规范（具体事实、无 emoji、无套话）。

## 5. auth.config.ts 改造

```ts
createAuth(db, env, logger, mailer)

emailVerification: {
  sendVerificationEmail: async ({ token, user }) => {
    const link = `${env.ADMIN_BASE_URL}/verify-email?token=${token}`;
    await mailer.sendMail(buildVerificationEmail({ link, name: user.name }));
  },
},
emailAndPassword: {
  enabled: true,
  minPasswordLength: 8,
  sendResetPassword: async ({ token, user }) => {
    const link = `${env.ADMIN_BASE_URL}/reset-password?token=${token}`;
    await mailer.sendMail(buildResetPasswordEmail({ link, name: user.name }));
  },
},
```

- `requireEmailVerification` 保持 false（决策：不强制验证，登录后提示）。
- 链接指向 Admin SPA 页面（SPA 拿 token 调 `authClient.verifyEmail` / `authClient.resetPassword`），不依赖 Better Auth 的内置 HTML 页。

## 6. Admin 前端

新增页面（`features/auth/pages/`，无布局路由）：

| 路由 | 页面 | 行为 |
| --- | --- | --- |
| `/forgot-password` | ForgotPassword | 邮箱表单 → `authClient.requestPasswordReset({ email })` → 固定提示「如果该邮箱存在，将收到重置邮件」（防枚举） |
| `/reset-password?token=` | ResetPassword | 新密码 + 确认 → `authClient.resetPassword({ newPassword, token })` → 成功跳 `/login` |
| `/verify-email?token=` | VerifyEmail | 挂载即调用 `authClient.verifyEmail({ query: { token } })`；成功显示 1.5 秒提示后自动跳 `/login`，失败显示错误和登录按钮 |

改动文件：

- `features/auth/routes.tsx`：注册 3 个新路由。
- `features/auth/pages/Login.tsx`：密码框下加「忘记密码？」链接。
- `features/account/pages/ProfileSettings.tsx`：新增「密码」区块：
  - 邮箱验证状态（`session.user.emailVerified`）：未验证显示警告 + 「发送验证邮件」按钮（`authClient.sendVerificationEmail()`）。
  - 只有 `credential` provider 存在时显示修改密码表单；只有 OAuth provider 的账号显示未设置邮箱密码提示。
  - 修改密码表单：当前密码 / 新密码 / 确认新密码 / 「吊销其他会话」开关（默认开）→ `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })`。
- `api/auth/`：新增 `forgot-password.api.ts`、`reset-password.api.ts`、`verify-email.api.ts`、`change-password.api.ts`；`auth.query.ts` 加对应 mutations；`index.ts` 导出。
- `i18n/locales/zh.ts`、`en.ts`：新增文案 key。

## 7. 测试（apps/api/src/test/auth-flow.smoke.test.ts）

通过注入捕获 Mailer 获取 Better Auth 回调生成的真实邮件链接，不 mock Better Auth：

- 验证 token：注册后从捕获的验证邮件中提取 JWT，调用 `GET /api/auth/verify-email?token=`，查用户记录断言 `emailVerified === true`。
- 重置 token：注册后请求重置，从捕获的重置邮件中提取 token，调用 `POST /api/auth/reset-password`，再验证新旧密码登录结果。
- 修改密码：创建两个会话，用第一个会话传 `revokeOtherSessions: true` 修改密码；第一个会话继续有效，第二个会话的 `GET /api/auth/get-session` 返回未登录。
- LogMailer 单元测试：`sendMail` 不抛错、logger 收到消息。
- `parseEnv` 测试：配置 `SMTP_HOST` 但没有 `SMTP_FROM` 时抛错。

## 8. 兼容性与回滚

- 全部新增能力，不修改既有端点行为；`emailVerified` 字段 Better Auth 原生已有，前端 session 类型直接可用。
- 未配置 SMTP 时行为等同现在的「日志模式」，老用户无感知。
- 回滚：还原 auth.config.ts 两个回调为 no-op 并删除 mailer 注入即可，无数据迁移。

## 9. 风险

- nodemailer 在 ESM 项目用 `import nodemailer from "nodemailer"`（包为 CJS，默认导入可用）。
- `change-password` / `send-verification-email` 走敏感会话中间件，需带 cookie——现有 `authClient` 已配置 `credentials: 'include'`，无风险。
- 测试中 better-auth logger 已 disable，不影响 mailer 输出。
