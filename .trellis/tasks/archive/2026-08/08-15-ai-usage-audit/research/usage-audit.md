# AI 用量与调用审计研究

## 结论

当前 AI 调用只有 `/api/ai/test` 一条链路。`ai.route.ts` 在 SSE 完成或失败时写 Pino 日志，没有数据库调用记录；`ai-gateway.ts` 成功时只保留 input/output/total token，丢弃 cache、reasoning 和 cost，错误时连 `pi-ai` 错误终态里的部分 usage 也一起丢失。

实现应放在服务端统一 AI 调用边界，而不是继续在 route 内补日志。每次进入 Gateway 前创建一条 `ai_model_calls`，模型、超时、取消或工具流程结束后通过一次幂等 finalize 写终态。工具执行单独写 `ai_tool_executions`，只保存工具名、状态、耗时和稳定错误分类。两个表都不提供 prompt、response、credential、原始错误、工具参数或工具结果列。

审计读取应新增独立权限 `ai:usage:read`。不能复用 `ai:config:read`、`authorization-audit:read` 或 `system:logs:read`，否则无法单独委派 AI 用量查看权限。

## 当前实现

### Gateway 与 AI route

- `apps/api/src/infra/ai/ai-gateway.ts` 是唯一允许导入 `@earendil-works/pi-ai` 的调用适配层。输入仍是单条 prompt；输出只有 `text_delta` 和 `done`。
- 当前 `done.usage` 只有 `inputTokens`、`outputTokens`、`totalTokens`。没有 cache read/write、reasoning 和 cost。
- `pi-ai` 的 error event 携带终态 `AssistantMessage`，其中可以有部分 usage。当前 Gateway 把 event 转成 `AiGatewayError` 后丢弃这部分数据。
- `apps/api/src/modules/ai/ai.route.ts` 在 `/api/ai/test` 的 SSE callback 内计时，成功写 `ai.test.completed`，失败写 `ai.test.failed`。日志字段只有 Provider、model、request ID、耗时、stop reason、部分 token 或稳定错误码。
- `prepareTest` 在流开始前处理登录用户的默认模型和白名单。未登录、输入无效、没有默认模型、显式模型不允许都发生在实际 Provider 调用之前，不应伪造模型调用记录。
- Provider 认证在迭代 `models.streamSimple()` 时解析。这里的认证失败属于真实模型调用终态，应保存；HTTP session 认证失败不是模型调用。
- `createRuntime` 已集中创建 `AiRuntime` 和 `AiGateway`，并支持测试注入 fake Gateway。新的审计 coordinator 可以在这里装配，但业务层和 contracts 仍不能引用 `pi-ai` 类型。

### 日志

- request context 生成 request ID，并给 `c.var.logger` 自动附加该字段。
- 请求日志只记录 method、path、status、duration 和可选 user ID，不记录 body。
- Drizzle debug 日志只记录 SQL 和参数数量，不记录参数值。
- Pino redact 覆盖常见 password/secret/token/cookie/header 路径，但不覆盖任意 `prompt`、`response`、`arguments` 字段。安全边界不能只依赖 redact；审计和失败日志必须从结构上不接收这些值。
- 全局 error handler 会对未知错误记录完整 `err`。审计写入失败不能直接抛到这个 handler，否则既可能改变客户端响应，也可能把底层错误对象带进日志。

### 数据库与授权

- 数据库是 better-sqlite3 + Drizzle，时间字段使用 `integer(..., { mode: 'timestamp_ms' })`，应用层使用 `Date`。
- 新表应放在 `apps/api/src/modules/ai/ai.schema.ts`，schema 汇总入口已经展开整个 AI schema。
- 授权审计提供了可复用查询模式：动态条件、`COUNT(*)`、offset 分页，以及 `created_at DESC, id DESC` 稳定排序。
- `createRequirePermission` 必须放在 `createRequireAuth` 后，权限事实从 SQLite 查询。`admin` 自动获得所有已注册且未归档 permission。
- 独立 permission 需要同时加入 `PermissionKeys`、migration seed、OpenAPI/route guard 和 Admin route。现有导航会自动隐藏没有 route permission 的页面，并由 route loader 再次跳转 403；API 仍必须独立返回 403。

### Admin

- `AuthorizationAudit.tsx` 已覆盖服务端分页、筛选、loading、空数据、错误重试和稳定 query key。
- `LogViewer.tsx` 已覆盖表格、分页和 Drawer，但它直接展示整条日志 JSON，不能照搬到 AI 审计详情。AI Drawer 必须逐字段展示白名单 DTO。
- AI 页面位于 `apps/admin/src/features/ai/`，适合新增 `/settings/ai/usage`，并在同一 feature 下维护 API、query、route、页面和测试。

## 最小表结构

### `ai_model_calls`

建议一行表示一次实际 Gateway/Provider 调用。工具循环触发第二次模型请求时再建一行；多行可通过同一 request ID 和 session ID 查询。不要把整次 HTTP 请求或整段会话压成一行，否则无法满足“每次模型调用”审计。

| 字段 | 建议类型 | 规则 |
| --- | --- | --- |
| `id` | text PK | UUIDv7，服务端生成，也是工具记录的关联键 |
| `request_id` | text | 当前 request ID；同一请求可有多次模型调用，不能唯一 |
| `user_id` | text | 当前用户 ID；不保存姓名或邮箱。是否加外键需与账号删除保留策略确认，审计历史通常不级联删除 |
| `scenario` | text | 项目稳定值，例如 `model_test`、`conversation`；不接受客户端自由文本 |
| `session_id` | text nullable | 会话任务落地后可关联；无会话的模型测试保持 null |
| `provider_id` | text | 最终实际调用的 Provider |
| `model_id` | text | 最终实际调用的 model |
| `started_at` | timestamp_ms | 创建记录时写入 |
| `finished_at` | timestamp_ms nullable | 终态写入；running 时为 null |
| `duration_ms` | integer nullable | 服务端 monotonic clock 计算并规范化为非负整数 |
| `result` | text | `running` 或终态：`succeeded`、`auth_failed`、`upstream_failed`、`timed_out`、`cancelled`、`interrupted` |
| `stop_reason` | text nullable | 项目归一化值，如 `stop`、`length`、`tool_use`、`error`、`aborted`；早期失败可为 null |
| `error_code` | text nullable | 只保存项目稳定错误码，不保存 message、stack 或 Provider 原始错误 |
| `input_tokens` | integer nullable | SDK usage；0 是有效值，不能用 truthy 判断转 null |
| `output_tokens` | integer nullable | SDK usage |
| `cache_read_tokens` | integer nullable | `pi-ai Usage.cacheRead` |
| `cache_write_tokens` | integer nullable | `pi-ai Usage.cacheWrite` |
| `cache_write_1h_tokens` | integer nullable | `pi-ai Usage.cacheWrite1h`，仅部分 Provider 提供 |
| `reasoning_tokens` | integer nullable | `pi-ai Usage.reasoning`；它是 output 的子集，不能再加进 total |
| `total_tokens` | integer nullable | 直接保存 SDK 的 `totalTokens`，不要重算 |
| `cost_input` | real nullable | SDK cost 分项 |
| `cost_output` | real nullable | SDK cost 分项 |
| `cost_cache_read` | real nullable | SDK cost 分项 |
| `cost_cache_write` | real nullable | SDK cost 分项 |
| `cost_total` | real nullable | SDK `usage.cost.total`，不要在业务层按 token 和目录价格重算 |
| `cost_currency` | text nullable | 当前 `pi-ai` cost 明确为 USD；有 cost 时写 `USD`，无 cost 时与所有 cost 字段一起为 null |

建议索引：

- `(started_at, id)`：默认倒序分页。
- `(user_id, started_at)`：用户筛选。
- `(provider_id, model_id, started_at)`：Provider/model 筛选。
- `(result, started_at)`：结果筛选。
- `(request_id, started_at)`：request ID 精确查询和多轮调用排序。

`session_id` 是否声明外键取决于会话表的最终名称和删除语义。即使加外键也应 `ON DELETE SET NULL`，避免删除用户会话时删除审计历史。`user_id` 不应级联删除；如果法规或产品要求账号删除后匿名化，应另做明确的数据保留任务。

### `ai_tool_executions`

| 字段 | 建议类型 | 规则 |
| --- | --- | --- |
| `id` | text PK | UUIDv7 |
| `ai_call_id` | text FK | 关联发起该工具调用的 `ai_model_calls.id` |
| `tool_name` | text | 只保存 registry 中的稳定名称 |
| `started_at` | timestamp_ms | 执行开始时间 |
| `finished_at` | timestamp_ms nullable | 终态时间 |
| `duration_ms` | integer nullable | 非负整数 |
| `status` | text | `running` 或终态：`succeeded`、`invalid_arguments`、`not_found`、`forbidden`、`timed_out`、`cancelled`、`failed`、`interrupted` |
| `error_code` | text nullable | 工具层稳定安全分类，不保存原始异常 |

不增加 `arguments_json`、`result_json`、`error_message`、`details_json` 或通用 metadata JSON。工具任务需要给客户端的“安全摘要”属于实时项目 DTO；本 PRD 对持久记录只要求工具名称、状态、耗时和安全错误分类。以后确实需要持久化摘要时，应新增封闭 schema 和显式字段，而不是通用 JSON。

建议索引为 `(ai_call_id, started_at, id)` 和 `(status, started_at)`。

## 终态记录策略

1. route/service 完成身份、输入、模型白名单和 Provider 状态校验。没有进入 Gateway 的请求不创建模型调用记录。
2. 进入实际 Gateway 前生成 call ID，并 best-effort 插入 `running` 记录。审计 begin 失败只写结构化错误日志，仍继续模型调用。
3. Gateway 的项目事件必须携带安全终态：归一化 stop reason、稳定错误种类，以及可选 usage/cost。不能让审计层读取 `pi-ai AssistantMessage`。
4. coordinator 使用单个 `finalizeOnce()`。成功、认证失败、上游失败、超时和取消都走该函数；更新条件应包含 `id = ? AND result = 'running'`，避免 abort、catch 和 finally 重复改写终态。
5. 先尝试 finalize，再把终态事件交给 SSE 调用方。finalize 失败必须被吞掉并记录，不能把已经得到的模型 done/error 转成客户端失败。
6. `finally` 发现内存状态仍未结束时写 `interrupted`。进程崩溃无法执行 finally，因此启动时或管理员查询前还要把超过最大调用时限仍为 `running` 的记录恢复为 `interrupted`。阈值必须大于模型超时加工具总预算，不能把正常长调用提前结束。
7. 工具记录采用相同 begin/finalizeOnce 模式。Provider 返回 tool call 时，该 model call 已以 `succeeded`、`stop_reason = tool_use` 结束；后续工具失败只写工具子记录和 generation 终态，不改写已完成的 model call。

本规划已固定：工具循环中的“一次模型调用”按每次 Provider 请求计数，不按一次用户发送计数。若产品以后需要整次用户发送的聚合结果和跨轮总 cost，应另加 operation/run 表，不能复用或改写已经作为 Provider 调用事实的行。

## `pi-ai` usage 与 cost 边界

项目锁定 `@earendil-works/pi-ai@0.84.1`。其 `Usage` 类型包含：

- `input`、`output`、`cacheRead`、`cacheWrite`、可选 `cacheWrite1h`、可选 `reasoning`、`totalTokens`。
- `cost.input`、`cost.output`、`cost.cacheRead`、`cost.cacheWrite`、`cost.total`。
- `reasoning` 已包含在 output 中。

SDK 的 `calculateCost()` 使用模型目录中的每百万 token USD 价格计算 cost；README 也用 `$` 展示总 cost。因此持久化 SDK cost 时币种写 `USD`。这是 SDK 目录计算值，不是 Provider 发票金额，Admin 应显示为“SDK cost”，不能命名为实际账单。

边界规则：

- 只复制 Gateway 安全事件提供的 cost，不在 repository、service、presenter 或 Admin 中调用价格表估算。
- usage 或 cost 缺失时保持 null。`0` 是已提供的有效值，必须用 `value ?? null`，不能用 `value || null`。
- error event 也可能带部分 usage/cost，应保存已提供字段；不能因为结果失败就全部清空。
- `pi-ai AssistantMessage.usage` 在类型上必填，部分 Provider 不上报流式 usage 时仍可能出现初始化的全零对象。0 既可能是真值也可能表示上游没有明细，不能用“全零即缺失”启发式判断。Gateway 契约任务应确认 SDK 是否能可靠区分“上游未提供”；无法区分时如实保存 SDK 给出的 0，并在 DTO 中保持 usage 整体可选，不自行猜测 null。
- 当前 Gateway 契约任务明确禁止把 SDK cost 明细对象直接发给业务层。为满足本任务，需要在 infra 内投影成项目自己的安全 `usage`/`cost` DTO，再由审计 coordinator 消费；SDK 类型仍不能离开 `apps/api/src/infra/ai/`。

## 审计 API、权限与 Admin

### API

建议接口：

```text
GET /api/ai/admin/calls
GET /api/ai/admin/calls/{callId}
```

列表 query：`page`、`pageSize`、`userId`、`providerId`、`modelId`、`result`、`requestId`、`from`、`to`。字段用 contracts Zod 校验；page 默认 1，pageSize 默认 20、最大 100。时间范围按 `started_at` 过滤。Provider、model、result、request ID 和 user ID 都做精确匹配，避免审计接口退化成任意 SQL/日志子串搜索。

默认顺序固定为 `started_at DESC, id DESC`。列表响应返回 `{ items, total, page, pageSize }`。详情接口按 call ID 返回一条 call 和排序后的工具摘要；不存在返回 404。

contracts 分开定义 `AiCallAuditListItem`、`AiCallAuditDetail`、`AiToolExecutionSummary`。presenter 逐字段构造 DTO，不直接 spread 数据库 record。DTO 白名单只包含：标识、用户 ID、场景、会话 ID、Provider/model、时间、耗时、结果、stop reason、稳定错误码、usage、cost 和工具摘要。

### 权限

新增：

```ts
AI_USAGE_READ: 'ai:usage:read'
```

migration 把它注册为独立系统 permission，route 使用 `[requireAuth, requireAiUsageRead]`。它只授权读取调用审计，不授权 Provider 配置、模型白名单、系统日志或授权管理。`admin` 通过现有自动 permission 语义获得它；其他角色可单独委派。

必须分别测试：匿名 401、登录但无权限 403、只持有 `ai:usage:read` 的非 admin 可以读审计但不能管理 AI 配置。

### Admin 页面

建议新增 `apps/admin/src/features/ai/pages/AiUsageAudit.tsx`，route 为 `/settings/ai/usage`，route permission 使用 `AI_USAGE_READ`。这样现有桌面/移动导航、tab 和 loader 会共同隐藏或阻止无权限用户。

表格建议展示：开始时间、用户 ID、场景、Provider/model、结果、耗时、total token、total cost、request ID 和详情按钮。筛选区覆盖需求中的全部字段，提交筛选后回到第一页；分页参数进入 React Query key。

详情 Drawer 按白名单字段分组展示基础元数据、token、cost、时间/耗时、错误码和工具摘要。不要提供原始 JSON 展开，不要复用 `LogViewer` 的整对象 `<pre>`。Drawer 自己覆盖 loading、错误重试、空工具列表和关闭状态；列表覆盖 loading、空数据、错误重试、筛选、清空和分页。

## 审计写入失败

模型调用和审计写入不能放在同一个数据库 transaction 中。模型调用是外部副作用，SQLite transaction 不能覆盖它，也不应跨网络流长期持锁。

begin、finalize、工具 begin、工具 finalize 任一写入失败时：

- 不抛给 SSE/HTTP 调用方，不修改已经产生的模型响应或工具结果。
- 使用当前 request logger 写 `ai.audit.write_failed`。
- 只记录 `operation`、`callId`、`requestId`、可选 user ID 和允许列表中的数据库错误分类/SQLite code。
- 不记录 repository input、SQL 参数、prompt、response、credential、tool arguments、tool result、原始异常 message 或 stack。

建议日志示意：

```ts
logger.error(
  {
    event: 'ai.audit.write_failed',
    operation: 'finalize_call',
    callId,
    errorCategory: 'database_write_failed',
  },
  'AI 调用审计写入失败',
)
```

仅依赖 Pino redact 不够，因为 redact 路径不覆盖任意业务对象。审计组件应接收已经缩窄的参数，logger 也只接受安全投影。

写终态失败会留下 `running` 行，启动恢复负责改为 `interrupted`。begin 失败则没有可恢复的行，这是“审计不可用不能破坏模型响应”的必要取舍；此时结构化错误日志是唯一证据。

## 测试重点与风险

### 服务端

- 使用 fake Gateway 表驱动覆盖文本成功、Provider 认证失败、上游失败、超时、主动取消、工具失败，以及 error event 的部分 usage/cost。
- 断言每个已成功 begin 的调用最终都不为 `running`，并校验 finalizeOnce 不会被 abort/catch/finally 重复覆盖。
- 单独测试启动恢复：刚创建的 running 不变，超过阈值的 running 变成 interrupted。
- usage/cost 覆盖“完整正数”“明确的 0”“完全缺失”“失败时部分数据”。重点防止 `0` 被转成 null、reasoning 被重复计入 total、业务层重新算价格。
- 用同一 `started_at` 的多行验证 `started_at DESC, id DESC` 稳定分页，并覆盖全部精确筛选。
- 权限测试覆盖 401、403、独立 read permission 和 OpenAPI response。
- presenter/response 用哨兵字段验证白名单：即使测试 record 变量额外带 `prompt`、`response`、`credential`、`rawError`、`arguments` 和 `result`，API 也不能返回。
- 用触发器或注入的失败 repository 分别阻断 begin 和 finalize，断言成功 SSE/模型结果不变，并捕获 `ai.audit.write_failed` 安全日志。当前 test 环境关闭 Pino 输出，测试应给 coordinator 注入可观测 logger，或 spy logger 方法；不要依赖真实文件 transport 的异步时序。
- migration 测试需要校验新表、索引、permission seed 和测试临时 SQLite；不能读写 `apps/api/data/app.db`。

### Admin

- route permission 与导航隐藏。
- query key 包含全部分页/筛选参数。
- 列表 loading、空数据、错误重试、筛选清空和分页。
- Drawer 打开、关闭、loading、错误重试、无工具、工具失败摘要，以及页面窄宽度下不出现页面级横向溢出。
- cost 为 null 时显示 `-`，0 显示为 0，币种只来自 DTO。

### 敏感值扫描边界

测试预置四个不同哨兵：secret、prompt、response、tool arguments。完成调用后扫描：

- `ai_model_calls` 和 `ai_tool_executions` 的全部文本列。
- AI 审计列表和详情 API 的序列化响应。
- 捕获到的 `ai.*` 与 `ai.audit.*` 结构化日志。

不要扫描模型生成 SSE 并要求 response 哨兵不存在，因为 SSE 的职责就是把模型回答返回客户端。会话任务也会按需求把 prompt/response 保存到消息表，因此集成测试不能扫描整个会话数据库并要求这些值完全不存在。要验证的是它们不进入审计表、审计读取 API 和审计/调用日志。若验收坚持扫描整个数据库，应使用不创建会话/消息的 `/api/ai/test` fixture；否则验收条件与会话持久化需求互相冲突。

SQLite 原始文件或 WAL 的字节扫描还可能命中已删除页或其他业务表的合法消息。测试应查询实际表列，或在 checkpoint 后只扫描明确的审计存储范围，并在测试名称中写清范围。

### 主要集成风险

- Gateway message contract 是硬依赖。未先补齐错误终态 usage/cost，审计只能得到不完整数据。
- 工具任务必须把 call ID 带入执行上下文，否则工具记录无法可靠关联发起它的模型调用。
- 同一 HTTP request 内可能有多轮模型调用，`request_id` 不能设唯一；Admin request ID 筛选应返回全部轮次。
- `pi-ai` cost 是 SDK 根据模型目录计算的 USD，不等同 Provider 最终账单。不能在 UI 上称为账单或结算金额。
- 审计表没有保留期时会持续增长。当前 PRD 不要求归档/清理，但部署方需要监控 SQLite 文件；不要在本任务擅自增加清理策略。

## 参考文件

- `.trellis/spec/api/backend/ai-integration-guidelines.md`
- `.trellis/spec/api/backend/database-guidelines.md`
- `.trellis/spec/api/backend/authorization-guidelines.md`
- `.trellis/spec/api/backend/logging-guidelines.md`
- `.trellis/tasks/08-15-ai-gateway-message-contract/prd.md`
- `.trellis/tasks/08-15-ai-tool-execution-foundation/prd.md`
- `.trellis/tasks/08-15-ai-conversation-foundation/prd.md`
- `apps/api/src/infra/ai/ai-gateway.ts`
- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/authorization/authorization.repository.ts`
- `apps/api/src/modules/authorization/authorization.presenter.ts`
- `apps/api/src/infra/log/logger.ts`
- `apps/admin/src/features/authorization/pages/AuthorizationAudit.tsx`
- `apps/admin/src/features/system/pages/LogViewer.tsx`
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts`（安装版本 0.84.1）
- `node_modules/@earendil-works/pi-ai/dist/models.js`（`calculateCost`）
