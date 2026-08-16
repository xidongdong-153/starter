# AI 会话基础研究

本文记录 `08-15-ai-conversation-foundation` 的实现依据和建议边界。结论基于当前仓库、`@earendil-works/pi-ai@0.84.1` 的发布包与同批 AI 子任务 PRD。本文只描述会话基础，不替代 `ai-gateway-message-contract` 对消息和流事件的最终定义。

## 结论

- 会话历史应按项目自己的会话、消息和生成状态存入 SQLite。不要把 `pi-ai Context` 或 `AssistantMessage` 整体序列化后写库。
- 每次发送前，从数据库按 `owner_id + conversation_id` 读取完整有界历史，转换成 Gateway 的项目消息 DTO，再由 Gateway 转成 `pi-ai Context`。
- SSE 必须保留当前 `/api/ai/test` 的两阶段错误规则：响应头发出前使用 JSON 4xx/5xx；开始流式响应后只发送项目 SSE event，并且每个已开始的 generation 都要落到终态。
- 主动停止、浏览器断开和服务端超时都通过同一个 `AbortController` 进入终止流程。已生成文本写回 assistant 消息，状态标为 `aborted`，不能删除部分内容。
- 所有会话 repository 查询都必须同时带当前用户条件。知道其他用户的 UUID 时也返回 404，不能因为登录或拥有 AI 配置权限而跨用户读取会话。
- 第一阶段应同时设置消息数和字符数硬上限，发送前按“历史 + 新 user 消息”检查。超限直接返回稳定错误，不截断、不自动摘要。
- Admin 的实际聊天页应复用 `apps/admin/src/features/ai/`、`apps/admin/src/api/ai/`、现有模型 query 和 SSE parser，但不应继续把一次性 `/api/ai/test` 状态当作会话状态。

## 当前实现

### API 和 Gateway

当前 AI 模块位于：

- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.repository.ts`
- `apps/api/src/infra/ai/ai-gateway.ts`
- `packages/contracts/src/ai.ts`

`POST /api/ai/test` 已实现以下可复用规则：

1. `requireAuth` 从 Better Auth session 设置 `c.var.currentUserId`。
2. `prepareTest` 在 SSE 响应开始前解析默认模型或校验显式模型。
3. 路由使用 `streamSSE`，监听 `c.req.raw.signal` 和 `stream.onAbort`。
4. 每 15 秒写 heartbeat，响应头设置 `Cache-Control: no-cache` 和 `X-Accel-Buffering: no`。
5. 现有公开事件为 `start`、`text_delta`、`done`、`error`。
6. `AiGatewayError` 已区分 `aborted`、`auth`、`model_not_found`、`timeout`、`upstream`。
7. prompt、response、凭据和原始上游错误没有进入结构化日志。

当前 Gateway 只能接收 `{ model, prompt, signal }`，并在内部临时创建单条 user message。因此它不能直接支持连续会话。依赖任务 `08-15-ai-gateway-message-contract` 已要求把输入扩为 system prompt、多条 user/assistant/tool result 消息、工具、session ID 和取消信号；会话任务应调用该新接口，不要在业务模块直接导入 `pi-ai` 类型。

还有一个必须处理的冲突：`apps/api/src/middleware/timeout.middleware.ts` 对普通 `/api/*` 使用 5 秒 Hono timeout，而 `AI_REQUEST_TIMEOUT_MS` 允许 1 秒到 300 秒，默认 60 秒。长会话 SSE 不能继续受普通 5 秒 timeout 控制；需要为会话 stream route 设置明确例外或专用超时，并由 Gateway 的 abort/timeout 负责终止模型调用。

### 数据库和 migration

数据库使用 SQLite、better-sqlite3 和 Drizzle。模块 schema 由 `apps/api/src/infra/db/schema/index.ts` 汇总；时间列统一为 `integer(..., { mode: 'timestamp_ms' })`；ID 使用 UUIDv7。当前最新 migration 是 `0005_pale_madrox.sql`。

现有 owner 边界可参考 `files.repository.ts`：读取、更新和删除同时使用资源 ID 与 owner ID。授权 permission 只决定是否允许某项动作，不提供跨用户资源访问能力。

Drizzle migration 生成后必须提交 SQL、snapshot 和 `meta/_journal.json`。仓库规范记录了 drizzle-kit 对“新增带 CHECK 的列”可能生成错误 SQLite 重建 SQL；会话状态优先由 contracts Zod、service 和 repository 封闭输入校验，不要为了枚举状态给既有表追加 CHECK。

### Admin

现有入口：

- `apps/admin/src/features/ai/pages/AiSettings.tsx`：模型偏好和一次性测试 playground。
- `apps/admin/src/features/ai/pages/AiProviders.tsx`：Provider 与模型白名单管理。
- `apps/admin/src/features/ai/routes.tsx`：`/settings/ai` 对所有登录用户开放，`/settings/ai/providers` 需要 `ai:config:read`。
- `apps/admin/src/api/ai/ai.api.ts`：使用 `eventsource-parser` 消费 SSE，并逐条执行 `aiTestStreamEventSchema.safeParse`。
- `apps/admin/src/api/ai/ai.query.ts`：模型、偏好和管理员配置的 React Query keys。

现有 `AiSettings` 已有 send、stop、retry、模型选择、部分文本保留和 generation 序号隔离，但状态只在组件内，刷新即丢失。`stopTest` 只 abort 当前 fetch，并递增本地 generation；服务端没有可寻址的 generation，也没有持久化终态。

分页和筛选可直接参考授权审计页：

- contracts 的 query schema 使用 `z.coerce.number()` 解析 `page`、`pageSize`，`pageSize` 最大 100。
- repository 先 count，再按稳定双排序键查询，最后 limit/offset。
- React Query key 包含完整 query 对象。
- 页面覆盖 loading、错误重试、空数据、筛选和 Table pagination。

## `pi-ai` Context Serialization 能力

`@earendil-works/pi-ai@0.84.1` 的 `Context` 是普通可序列化对象：

```ts
interface Context {
  systemPrompt?: string
  messages: Message[]
  tools?: Tool[]
}
```

发布包 README 明确说明可以用 `JSON.stringify` / `JSON.parse` 保存并恢复 Context，恢复后可以换 Provider 或 model 继续调用。SDK 也会把跨 Provider 的 assistant 内容、tool call、tool result、thinking 和 aborted partial message转换为目标 Provider 接受的格式。

这项能力适合放在 Gateway 适配层使用，但不等于项目应该保存 SDK Context：

- `AssistantMessage` 包含 `api`、provider、model、diagnostics、usage、cost、raw stop reason、error message、thinking signature、response ID 和未来可能增加的 SDK 字段。
- `ToolResultMessage.details` 与 `ToolCall.arguments` 可以是任意对象。
- Context 中的图片是 base64，会被完整序列化；本任务明确不支持图片。
- 直接保存 SDK 对象会让数据库格式受 SDK 版本和 Provider 私有字段影响，也会扩大敏感数据面。

因此应保存项目 DTO，并在 `apps/api/src/infra/ai/` 中做双向适配。数据库读出的消息必须先通过项目 schema 校验；Gateway 再创建新的 `pi-ai Context`。不要对数据库 JSON 直接执行类型断言后交给 SDK。

`streamSimple` 会根据 `model.contextWindow` 和 SDK 的 token 估算把 `maxTokens` 压低，内部预留 4096 token；当历史已经过大时，它仍可能把输出上限压到 1，而不是按项目要求返回明确的上下文错误。项目的消息数和字符数检查必须发生在调用 Gateway 之前。SDK 的 `estimateContextTokens` 可以作为 Gateway 内的附加保护，但不能替代第一阶段的确定性字符上限。

SDK 对 abort 的结果是带部分 `content`、usage 和 `stopReason: 'aborted'` 的 assistant message，并允许把它加入后续 Context。项目 Gateway 当前在 error event 上丢弃 SDK partial message，因此 gateway-message-contract 必须让会话层能够取得安全的部分文本和终态 usage，或由会话 route 自己从已经收到的 text delta 累积部分文本。

外部依据：

- npm 发布包：`@earendil-works/pi-ai@0.84.1`
- 仓库：`https://github.com/earendil-works/pi/tree/main/packages/ai`
- README 章节：`Context Serialization`、`Cross-Provider Handoffs`、`Continuing After Abort`
- 发布包类型：`dist/types.d.ts` 中的 `Context`、`Message`、`AssistantMessage`、`ToolResultMessage`

## 建议表结构

表名应保持 AI 模块前缀。字段枚举最终以 gateway-message-contract 的项目 DTO 为准。

### `ai_conversations`

| 字段 | 建议 | 说明 |
| --- | --- | --- |
| `id` | text PK，UUIDv7 | 会话 ID |
| `owner_id` | text not null，FK `user.id` on delete cascade | 所有权边界 |
| `title` | text not null | 第一阶段由用户首条文本截取或固定默认值；不调用模型自动生成 |
| `last_provider_id` | text nullable | 最近一次实际调用的 Provider；历史模型失效后仍保留 |
| `last_model_id` | text nullable | 最近一次实际调用的 model |
| `status` | text not null | 建议 `idle`、`generating`；异常恢复时转回 `idle`，消息保存具体终态 |
| `active_generation_id` | text nullable | 防止同一会话并发生成和旧流覆盖新状态 |
| `created_at` | timestamp_ms not null | 创建时间 |
| `updated_at` | timestamp_ms not null | 列表按最近活动排序 |

索引：

- `(owner_id, updated_at DESC, id DESC)`：用户会话列表与稳定分页。
- 可选 `(owner_id, active_generation_id)`：停止接口查找当前 generation。

`last_provider_id` / `last_model_id` 不应外键到白名单或运行时目录。Provider 停用、模型移出白名单后历史仍要可读。

### `ai_conversation_messages`

| 字段 | 建议 | 说明 |
| --- | --- | --- |
| `id` | text PK，UUIDv7 | 消息 ID |
| `conversation_id` | text not null，FK `ai_conversations.id` on delete cascade | 所属会话 |
| `sequence` | integer not null | 会话内严格递增顺序 |
| `role` | text not null | 第一阶段 user/assistant；工具任务加入项目定义的 tool result 角色 |
| `content_json` | text not null | 只保存项目内容块 DTO；第一阶段仅允许 text block，不保存 SDK message |
| `status` | text not null | 建议 `completed`、`streaming`、`aborted`、`failed`；user 消息直接 completed |
| `provider_id` | text nullable | assistant 实际使用的 Provider |
| `model_id` | text nullable | assistant 实际使用的 model |
| `stop_reason` | text nullable | 项目规范化值，不保存 raw stop reason |
| `error_code` | text nullable | 稳定项目错误码，不保存原始错误和堆栈 |
| `generation_id` | text nullable | 关联本次 SSE，防止旧 stream 写入新 assistant 消息 |
| `created_at` | timestamp_ms not null | 创建时间 |
| `updated_at` | timestamp_ms not null | partial checkpoint 与终态时间 |
| `completed_at` | timestamp_ms nullable | 终态时间 |

约束和索引：

- unique `(conversation_id, sequence)`。
- index `(conversation_id, sequence)`，详情按顺序读取。
- unique 或 index `(conversation_id, generation_id)`，具体取决于工具循环是否允许一次 generation 产生多条 assistant/tool 消息；不要过早做全局唯一。

`content_json` 的写入函数必须按 role 显式投影允许字段，沿用授权审计的安全模式。不能 `JSON.stringify(sdkMessage)`，也不能把带额外字段的结构类型变量直接写入。读取时 presenter 对 JSON 和判别联合做 schema 校验；损坏数据返回 500，不把原始 JSON 交给客户端。

usage/cost 不建议塞进消息表。它们属于 `08-15-ai-usage-audit` 的调用记录；消息通过可空的 call/generation 关联读取安全摘要，避免两份 usage 数据漂移。

### generation 是否独立成表

第一阶段可以只用 `ai_conversations.active_generation_id` 加 assistant 消息状态。若需要跨进程停止、进程崩溃恢复、一次用户发送内的多轮工具调用或严格审计每个 generation，独立 `ai_conversation_generations` 更稳：保存 conversation、owner、assistant message、状态、开始/结束时间和稳定错误码；具体模型调用仍由 usage-audit 表记录。

鉴于工具执行任务会让一次用户发送产生多次模型调用，建议在设计阶段增加 generation 表，不要让“消息”“用户的一次生成”“底层模型调用”共享同一个 ID：

```text
conversation 1 -> n messages
conversation 1 -> n generations
one generation 1 -> n model calls (usage audit)
one generation 1 -> n tool executions
```

## 建议接口

用户会话接口只要求登录，不复用 `ai:config:read`：

```text
POST   /api/ai/conversations
GET    /api/ai/conversations?page=1&pageSize=20
GET    /api/ai/conversations/{conversationId}
DELETE /api/ai/conversations/{conversationId}
POST   /api/ai/conversations/{conversationId}/messages       -> SSE
POST   /api/ai/conversations/{conversationId}/generations/{generationId}/stop
```

建议请求和响应：

- 创建：可选 `{ title? }`，返回会话摘要。标题最大长度需要 contracts 固定；自动标题不在范围内。
- 列表：返回 `{ items, total, page, pageSize }`，按 `updated_at DESC, id DESC`。
- 详情：返回会话元数据和按 sequence 升序的消息 DTO。不要返回 SDK Context、raw JSON 或凭据状态。
- 发送：`{ text, model?: AiModelRef }`。显式 model 按当前白名单校验；不传时按现有用户偏好、全局默认解析。
- 停止：必须在数据库确认 generation 属于当前用户的会话，再 abort 进程内 controller。重复停止已终态 generation 建议幂等返回当前终态。
- 删除：按 `(conversationId, ownerId)` 删除。生成中删除应先 abort，再删除；要在 service 中定义顺序并测试 race。

错误重试需要在设计阶段固定语义。推荐对失败或 aborted assistant 消息提供显式 retry endpoint，重用它前面的 user 消息但创建新的 generation/assistant 消息；不要让客户端重新 POST 同一文本并产生重复 user 消息。若第一阶段不做独立 retry endpoint，UI 的“重试”只能明确表示再次发送一条新 user 消息，验收测试必须按该语义编写。

## SSE 生命周期

### 响应开始前

按以下顺序执行，任何失败都返回统一 JSON failure envelope，不创建 generation：

1. 验证 session。
2. 用 `(conversationId, currentUserId)` 查询会话，不存在或非 owner 都返回 404。
3. 拒绝已有 active generation，避免同一会话并发写入；建议 409 稳定错误码。
4. 解析当前有效模型。历史中保存的旧模型只用于展示，不自动绕过当前白名单。
5. 读取并校验项目消息 DTO。
6. 检查消息数与字符数上限。
7. 在单个 transaction 中创建 user 消息、streaming assistant 占位消息和 generation，并设置 `active_generation_id`。

若 transaction 之后、SSE start 之前写响应失败，仍要把 generation 和 assistant 消息结束为 failed/aborted，不能留下永久 streaming。

### 流式阶段

建议事件由 gateway-message-contract 统一，至少包含：

```text
start -> text_delta* -> done
start -> text_delta* -> error
start -> text_delta* -> aborted
```

`start` 应包含 request ID、conversation ID、generation ID、user message 摘要、assistant message ID 和最终选中的 model。这样客户端可立即把乐观状态替换为服务端 ID。

服务端累积 text delta，并用 generation ID 检查每次状态写入。不要每个 token 都写 SQLite；可以按固定时间或字符阈值 checkpoint partial 文本，终态时强制写最后一版。主动停止和连接断开必须保留已累积文本。

终态 transaction 应同时：

- 更新 assistant `content_json`、status、stop reason、error code、model 和时间。
- 更新 generation 终态。
- 清空匹配当前 generation 的 `active_generation_id`。
- 更新会话最近模型和 `updated_at`。

清空 active generation 时条件必须包含 generation ID，避免旧流的 finally 清掉新流状态。

### 取消和崩溃恢复

进程内可维护 `Map<generationId, AbortController>`，但数据库是真实状态，Map 只负责向正在运行的调用发取消信号。停止接口不能只查 Map；先查 owner 和 generation 状态。

单进程 Map 无法跨实例取消。当前项目是单 Node 进程，可作为第一阶段边界，但文档和测试应说明：多实例部署前需要共享协调机制或把同一 generation 路由到原实例。

服务启动时应把遗留 `generating/streaming` 记录转为可解释的 interrupted/aborted 终态，或在读取时执行明确恢复。否则进程崩溃会永久阻止该会话继续发送。恢复动作不能伪造成功 usage。

## 用户隔离

所有 repository 方法使用 owner 条件：

```text
findOwnedConversation(conversationId, ownerId)
listByOwner(ownerId, query)
deleteOwnedConversation(conversationId, ownerId)
findOwnedGeneration(conversationId, generationId, ownerId)
```

读取消息不能先按 message ID 查再在 service 比 owner；应通过 conversation join/subquery 在同一查询限制 owner。更新 assistant、停止 generation 和删除也采用同样条件。

推荐边界：

- 未登录：401。
- 已登录但资源不存在或属于别人：404 `COMMON.NOT_FOUND`，不泄漏 ID 是否存在。
- 模型当前无效：403 `AI.MODEL_NOT_ALLOWED` 或现有对应稳定码。
- 正在生成时再次发送：409，新增会话专用稳定错误码。
- 上下文超限：413，新增 `AI.CONTEXT_LIMIT`；details 只返回限制类型和数值，不返回消息内容。

Admin 的 route/menu 没有 permission 时也只能隐藏管理入口，不能代替 API owner 条件。平台 admin 默认拥有全部注册 permission，但不应因此读取用户会话；若未来要做会话监管，需要独立需求、permission 和脱敏接口。

## 上下文限制

第一阶段建议在服务端定义两个可测试常量，不做环境变量和动态配置：

- `MAX_CONTEXT_MESSAGES = 50`
- `MAX_CONTEXT_CHARS = 100_000`

数值是实现建议，设计阶段可根据目标模型目录调整一次，但应在 contracts 错误行为和测试中固定。计数范围包含将发送给 Gateway 的所有持久消息和本次新 user 文本；字符数只统计项目 text block，不统计 JSON 结构字符。工具任务加入后，tool call 参数和 tool result 文本也必须计入，具体算法由 gateway-message-contract 固定。

执行规则：

1. 不截掉最早消息。
2. 不按不同 Provider 悄悄改变历史。
3. 不自动摘要。
4. 不把 SDK 的 4 字符/token 估算当成精确 token 数。
5. 超限检查发生在 user 消息落库前，失败后会话内容不变。
6. 即使项目限制通过，Provider 仍可能因真实 tokenization 拒绝；Gateway 把它规范化为稳定上下文错误或上游错误，不返回原始 payload。

## Admin 页面接入点

建议新增实际聊天页 `apps/admin/src/features/ai/pages/AiConversations.tsx`，放在 AI feature 内，不与 Provider 管理混在一个组件。路由应对所有登录用户开放，不设置 `AI_CONFIG_READ`。路径建议使用 `/ai/chat` 或项目设计最终确定的一条一级业务路径；保留 `/settings/ai/providers` 作为受权限保护的管理页。

页面结构：

- 左侧会话列表：创建、选择、删除、分页或首版有限列表。
- 主区域：消息历史、pending/streaming/aborted/failed 状态、模型选择、发送和停止。
- 移动端：会话列表进入 Drawer，主消息区保持单列，390px 不产生页面级横向滚动。

数据归属：

- 会话列表和详情放 React Query，query key 必须包含 owner session 隐含边界、分页和筛选参数。
- 当前输入、移动 Drawer 和当前选中会话可放组件 state；不要把消息历史复制到 Zustand/localStorage。
- SSE 期间的 partial assistant 可以放 query cache 或组件局部 overlay；`done/error/aborted` 后用服务端终态替换。
- 每个 stream 使用 generation ID 防止旧请求覆盖新会话或新 generation。切换会话时不能把 A 的 delta 写入 B。
- 继续复用 `eventsource-parser`、TextDecoder flush、2 MiB buffer 和逐事件 Zod 校验。会话事件需要独立 schema，不能把 `AiTestStreamEvent` 扩成含所有业务状态的万能联合。

现有 `AiSettings.tsx` 可拆出模型 selector、stream 状态处理经验，但不建议直接继续堆会话列表和详情。当前文件已经同时承担偏好、测试输入和输出；会话页新增独立页面更容易覆盖刷新恢复、删除、切换与移动布局。

路由和导航接入需要同时改：

- `apps/admin/src/features/ai/routes.tsx`
- `apps/admin/src/app/router/records.ts`
- `apps/admin/src/app/navigation/navigation.ts` 使用的 route records
- 中英文 i18n 文案
- `apps/admin/src/test/navigation.test.ts`
- 直接 URL 的 auth guard 测试

## 测试风险和建议用例

### API

- 两个用户创建会话后，A 对 B 的 list/detail/delete/send/stop 全部不可见；已知 UUID 也返回 404。
- 连续两轮的 faux Gateway 输入包含第一轮 user 和 assistant，顺序严格一致。
- Provider 停用或模型移出白名单后，详情仍返回旧 model ref；新发送拒绝该显式模型。
- 发送前超消息数、超字符数都不新增 user/assistant/generation 行。
- 同一毫秒创建多条消息仍按 sequence 排序；不能只按 timestamp。
- 同一会话并发两次 send 只有一次进入 Gateway，另一条稳定返回 409。
- start 后正常 done、上游失败、认证失败、timeout、主动 stop、客户端断开都产生 assistant 和 generation 终态。
- abort 后 partial 文本可读，下一次发送的 Context 包含或按契约明确处理该 aborted assistant，旧 finally 不能清除新 generation。
- process-recovery 测试预置 streaming 行，重建 runtime 后会话可以继续发送。
- 删除生成中的会话与 stream finally 并发时不产生外键错误或复活记录。
- migration 测试使用临时 SQLite 并执行真实 migration；检查 cascade、索引和 unique sequence。
- 数据库预置损坏 `content_json` 时 API 返回 500，响应不含原始 JSON。
- 扫描数据库、API 响应和日志，确认凭据、SDK diagnostics、raw error、thinking 和 Provider payload 未被写入。

当前 `createTestApp` 可注入 fake `AiGateway`，但新 Gateway 必须支持可控的 async stream 和 abort，测试不能只返回同步两个 event，否则无法验证 stop 和 race。

### SSE 客户端

沿用 `apps/admin/src/test/ai-api.test.ts` 的 chunk 边界测试，并补：

- UTF-8 字符跨 chunk。
- 一个 chunk 含多个 event、一个 event 跨多个 chunk。
- 缺少 terminal event 时报告流中断，但保留已显示 partial。
- 主动 abort 保留 `AbortError`，UI 显示 stopped/aborted，不显示网络失败。
- 损坏、未知或属于旧 generation 的 event 不进入当前消息状态。
- HTTP 401/403/404/409 在 SSE 头发出前按 JSON failure 处理。

### Admin 状态

- 会话列表和详情 loading、空数据、错误重试。
- 创建、删除、发送和停止的 pending 防重复提交。
- 选中会话后刷新恢复历史。
- A 流式生成时切到 B，A delta 不写入 B；切回 A 后以服务端状态为准。
- stop 后 partial 可见且状态明确，再发送不会被旧流覆盖。
- retry 的产品语义按最终 endpoint 测试，不能只断言按钮存在。
- 模型列表为空、当前模型失效、会话历史使用旧模型三种状态分开显示。
- 桌面与 390px：长 model ID、长单词、代码文本、会话标题、错误码不撑破页面；消息区和 Drawer 不互相遮挡。

### 容易产生假通过的点

- 只断言 response body 包含 `event: done`，没有检查数据库终态。
- 用同步 fake stream 测 stop，AbortController 实际从未影响生成器。
- 只在 route 做 owner 检查，repository 仍能按裸 message ID 更新他人记录。
- sequence 测试只用不同时间戳，无法发现相同毫秒排序错误。
- 客户端只检查 `streaming=false`，没有确认旧 generation delta 被忽略。
- 上下文测试只检查最后一条 prompt，没有检查完整 Gateway 输入及角色顺序。

## 设计决策输入（已在 `design.md` 固定）

以下事项已在设计中固定，实现时按对应规则执行：

1. generation 独立成表，关联多轮 model call 和 tool execution。
2. retry 重试最新失败/中止 generation 的原 user 消息，不新增 user 消息；通过 `user_message_id` 和 retry chain 排除旧失败/中止 assistant。
3. aborted partial assistant 进入普通下一轮 Context；retry 请求排除该 user message 对应 retry chain 的失败/中止 assistant。
4. 标题取首条 user 文本安全截断，不调用模型生成标题。
5. 上下文上限为 50 个项目消息和 100000 个字符；工具 arguments/model-facing result 各 16000 字符，safeSummary 1000 字符。
6. 预检后在 transaction 内重查 owner/model/active 并 CAS 创建 generation；会话 route 绕过普通 5 秒 timeout，使用 AI timeout/abort。
7. 单进程 generation AbortController registry 第一阶段可接受；启动恢复遗留 generation、model call、tool execution，旧 generation 终态清理使用 ID 条件。
