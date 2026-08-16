# AI Provider 与模型调用规范

## 1. 适用范围

以下改动需要先读本规范：

- 修改 `apps/api/src/modules/ai/` 的 Provider、模型白名单、默认模型、用户偏好或模型测试接口。
- 修改 `apps/api/src/infra/ai/` 的 `pi-ai` 适配、凭据加密、CredentialStore、ModelsStore 或 Gateway。
- 修改 AI 数据表、`AI_CREDENTIAL_ENCRYPTION_KEY`、`AI_REQUEST_TIMEOUT_MS` 或 Admin 的 SSE 客户端。

`@earendil-works/pi-ai` 只能在 `apps/api/src/infra/ai/` 中导入。`packages/contracts`、业务模块、数据库 schema、Admin 和 Web 只使用项目自己的 DTO、错误码和 stream event。

## 2. 接口与存储签名

管理员接口：

```text
GET    /api/ai/admin/providers
PUT    /api/ai/admin/providers/{providerId}/config
DELETE /api/ai/admin/providers/{providerId}/credential
POST   /api/ai/admin/providers/{providerId}/check
PUT    /api/ai/admin/providers/{providerId}/state
POST   /api/ai/admin/providers/{providerId}/refresh
GET    /api/ai/admin/models
PUT    /api/ai/admin/models
PUT    /api/ai/admin/default-model
GET    /api/ai/usage/calls
GET    /api/ai/usage/calls/{callId}
```

用户接口：

```text
GET    /api/ai/models
GET    /api/ai/preferences
PUT    /api/ai/preferences
POST   /api/ai/test
POST   /api/ai/conversations
GET    /api/ai/conversations?page=1&pageSize=20
GET    /api/ai/conversations/{conversationId}
DELETE /api/ai/conversations/{conversationId}
POST   /api/ai/conversations/{conversationId}/messages
POST   /api/ai/conversations/{conversationId}/retry
POST   /api/ai/conversations/{conversationId}/generations/{generationId}/stop
```

运维命令：

```bash
pnpm --filter @starter/api ai:auth -- <providerId>
pnpm --filter @starter/api ai:auth -- <providerId> --logout
```

数据库表：

- `ai_provider_configs`：每个 `provider_id` 只有一行；保存启用状态、加密 payload、`row_version`、`config_revision` 和认证检查状态。
- `ai_model_catalogs`：按 Provider 保存完整模型缓存以及 `checked_at`、`last_modified`、`etag`。
- `ai_enabled_models`：以 `(provider_id, model_id)` 为复合主键保存管理员白名单。
- `ai_settings`：保存全局默认模型，Provider 与 model 两列必须同时为空或同时有值。
- `user_ai_preferences`：以 `user_id` 为主键保存个人默认模型，用户删除时级联删除。
- `ai_conversations`：保存 owner、标题、状态、active generation 和最近模型；列表按 `(owner_id, updated_at, id)` 稳定排序。
- `ai_conversation_messages`：按 `(conversation_id, sequence)` 唯一保存项目文本和脱敏 tool activity；不保存 SDK message、完整 arguments/result。
- `ai_generations`：一次用户发送或 retry 一条记录；retry 复用 `user_message_id`，通过 `retry_of_generation_id` 关联来源。
- `ai_model_calls`：每次 Gateway Provider 请求一条记录；保存安全终态、effective timeout、nullable usage/cost，不保存 prompt、response 或原始错误。
- `ai_tool_executions`：每次工具执行一条记录；只保存工具名、安全状态、effective timeout 和项目错误码，不保存 arguments/result。

Gateway 内部签名：

```ts
interface AiGatewayInput {
  model: AiModelRef
  systemPrompt?: string
  messages: AiModelMessage[]
  tools?: AiModelToolDefinition[]
  sessionId?: string
  turnIndex: number
  timeoutMs?: number
  signal?: AbortSignal
}

type AiGatewayEvent =
  | AiTextDeltaEvent
  | AiToolCallCompletedEvent
  | AiCompletedEvent
```

`AbortSignal` 和 Zod 工具 schema 只存在于 API infra 内部，不进入 `packages/contracts` 或持久化 DTO。

## 3. 数据与环境契约

模型引用统一使用：

```ts
type AiModelRef = {
  providerId: string
  modelId: string
}
```

Provider 配置请求使用 `{ apiKey?: string, settings: Record<string, string> }`。`apiKey` 最长 16384 字符；settings 最多 24 项，键由 Provider registry 定义，单值最长 1000 字符。

白名单替换请求使用 `{ models: AiModelRef[] }`，最多 1000 项且不能重复。默认模型和用户偏好使用 `{ model: AiModelRef | null }`。

模型测试请求使用 `{ model?: AiModelRef, prompt: string }`，prompt 去除首尾空白后为 1 到 8000 字符。显式传入的模型无效时直接拒绝；只有未传 `model` 时，才按个人默认、全局默认的顺序选择。

`POST /api/ai/test` 在响应头发出前返回统一 JSON failure envelope。开始流式响应后只发送以下 SSE data：

```ts
type AiTestStreamEvent =
  | { type: 'start'; requestId: string; model: AiModelRef }
  | { type: 'text_delta'; text: string }
  | { type: 'done'; stopReason: 'stop' | 'length' | 'tool_use'; usage?: TokenUsage }
  | { type: 'error'; code: ApiErrorCode; message: string; retryable: boolean; requestId: string }
```

Gateway 使用项目自己的 user、assistant 和 tool result 消息。公开内容只支持文本和脱敏工具活动；SDK `thinking`、partial message、Provider payload、原始错误和 SDK cost 对象必须在 infra 内丢弃。

`text_delta` 保留 SDK 到达顺序，并用 `turnIndex/contentIndex/blockId` 标识所属 block。`toolcall_end` 只进入缓存；仅当成功 `done` 的 stop reason 为 `tool_use`，且 final assistant message 中的调用 ID、名称和参数与缓存一致时，才按 final block 顺序发送 `tool_call_completed`。参数保持 `unknown`，由工具执行层在调用 handler 前执行 Zod schema 和权限校验。

成功 `completed` 携带项目 assistant message、规范化 stop reason、nullable usage/cost。usage 缺失字段使用 `null`，真实的 `0` 必须保留；cost 只有在 USD 估算字段完整时存在，否则整体为 `null`。

会话发送请求使用 `{ text, model? }`，retry 使用 `{ generationId, model? }`。会话详情只返回公开 message DTO；所有 repository 读取、更新、删除和 generation 查询都带 `owner_id`，他人资源统一返回 404。

发送和 retry 在 transaction 内用 `active_generation_id IS NULL` 做 CAS。retry 只允许会话最新的 `failed | aborted | interrupted` generation，复用原 user message，不重复插入 user。普通后续发送保留 aborted partial assistant；retry context 排除同一 user message retry 链中的失败、中止 assistant。

会话 Context 固定最多 50 条项目消息和 100000 个文本字符，不截断、不摘要。超限必须发生在新消息落库前。会话 SSE 绕过普通 5 秒 API timeout，使用 AI deadline 和 AbortSignal first-cause；stop 返回 202 后原 SSE 继续等待唯一 error/completed 终态。

进程启动时把遗留 generating/streaming 记录恢复为 interrupted。终态 transaction 同时更新 assistant、generation、conversation，并且只在 `active_generation_id = 当前 generation` 时清空 active 状态。

模型测试和会话通过同一个 invocation runner 写入 `ai_model_calls`。输入或模型校验在 runner 前失败时不创建记录；Gateway `tool_use` 是成功模型调用，工具失败由 `ai_tool_executions` 单独记录。begin/finalize 审计失败只能记录 operation、requestId 和审计 ID，不能改变模型响应，也不能记录原始异常。

模型调用保存实际传给 Gateway 的 timeout。工具调用保存 `min(tool.timeoutMs, generationRemainingMs)`；未知工具使用 5000ms 再与 generation remaining 比较。启动恢复只处理 `started_at + timeout_ms + 5000ms` 已过期的 running 记录，刚创建的 running 保持不变。终态更新必须带 `status = running` 条件，重复 finalize 不得覆盖第一终态。

用量读取接口要求 `ai:usage:read`，按 `(started_at, id)` 倒序稳定分页，支持 user、Provider、model、result、request ID 和时间范围精确筛选。presenter 只返回 contracts 白名单字段。

工具执行循环由 `AiToolOrchestrator` 驱动：每轮通过 `AiInvocationRunner` 发起 Provider 请求，成功 completed/tool_use 后按 registry 名称、Zod schema、permission 顺序校验，再并行执行同轮合法工具并保持模型 call 顺序回填 tool result；error、deferred、aborted 或结构与缓存不一致时都不执行 handler。生产 runtime 默认注入空 registry，业务工具不注册，测试通过 `RuntimeDeps.aiTools` 注入。

固定预算：最多 4 个 tool round（即最多 5 次 Provider 请求）、每轮最多 8 个调用、generation 总时限 120 秒、工具自身 timeout 100 到 30000 毫秒。每次 Provider 请求前检查 50 条消息/100000 字符总预算；arguments 和 model-facing result 各最多 16000 字符，超限 arguments 以 `{ error: "arguments_too_large" }` sentinel 回填，safeSummary 最多 1000 字符。单工具 timeout、用户取消和总时限到达会停止循环；unknown/invalid/forbidden/普通失败生成安全 tool result 后继续。每个未超量 call 在校验前 best-effort begin tool audit，所有已 begin 记录都必须 finalize，不能遗留 running。

安全边界：tool arguments、model-facing result 和 safeSummary 只存在于当前 generation 内存与 SSE 实时事件；SQLite 只保存脱敏 activity（toolCallId、name、status、errorCode）和执行审计元数据。handler 只接收 user ID、request ID、AbortSignal 和已校验输入；日志字段固定为 event、requestId、toolCallId、toolName、status、errorCode。

API 环境变量：

- `AI_CREDENTIAL_ENCRYPTION_KEY`：可选的 32 字节 base64 密钥。未配置时 API 可以启动，但持久凭据读写和 OAuth 登录返回 `AI.CREDENTIAL_KEY_UNAVAILABLE`。
- `AI_REQUEST_TIMEOUT_MS`：模型测试超时，范围为 1000 到 300000 毫秒，默认 60000。

API Key、OAuth token、云凭据、prompt、response、主机路径和原始上游错误不能进入客户端响应或日志。数据库凭据使用 AES-256-GCM，IV 每次随机生成 12 字节。

## 4. 校验与错误矩阵

| 条件 | 结果 |
| --- | --- |
| Provider ID 不在 registry | `AI.PROVIDER_NOT_FOUND` |
| 配置字段、认证模式或 Provider 参数无效 | `AI.CONFIG_INVALID` |
| 缺少凭据加密密钥 | `AI.CREDENTIAL_KEY_UNAVAILABLE` |
| CredentialStore CAS 发现版本已变化 | `AI.CREDENTIAL_CONFLICT` |
| Provider 未配置或认证检查失败 | `AI.PROVIDER_NOT_CONFIGURED` 或 `AI.PROVIDER_AUTH_FAILED` |
| Provider 未启用 | `AI.PROVIDER_DISABLED` |
| 管理员引用目录中不存在的模型 | `AI.MODEL_NOT_FOUND` |
| 用户引用未知、停用或未进白名单的模型 | `AI.MODEL_NOT_ALLOWED` |
| 未指定模型且个人、全局默认都不可用 | `AI.NO_AVAILABLE_MODEL` |
| 动态模型目录刷新失败 | `AI.CATALOG_REFRESH_FAILED` |
| 上游失败、超时或主动取消 | `AI.UPSTREAM_ERROR`、`AI.UPSTREAM_TIMEOUT` 或 `AI.REQUEST_ABORTED` |
| SDK error/deferred 终态 | Gateway 抛出安全 `AiGatewayError`，保留已知 usage/cost，不保留原始 message/error |
| 调用方 abort 与 timeout 先后触发 | 按 first-cause 分类；先 abort 为 `AI.REQUEST_ABORTED`，先 timeout 为 `AI.UPSTREAM_TIMEOUT` |
| `toolcall_end` 后出现 error、aborted 或 deferred | 不发送 `tool_call_completed`，不进入工具执行层 |
| final tool call 与已缓存调用不一致 | 按上游失败处理，不执行工具 |
| 会话不属于当前用户 | 404 `COMMON.NOT_FOUND`，不能泄漏资源是否存在 |
| 会话已有 active generation | 409 `AI.GENERATION_ACTIVE`，不新增 message/generation |
| retry 来源不是最新失败、中止或 interrupted generation | 409 `AI.RETRY_NOT_ALLOWED`，不新增 user message |
| 会话 Context 超过 50 条或 100000 字符 | 413 `AI.CONTEXT_LIMIT`，会话内容保持不变 |
| stop 或客户端断开先于 done | `AI.REQUEST_ABORTED`，保存 partial assistant；排队的 done 不能覆盖为 succeeded |
| Provider timeout/auth/upstream | SSE error 终态，assistant/generation=`failed`，保留安全 partial |
| 未注册工具 | `AI.TOOL_NOT_FOUND`，tool execution=`not_found`，回填后继续 |
| 工具参数 schema 校验失败 | `AI.TOOL_INVALID_ARGUMENTS`，tool execution=`invalid_arguments`，回填后继续 |
| 工具权限不足 | `AI.TOOL_FORBIDDEN`，tool execution=`forbidden`，回填后继续 |
| handler 普通失败 | `AI.TOOL_FAILED`，tool execution=`failed`，回填后继续 |
| 单工具 timeout | `AI.TOOL_TIMED_OUT`，终止 generation，触发者=`timed_out`、兄弟=`cancelled` |
| 用户/父 signal 取消 | `AI.REQUEST_ABORTED`，tool execution=`cancelled`，终止 generation |
| 单轮调用数超 8 | `AI.GENERATION_TOOL_CALL_LIMIT`，不执行任何 handler，不伪造 tool execution |
| 工具轮数超 4 | `AI.GENERATION_TOOL_ROUND_LIMIT`，不伪造 tool execution |
| generation 总时限 120 秒到期 | `AI.GENERATION_TOOL_TOTAL_TIMEOUT`，工具按父取消记录 `cancelled` |

配置或凭据变化必须递增 `config_revision`、设置 `needs_check` 并停用 Provider。只有检查成功且检查时的 revision 仍等于当前 revision，Provider 才能启用。OAuth token refresh 只通过 `row_version` CAS 更新凭据，不改变 `config_revision`。

数据库已保存的 credential 会遮蔽环境认证。解密失败、credential 类型错误或 refresh 失败时不得静默改用环境变量；管理员必须先清除已保存凭据。

## 5. 正常、基础与错误用例

- 正常：管理员保存凭据，认证检查成功，启用 Provider，把目录模型加入白名单并设置全局默认；用户随后能查看和调用该模型。
- 基础：没有配置任何 Provider 时，管理员仍能查看内置模型目录；用户模型列表为空，模型测试返回 `AI.NO_AVAILABLE_MODEL`。
- 错误：用户显式提交未进白名单的模型时返回 `AI.MODEL_NOT_ALLOWED`，不能切换到其他默认模型，也不能泄漏该模型是否存在于管理员目录。
- 并发：OAuth refresh 与管理员替换凭据同时发生时，旧 refresh callback 的 CAS 必须失败，不能覆盖新凭据。
- 取消：Admin 主动停止流式请求时保留原始 `AbortError`，界面显示已停止状态，不显示“API 服务连不上”。
- 工具调用：Gateway 收到完整 `toolcall_end` 后仍等待成功 `done`；结构一致后才交给后续 orchestrator，参数 schema 校验不能提前放到 SDK partial 事件。
- smoke 诊断：`pnpm --filter @starter/api ai:provider-smoke` 复用正式 runtime/Gateway，但绕过 `AiInvocationRunner`，不写 `ai_model_calls`/`ai_tool_executions`；输出只含事件计数、provider/model、stop reason、usage、duration 和规范化错误分类，prompt/response/secret 永不输出。
- 错误终态：timeout 或 abort 已经收到部分 usage 时保留安全 token/cost；完全未知时写 `null`，不能伪造为 0。
- 会话并发：同一会话并发发送只有一个 CAS 成功，失败请求不产生孤儿 user/assistant/generation。
- 会话停止：stop 接受后保留原 SSE 等待终态；停止请求失败时客户端不能自行标记 aborted。
- 会话恢复：进程重启后遗留 generation 变为 interrupted，可以按最新失败 generation retry。

## 6. 必须执行的测试

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

断言重点：

- `apps/api/src/test/ai-stores.test.ts`：AES-GCM、CredentialStore 串行/CAS、ModelsStore 完整缓存。
- `apps/api/src/test/ai-auth.test.ts`：OAuth 支持边界、登出不会误删 API Key、stored credential 不回退到 ambient auth。
- `apps/api/src/test/ai.smoke.test.ts`：权限、Provider 状态机、白名单、默认解析、SSE 两阶段错误和敏感信息过滤；真实 route 响应逐帧通过 `aiTestStreamEventSchema`，并断言事件数量、顺序和终态字段。
- `apps/api/src/infra/ai/ai-gateway.test.ts`：项目消息到 SDK context、thinking 丢弃、tool call 结构一致性、usage/cost、first-cause timeout/abort 和安全错误投影。
- `apps/api/src/test/ai-contracts.test.ts`：公开 assistant block、stream event、nullable usage 和 0 值保持。
- `apps/api/src/test/ai-conversations.smoke.test.ts`：owner 隔离、多轮 Context、CAS、retry user 复用、partial stop/timeout、恢复、上下文上限、模型失效历史读取、cascade 和敏感 marker。
- `apps/api/src/test/ai-usage-audit.test.ts`：stale/fresh running 恢复、0/null 保持、幂等 finalize 和审计写失败隔离。
- `apps/api/src/test/ai-provider-smoke.test.ts`：fake Gateway 的 success/auth/timeout/abort/upstream 分类、provider/model 未找到时请求前失败、prompt/response marker 不泄漏、不写审计表。
- `apps/admin/src/test/ai-usage-audit.test.tsx`：loading/empty/error、字段白名单、筛选入口、分页表格和详情 Drawer。
- `apps/admin/src/test/ai-conversations.test.tsx`：loading/empty/error、首轮 pending、generation 隔离、stop failure、retry 和切换会话取消旧流。
- `apps/admin/src/test/ai-api.test.ts`：`eventsource-parser` 处理任意 chunk 边界并校验每个 event。
- `apps/admin/src/test/ai-query.test.tsx`：Query 缓存失效、主动取消和只读权限。
- `apps/admin/src/test/navigation.test.ts`：普通用户只看到 AI 模型入口，有权限的管理员才看到 Provider 入口。

## 7. 错误与正确写法

错误写法会把第三方类型和隐式回退带入业务层：

```ts
import type { Model } from '@earendil-works/pi-ai'

const model = requestedModel ?? anyAvailableModel
```

正确写法只接受项目契约，并在 Gateway 调用前再次检查当前白名单、Provider 状态和认证状态：

```ts
import type { AiModelRef } from '@starter/contracts'

const model = await aiService.resolveAllowedModel({
  requestedModel,
  userId,
})
```

错误写法会把任意网络 chunk 当成完整 SSE event：

```ts
const event = JSON.parse(decoder.decode(chunk))
```

正确写法使用 `eventsource-parser` 合并 chunk，再对每个 data 执行 `aiTestStreamEventSchema.safeParse()`。

错误写法在 SDK partial 或 `toolcall_end` 时直接调用工具：

```ts
if (event.type === 'toolcall_end') await handler(event.toolCall.arguments)
```

正确写法先缓存完整调用，等待成功 `done` 与 final assistant message 结构一致，再由工具执行层校验 schema 和权限：

```ts
if (event.type === 'toolcall_end') pending.set(event.contentIndex, event.toolCall)
if (event.type === 'done' && event.reason === 'toolUse') emitVerifiedCalls(event.message, pending)
```

错误写法先按裸 conversation/message ID 查询，再在 service 判断 owner，或 stop 202 后立刻中断原 SSE 并自行标记 aborted。

正确写法把 owner 条件下沉到 repository，通过 active generation CAS 和条件终态更新保护并发；Admin 使用 generation token 隔离旧流，并让原 SSE 接收服务端唯一终态。
