# Starter

这是一个本地运行的 TypeScript 全栈脚手架。Web 使用公开站点壳提供首页、文稿、项目、搜索、注册、登录、session 和公开资料页面；Admin 用于维护当前用户的个人资料与文件；API 使用 Hono、Better Auth、Drizzle 和 SQLite。文稿、项目和搜索接口尚未接入，Web 对应路由只显示空状态。

## 目录

- `apps/web`：Next.js Web，默认端口 `4399`。
- `apps/admin`：Vite React Admin，默认端口 `2333`。
- `apps/api`：Node.js Hono API，默认端口 `7788`。
- `packages/contracts`：API 与前端共用的 Zod schema 和 TypeScript 类型。
- `packages/theme`：Web 与 Admin 共用的 Rose Pine 主题变量和样式入口。
- `packages/eslint-config`：ESLint 和 Prettier 配置。

## 环境要求

- Node.js 22 或更高版本
- pnpm 11

## 安装

```bash
pnpm install
pnpm approve-builds better-sqlite3 esbuild sharp @prisma/client
```

`@prisma/client` 只来自 Better Auth CLI 的开发依赖，应用运行时不使用 Prisma。

## 环境变量

先创建各应用的本地环境文件：

```bash
cp apps/api/.env.example apps/api/.env.development
cp apps/web/.env.example apps/web/.env.development
cp apps/admin/.env.example apps/admin/.env.development
```

至少把 `apps/api/.env.development` 中的 `BETTER_AUTH_SECRET` 改为 32 个字符以上的随机值。`DATABASE_PATH` 和 `FILES_DIR` 分别控制 SQLite 文件和上传目录。GitHub 或 Google 的 client ID 与 secret 必须成对填写；留空时 API 仍可启动，前端不会显示对应按钮。

邮件发送支持验证邮箱和密码重置。不配置 SMTP 时邮件内容打印到 API 日志，适合本地开发；配置后走真实发送：

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password
SMTP_FROM=no-reply@example.com
# 邮件链接指向的 Admin 前端地址，默认 http://localhost:2333
ADMIN_BASE_URL=http://localhost:2333
```

## 数据库

首次启动前执行 migration：

```bash
pnpm --filter @starter/api db:check
pnpm --filter @starter/api db:migrate
```

修改 `apps/api/src/infra/db/schema/index.ts` 后生成新的 migration：

```bash
pnpm --filter @starter/api db:generate
```

API 不会在启动时自动修改 schema。migration 会创建 `admin`、`operator`、`viewer` 三个系统角色；已有用户和新注册用户默认获得 `operator`。

要显式设置管理员时，按下面顺序操作：

1. 执行 migration。
2. 注册目标账号。
3. 在 `apps/api/.env.development` 设置 `AUTH_BOOTSTRAP_ADMIN_EMAIL`，值必须是已存在账号的邮箱。
4. 执行 bootstrap 命令：

```bash
pnpm --filter @starter/api auth:bootstrap-admin
```

邮箱未配置、用户不存在、授权 migration 未执行时命令会返回错误并以非零状态退出。重复执行不会添加重复角色关系。API 启动和普通注册不会自动创建管理员。

## API 架构

`apps/api/src/bootstrap/create-runtime.ts` 创建 SQLite、文件存储和 Better Auth。`apps/api/src/bootstrap/create-app.ts` 接收 runtime，注册中间件、错误处理、404 和一级路由。`apps/api/src/index.ts` 只初始化存储、监听端口并在进程退出时关闭 SQLite。

业务代码按模块放在 `apps/api/src/modules/system`、`auth`、`profile`、`files` 和 `authorization`。涉及数据库的请求按 `route -> service -> repository` 执行，presenter 把数据库记录转成 `packages/contracts` 中的响应 DTO。数据库 schema 和 migration 仍在 `apps/api/src/infra/db`，本地文件实现放在 `apps/api/src/infra/storage`。

API 自己实现的 JSON 接口返回 `{ ok, data, meta }` 或 `{ ok, error, meta }`。`/api/auth/*` 由 Better Auth 直接处理，不使用这层响应包装。文件下载和公开头像接口继续返回文件内容。

## 开发

同时启动三个应用：

```bash
pnpm dev
```

也可以分别启动：

```bash
pnpm dev:web
pnpm dev:admin
pnpm dev:api
```

打开 `http://localhost:4399` 使用 Web，打开 `http://localhost:2333` 使用 Admin。API 健康检查地址是 `http://localhost:7788/health`。

## 检查

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

`pnpm test` 运行 `apps/api/src/test` 下的 smoke tests。测试给 app 注入独立 runtime，使用临时 SQLite 数据库和临时文件目录，不读写 `apps/api/data/app.db`。
