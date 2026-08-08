# Repository Guidelines

## 项目结构

```
starter/
├── apps/
│   ├── web/       # 公开站点，Next.js，默认端口 4399
│   ├── admin/     # 管理后台，Vite + React SPA，默认端口 2333
│   └── api/       # API 服务，Hono + Node.js，默认端口 7788
├── packages/
│   ├── contracts/      # 前后端共用的 Zod schema 和 TypeScript 类型
│   ├── theme/          # Rose Pine 主题变量（Tailwind CSS + Ant Design token）
│   └── eslint-config/  # 共享 ESLint 和 Prettier 配置
├── turbo.json              # Turborepo 构建配置
└── pnpm-workspace.yaml     # pnpm 工作空间配置
```

## 环境要求

- **Node.js**: >= 22
- **包管理器**: pnpm（版本 11.9.0）

安装依赖：

```bash
pnpm install
pnpm approve-builds better-sqlite3 esbuild sharp @prisma/client
```

## 常用命令

| 命令                                       | 说明                                         |
| ------------------------------------------ | -------------------------------------------- |
| `pnpm dev`                                 | 同时启动所有应用                             |
| `pnpm dev:web`                             | 单独启动 Web（http://localhost:4399）        |
| `pnpm dev:admin`                           | 单独启动 Admin（http://localhost:2333）      |
| `pnpm dev:api`                             | 单独启动 API（http://localhost:7788/health） |
| `pnpm build`                               | 构建所有包和应用                             |
| `pnpm check`                               | 依次运行类型、Lint 和 Format 检查            |
| `pnpm check-types`                         | 运行 TypeScript 类型检查                     |
| `pnpm lint`                                | 检查代码规范                                 |
| `pnpm format`                              | 用 Prettier 格式化仓库文件                   |
| `pnpm format:check`                        | 检查仓库文件是否符合 Prettier 格式           |
| `pnpm test`                                | 运行 API smoke tests                         |
| `pnpm clean`                               | 清理各包的构建产物                           |
| `pnpm --filter @starter/api db:generate`   | 根据 schema 生成 Drizzle migration 文件      |
| `pnpm --filter @starter/api db:migrate`    | 执行所有待执行的 migration                   |
| `pnpm --filter @starter/api db:check`      | 检查 migration 状态                          |
| `pnpm --filter @starter/api db:studio`     | 打开 Drizzle Studio 查看数据库               |
| `pnpm --filter @starter/api auth:generate` | 生成 Better Auth 的数据库 schema 文件        |

## 代码规范

- **TypeScript**: 严格模式，启用 `noUncheckedIndexedAccess`，版本 5.9.x
- **ESLint**: flat config 格式，基于 `@antfu/eslint-config` + `eslint-config-prettier`，配置位于 `packages/eslint-config/`
- **Prettier**: 统一代码格式，`--max-warnings 0`
- **React**: 版本 19，Web 配合 Next.js 16.2.x，Admin 配合 Vite

## Commit Message

- 默认使用 Conventional Commits 短格式：`<type>(<scope>)!: <subject>`
- `scope` 可选，只写当前项目 `apps/` 和 `packages/` 下的目录名：`web`、`admin`、`api`、`contracts`、`theme`、`eslint-config`
- `subject` 用英文短句，首字母小写，不加句号，尽量控制在 50 字符以内
- 常用类型：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`types`、`release`、`revert`
- 破坏旧用法时加 `!`，并在正文写 `BREAKING CHANGE:`
- 不添加 `Generated with ...`、`Co-authored-by ...` 等工具署名，除非用户明确要求

## 测试

- 测试框架：Vitest
- 测试文件位于 `apps/api/src/test/`，涵盖 auth、files、profile 三组 smoke tests
- 每次测试给 app 注入独立的临时 SQLite 数据库和临时文件目录，不读写 `apps/api/data/app.db`
- 运行：`pnpm test`（等同于 `pnpm --filter=@starter/api test`）

## 环境变量

首次使用时从示例文件复制：

```bash
cp apps/api/.env.example apps/api/.env.development
cp apps/web/.env.example apps/web/.env.development
cp apps/admin/.env.example apps/admin/.env.development
```

API 的关键变量：

- `BETTER_AUTH_SECRET`：必须修改为 32 个字符以上的随机值
- `DATABASE_PATH`：SQLite 文件路径
- `FILES_DIR`：上传文件目录
- GitHub 和 Google OAuth 的 client ID 与 secret 必须成对填写；留空时 API 仍可启动，前端不显示对应登录按钮

本地覆盖文件命名规则：

```
.env.development  # 开发环境（不提交）
.env.production   # 生产环境（不提交）
```

`.gitignore` 已排除 `.env` 和 `.env.*`，`.env.example` 文件提交到仓库。

## 数据库

API 使用 Drizzle ORM + better-sqlite3。

首次启动前执行 migration：

```bash
pnpm --filter @starter/api db:check
pnpm --filter @starter/api db:migrate
```

修改 `apps/api/src/infra/db/schema/index.ts` 后，生成新的 migration 文件：

```bash
pnpm --filter @starter/api db:generate
```

API 启动时不会自动执行 migration，每次改动 schema 后需手动跑 `db:migrate`。

## API 架构

业务代码按模块组织在 `apps/api/src/modules/`：`system`、`auth`、`profile`、`files`。

请求执行路径：`route → service → repository`，presenter 把数据库记录转成 `packages/contracts` 中的响应 DTO。

- `apps/api/src/bootstrap/create-runtime.ts`：初始化 SQLite、文件存储和 Better Auth
- `apps/api/src/bootstrap/create-app.ts`：注册中间件、错误处理、404 和一级路由
- `apps/api/src/index.ts`：监听端口，进程退出时关闭 SQLite

自有 JSON 接口统一返回 `{ ok, data, meta }` 或 `{ ok, error, meta }`。`/api/auth/*` 由 Better Auth 直接处理，不经过这层响应包装。

## 依赖版本管理

共享依赖版本统一维护在 `pnpm-workspace.yaml` 的 `catalog` 中，各子包通过 `catalog:` 引用，避免版本漂移。新增共享依赖需同步更新 `pnpm-workspace.yaml`。

## 注意事项

- `@prisma/client` 只来自 Better Auth CLI 的开发依赖，应用运行时不使用 Prisma
- `.turbo/` 是本地构建缓存，可安全删除后重新生成
- 提交前运行 `pnpm check` 确保类型、Lint 和 Format 全部通过
