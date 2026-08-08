# API 错误处理规范

## 业务错误

业务层使用 `AppError` 携带 `ApiErrorCode`、HTTP status 和可选 details。错误 code 必须来自 `packages/contracts/src/index.ts` 的 `ApiErrorCodes`，不要在 route 或 service 中散落字符串 code。

```ts
throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "文件不存在", 404);
```

当前 status 允许 `400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503 | 504`。输入校验失败通过 `throwValidationError` 转成 `COMMON.INVALID_REQUEST`；登录守卫返回 `AUTH.UNAUTHENTICATED`。

## 全局处理

`bootstrap/error-handler.ts` 按以下顺序处理：

1. `AppError` 原样保留 code、message、details 和 status。
2. `HTTPException` 映射为普通 invalid request，504 映射为 upstream timeout。
3. 未知错误只记录服务端错误，客户端收到 `SYSTEM.INTERNAL_ERROR` 和“服务内部错误”。
4. 未匹配路由返回 `COMMON.NOT_FOUND`。

所有自有 JSON 错误都通过 `createFailureResponse` 返回：

```json
{
  "ok": false,
  "error": { "code": "COMMON.NOT_FOUND", "message": "资源不存在" },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

Better Auth 的 `/api/auth/*` 由 Better Auth 直接处理，不要强行套入自有 response wrapper；客户端认证代码按 Better Auth 返回值处理。

## 边界行为

资源查询失败时统一返回 404，不向客户端暴露 SQL、文件系统路径、secret 或堆栈。`files.service.ts` 读取文件失败、`profile.service.ts` 读取头像失败都转换为资源不存在。

## 客户端约定

Admin 的 `ApiRequestError` 读取 `error.message`，Web 的 `apiRequest` 校验 `ok/error/meta`。新增 error code 时必须同步 contracts、OpenAPI response、服务端 smoke test 和客户端错误处理。
