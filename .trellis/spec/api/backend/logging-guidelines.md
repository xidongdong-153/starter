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

## 业务事件日志

关键业务分支在 route handler 用 `c.var.logger`（已带 requestId）写结构化事件，命名遵循 `domain.action.result`：

- `users.status.changed`（info）：`actorId`、`targetUserId`、`from`、`to`；`from` 来自 repository 返回结构调整，幂等短路时 `from` 与 `to` 相同。
- `files.upload.succeeded`（info）：`fileId`、`name`、`size`、`mimeType`、`ownerId`。
- `files.upload.failed`：`name`、`size`、`ownerId`；`AppError` 用 warn 并只记 `code`/`message`，未知异常用 error 并带完整 `err`。

原则：预期失败（AppError 4xx）用 warn 且不记堆栈；非预期异常用 error 并带 `err`。事件 payload 不记录请求 body、session token 或密码类字段。

## 日志查询接口

`GET /api/system/logs`（system 模块，需 `SYSTEM_LOGS_READ` 权限，admin 角色自动放行）：

- query：`requestId`（链路精确过滤，结果按 time 正序）、`level`（info/warn/error）、`query`（行 JSON 子串匹配）、`limit`（默认 100 最大 500）、`before`（time 游标，倒序分页）。
- 只读 `LOGS_DIR` 下 `app*` 文件（pino-roll 按天+序号命名，如 `app.2026-08-12.1.log`），按文件名倒序、文件内行倒序读取；JSON 解析失败的行跳过；收集满 limit 即停止。
- `LOGS_DIR` 未配置时返回 400 `COMMON.INVALID_REQUEST`；接口只读，不影响日志写入。
- 实现位于 `modules/system/system.service.ts`（`createSystemService(logsDir)`），跨层类型在 contracts：`SystemLogsQuery`、`SystemLogEntry`、`SystemLogsResponse`。
