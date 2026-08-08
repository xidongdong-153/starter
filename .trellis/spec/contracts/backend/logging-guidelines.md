# Contracts 日志边界

共享 contracts 包不创建 logger、不输出 console，也不处理 request log。`ApiMeta` 只描述请求关联字段，API 在 `apps/api/src/shared/meta.ts` 创建 `requestId` 和 timestamp。

不要把日志消息、Pino 类型或服务器内部诊断字段加入 DTO。需要把错误细节提供给调用方时，使用 `ApiError.details`，并由 API error handler 决定是否返回；敏感字段仍由服务端日志脱敏规则控制。
