# Contracts 错误规范

所有自有 API error code 集中在 `ApiErrorCodes`，值使用稳定的分组字符串，如 `AUTH.UNAUTHENTICATED`、`COMMON.NOT_FOUND`、`FILES.UNSUPPORTED_TYPE`。API 的 `AppError` 和客户端应使用 `ApiErrorCode`，不要根据中文 message 做分支。

失败响应保持固定结构：

```ts
export interface ApiFailure<TDetails = unknown> {
  ok: false;
  error: ApiError<TDetails>;
  meta: ApiMeta;
}
```

`details` 是可选的扩展数据，不能放 secret、SQL、文件系统路径或堆栈。新增 code 时同步 API status 映射、OpenAPI schema、Admin/Web parser 和测试。
