# API 对前端的类型安全

HTTP 边界的共享类型来自 `@starter/contracts`。输入使用 Zod schema，例如 `updateProfileSchema`、`setAvatarSchema` 和 `renameFileSchema`；输出使用 `AccountProfile`、`PublicProfile`、`FileItem` 与 `ApiSuccess/ApiFailure`。

OpenAPI route 的 request schema、contracts schema 和 presenter DTO 必须表达同一组字段。API 内部的 Drizzle `ProfileRecord`、`FileRecord` 不应导出到客户端。

新增 API error code 时在 `ApiErrorCodes` 中增加字面量，再让服务端 `AppError`、OpenAPI failure response、Admin/Web parser 和测试使用同一个 code；不要让客户端根据中文 message 判断业务分支。
