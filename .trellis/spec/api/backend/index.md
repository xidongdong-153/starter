# @starter/api 后端规范

## 适用范围

本目录描述 `apps/api/src/` 的 Hono + Node.js API。运行时由 `createRuntime` 创建数据库、文件存储、Better Auth 和 logger，再由 `createApp` 按顺序注册 middleware、错误处理、业务路由和 OpenAPI。

业务请求通常沿着 `route -> service -> repository -> presenter` 执行。接口输入由 Zod/OpenAPI schema 校验，响应由 `@starter/contracts` 的 DTO 和统一 response wrapper 生成。

## 开发前检查

1. 先看 `.trellis/spec/api/backend/directory-structure.md`，确认代码放在哪一层。
2. 修改接口前同时看对应模块的 `*.route.ts`、`*.schema.ts`、`*.service.ts`、`*.repository.ts`、`*.presenter.ts` 和 OpenAPI 定义。
3. 跨层字段先看 `packages/contracts/src/index.ts`，再更新 route schema 和 smoke test。
4. 数据库变更先看 `infra/db/schema/index.ts`、现有 migration 和 `AGENTS.md` 的 migration 命令。
5. 认证、日志、环境变量或存储改动要检查 `bootstrap/create-runtime.ts` 和对应 middleware。

## 质量检查

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
```

仓库级检查使用 `pnpm check`，构建使用 `pnpm build`。新 endpoint 至少要有状态码、错误 code、响应 DTO 和一个 `apps/api/src/test/` smoke test。

## 关键入口

- `apps/api/src/index.ts`：创建 runtime、监听 Node server、退出时关闭 SQLite。
- `apps/api/src/bootstrap/create-runtime.ts`：解析环境并装配基础设施。
- `apps/api/src/bootstrap/create-app.ts`：装配 Hono 应用。
- `apps/api/src/routes/index.ts`：注册 auth、system、profile、files 模块。
- `apps/api/src/shared/response.ts`：生成带 `meta.requestId` 和 `meta.timestamp` 的响应。

## 文件索引

- `directory-structure.md`：基础设施、模块、路由和测试目录。
- `database-guidelines.md`：Drizzle schema、migration、事务和测试数据库。
- `error-handling.md`：AppError、验证错误、统一响应和资源边界。
- `logging-guidelines.md`：Pino、request ID、日志级别和敏感字段脱敏。
- `authorization-guidelines.md`：已实现的授权中间件、权限接口、管理员 bootstrap 和错误边界。
- `authentication-guidelines.md`：Better Auth OAuth provider、同邮箱账号关联、Admin 绑定和错误校验契约。
- `ai-integration-guidelines.md`：AI Provider、加密凭据、模型目录、白名单、默认模型和 SSE 调用契约。
- `pi-agent-execution-guidelines.md`：Pi Agent executor、原生 stream、Tool adapter、Session entry、compaction、active Run 和审计边界。
- `quality-guidelines.md`：API、数据库和 smoke test 检查项。
