# @starter/contracts 后端规范

## 适用范围

`packages/contracts/src/index.ts` 是 API 与客户端共用的单文件契约包。它只声明 Zod schema、TypeScript DTO、API response 类型和 error code，不访问数据库、文件系统或运行时环境。

## 开发前检查

1. 先读 `packages/contracts/src/index.ts` 的现有字段和导出顺序。
2. 确认变更同时影响 API route/OpenAPI、presenter、Admin/Web parser 和 smoke tests 的哪些位置。
3. 输入约束使用 Zod schema，服务端 route 和客户端运行时 guard 不要各自发明另一套字段名。
4. 新 error code 必须确认 `AppError`、failure response 和客户端处理分支。

## 质量检查

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
```

新增契约字段后至少运行 API tests，并检查 `apps/admin/src/api/` 和 `apps/web/lib/api/` 的消费代码。

## 主要导出

- `ApiErrorCodes`、`ApiErrorCode`：错误 code 字面量集合。
- `ApiMeta`、`ApiSuccess`、`ApiFailure`、`ApiResponse`：统一 HTTP JSON 类型。
- `buildSuccess`、`buildFailure`：保持 `ok/data/error/meta` 结构的构造函数。
- `updateProfileSchema`、`setAvatarSchema`、`renameFileSchema`：输入验证。
- `AccountProfile`、`PublicProfile`、`FileItem`、`AuthConfig`：跨层 DTO。

## 文件索引

- `directory-structure.md`：单文件入口和 package exports。
- `database-guidelines.md`：无数据库状态和 API presenter 转换边界。
- `error-handling.md`：error code、failure response 和 details。
- `logging-guidelines.md`：无日志副作用的共享包边界。
- `quality-guidelines.md`：契约变更的后端检查。
