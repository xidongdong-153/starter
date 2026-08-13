# 认证闭环：邮箱验证 + 忘记/重置密码 + 修改密码

## Goal

补齐 Starter 脚手架邮件密码认证的闭环：注册后可验证邮箱、忘记密码可自助重置、登录后可在账户设置修改密码。邮件发送未配置服务商时输出到日志（本地开发可调试），配置 SMTP 后真实发送。

## Background

- Better Auth 1.6.16（catalog 管理），已启用 `emailAndPassword`（minPasswordLength 8），DB 为 Drizzle + SQLite。
- `apps/api/src/modules/auth/auth.config.ts`：认证邮件回调原先为空；当前通过 Mailer 发送验证和重置邮件。
- Better Auth 邮箱验证 token 是带有效期的 JWT，不写入 `verification` 表；密码重置 token 才写入该表。
- Better Auth 原生端点齐全（已核实 1.6.16 源码）：`send-verification-email`、`verify-email`、`request-password-reset`、`reset-password`、`change-password`，client 端 `authClient` 有对应方法。
- `change-password` 的 `revokeOtherSessions` 默认 false，需显式传 true 才吊销其他会话。
- Admin（apps/admin）有完整邮箱密码登录/注册（antd + TanStack Query + i18n），账户设置页已有资料/头像/社交绑定，无密码区块。
- Web（apps/web）登录/注册只有社交登录，无邮箱密码，不需要重置密码入口。
- 测试体系：smoke tests 注入独立临时 SQLite（`apps/api/src/test/helpers.ts`），测试通过注入捕获 Mailer 获取 Better Auth 回调生成的邮件链接。
- 登录限流、2FA、会话管理不在本任务范围（见 Out of Scope）。

## Key Decisions

- D1 邮件实现：Mailer 抽象层（`apps/api/src/infra/mail/`）——未配置 SMTP 时日志模式打印邮件内容，配置 `SMTP_HOST` 后走 nodemailer 真实发送。
- D2 验证策略：不强制验证（`requireEmailVerification` 保持 false），未验证用户可登录，Admin 账户设置页展示验证状态并支持重发。
- D3 邮件链接指向 Admin SPA 页面（`/verify-email?token=`、`/reset-password?token=`），由 SPA 调 `authClient` 完成验证/重置，不依赖 Better Auth 内置 HTML 页。
- D4 新端点复用 Better Auth 原生实现，不自建 API；contracts 不改动。

## Requirements

- R1 邮箱验证：注册成功后自动触发发送验证邮件（`sendVerificationEmail` 回调）；账户设置页显示验证状态，未验证时提供「发送验证邮件」按钮。
- R2 忘记密码：登录页「忘记密码」入口 → `/forgot-password` 提交邮箱 → 邮件内链接指向 `/reset-password?token=` → 设置新密码成功后可登录。
- R3 修改密码：账户设置页密码区块（当前密码 + 新密码 + 确认 + 「吊销其他会话」开关，默认开）→ `changePassword`。
- R4 邮件发送抽象：`Mailer` 接口 + `LogMailer` + `SmtpMailer`；env 新增 `SMTP_HOST`/`SMTP_PORT`(默认 587)/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`/`ADMIN_BASE_URL`(默认 `http://localhost:2333`)。不配置 `SMTP_HOST` 时使用日志模式；配置 `SMTP_HOST` 时必须同时配置 `SMTP_FROM`，否则 API 启动失败。
- R5 邮件模板：验证/重置邮件各含链接与「1 小时内有效」说明，纯文本 + 简单 HTML，文案遵循 xdd-plain-docs 规范。
- R6 防枚举：`/forgot-password` 提交后固定提示「如果该邮箱存在，将收到重置邮件」，不泄露账号是否存在。
- R7 测试：验证流程、重置流程、修改密码流程 smoke tests + LogMailer 单元测试。

## Acceptance Criteria

- [x] AC1 注册新用户后日志出现验证邮件内容（未配置 SMTP 时），点击/请求链接后 `emailVerified` 变为 true。
- [x] AC2 账户设置页显示邮箱验证状态，可重发验证邮件并给出成功提示。
- [x] AC3 `/forgot-password` 提交邮箱后固定提示；通过邮件链接设置新密码后可用新密码登录，旧密码失效。
- [x] AC4 账户设置页可修改密码（校验当前密码），成功后可用新密码登录；勾选吊销时其他会话失效。
- [x] AC5 未配置邮件服务商时 `pnpm dev:api` 正常启动，邮件打印到日志；配置 SMTP 后真实发送（环境允许时验证）。
- [x] AC6 `pnpm --filter @starter/api test` 新增用例与既有用例全部通过；`pnpm check` 类型、Lint、Format 三项通过。

## Out of Scope

- 登录/注册限流（rate limit，另立项）
- 2FA / 多设备会话管理 / 踢下线
- Web 端邮箱密码登录与重置密码入口（web 仅有社交登录）
- 邮件模板系统化（多语言、品牌模板）
- 管理端「管理员代重置密码」功能
