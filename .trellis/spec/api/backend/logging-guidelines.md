# API 日志规范

## Logger 创建

所有 logger 从 `createLogger` 创建，基础字段由 `createRuntime` 注入：`env`、`instance`、`release`、`service`。领域代码使用 `createChildLogger(logger, module)`，不要在模块里直接创建新的 Pino root logger。

```ts
const auth = createAuth(database.db, env, createChildLogger(logger, "auth"));
```

测试环境关闭 Pino 输出；开发环境使用 `pino-pretty`；生产环境默认输出 JSON，配置 `LOGS_DIR` 时额外使用 `pino-roll` 按天写入文件。

## 脱敏

`LOGGER_REDACT_PATHS` 覆盖 authorization、cookie、password、secret、token、clientSecret 及 headers 中的敏感字段。新增日志字段前确认不会带 session token、密码、OAuth secret 或完整请求 body。

Drizzle SQL 只在非 production 环境输出 debug，`createDrizzleLogger` 只记录 query 和 `paramsCount`，不记录参数值，因为参数可能包含密码哈希和 session token。

## 请求日志

`request-context.middleware.ts` 生成或接收合法的 `X-Request-Id`，并把 requestId 放入响应头和 request logger。`request-log.middleware.ts` 在 handler 完成后记录 method、path、status 和 durationMs：

- 5xx：error
- 401/403/404：info
- 其他 4xx：warn
- 成功但超过 1000ms：warn
- 其他成功：info

新增 middleware 如果需要 logger，应读取 `c.var.logger`，并保持 `registerMiddleware` 中 RequestContext 最先注册。
