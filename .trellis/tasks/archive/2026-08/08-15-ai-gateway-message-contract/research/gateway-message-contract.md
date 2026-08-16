# AI Gateway 消息契约研究

## 结论

- 当前实际依赖是 `@earendil-works/pi-ai@0.84.1`，不是 `@mariozechner/pi-ai`。依赖声明位于 `apps/api/package.json`，版本由 `pnpm-workspace.yaml` 的 catalog 固定。
- 当前 Gateway 只接受单个 `prompt`，在 `apps/api/src/infra/ai/ai-gateway.ts` 内部拼出一条 SDK `user` 消息并调用 `models.streamSimple()`。`systemPrompt`、多轮消息、工具和 `sessionId` 还没有项目 DTO。
- SDK 类型应继续封装在 `apps/api/src/infra/ai/`。`packages/contracts` 和 `apps/api/src/modules/ai/` 只应引用项目自己的消息、调用输入、流事件和稳定错误类型。
- `pi-ai` 的 stream 错误通常不是通过 `throw` 传出，而是通过 `AssistantMessageEvent` 的 `error` 终态事件传出；Gateway 必须消费并丢弃 SDK 原始 `AssistantMessage` 和 `errorMessage`，只输出项目错误分类。
- 旧 `POST /api/ai/test` 可以保留为模块层适配器：旧 `prompt` 转成一条项目 user 消息，旧 SSE 仍只发送 `start`、`text_delta`、`done`、`error`。

## 已检查的代码

- `apps/api/src/infra/ai/ai-gateway.ts`
- `apps/api/src/infra/ai/ai-runtime.ts`
- `apps/api/src/infra/ai/index.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/modules/ai/ai.openapi.ts`
- `packages/contracts/src/ai.ts`
- `apps/api/src/test/ai.smoke.test.ts`
- `apps/admin/src/api/ai/ai.api.ts`
- `apps/admin/src/test/ai-api.test.ts`
- `.trellis/spec/api/backend/ai-integration-guidelines.md`
- `.trellis/spec/contracts/backend/index.md`
- 本地安装的 `@earendil-works/pi-ai@0.84.1`：`apps/api/node_modules/@earendil-works/pi-ai/dist/types.d.ts`、`models.d.ts`、`providers/faux.d.ts`、`compat.d.ts`、`README.md`

## 当前实现和可复用代码

### Gateway

`apps/api/src/infra/ai/ai-gateway.ts` 已经有三段可复用逻辑：

1. 用 `models.getModel(providerId, modelId)` 做同步模型查找，找不到时返回 `model_not_found`。
2. 用 `AbortSignal.timeout(timeoutMs)` 和 `AbortSignal.any()` 合并超时、调用方取消信号，并把超时优先归类为 `timeout`。
3. 用 `models.streamSimple(model, context, options)` 统一调用 Provider，再把 SDK 的 `text_delta` 和 `done` 映射成项目事件；`ModelsError` 的 `auth`、`oauth` 映射成稳定的 `auth` 错误。

当前实现中的 `AiGatewayEvent` 只有 `text_delta` 和 `done`，错误通过抛出 `AiGatewayError` 处理。当前 `done` 会直接取 `event.message.usage.input/output/totalTokens`，并且无条件创建 usage 对象。

### Service 和 route

- `apps/api/src/modules/ai/ai.service.ts` 的 `prepareTest()` 已经负责显式模型校验、用户默认模型解析和再次确认模型仍可用。新 Gateway 不应复制这些选择规则。
- `prepareTest()` 当前把 `input.prompt` 传给 Gateway；这里适合放旧接口到新调用输入的兼容转换。
- `apps/api/src/modules/ai/ai.route.ts` 在进入 SSE 后负责写 `start`、转发 Gateway 事件、记录完成/失败日志、处理客户端 abort 和 heartbeat。进入 `streamSSE()` 前的错误仍会通过普通 JSON failure response 返回。
- `apps/api/src/infra/ai/index.ts` 是 infra 类型和工厂的唯一导出面，适合继续导出新的项目 Gateway 类型，但不应导出 SDK `Context`、`Message`、`Model` 或 `AssistantMessage`。

### 现有项目 contracts

`packages/contracts/src/ai.ts` 当前只有：

- `AiModelRef`
- `AiTestInput`，即可选 model 加单个 prompt
- `AiTestStreamEvent`，包含 `start`、`text_delta`、`done`、`error`

当前 `AiTestDoneEvent` 的 stop reason 是项目格式 `stop | length | tool_use`，usage 字段是 `inputTokens | outputTokens | totalTokens`。新契约应复用项目字段命名和 `z.discriminatedUnion('type', ...)` 风格，旧 `AiTestStreamEvent` 不应被 SDK 类型替代。

## `pi-ai@0.84.1` 类型边界

### `Models` 和模型查找

`Models` 在 `dist/models.d.ts` 中定义，相关方法是：

- `getModel(provider: string, id: string): Model<Api> | undefined`
- `stream(model, context, options): AssistantMessageEventStream`
- `streamSimple(model, context, options): AssistantMessageEventStream`
- `getAuth()`、`checkAuth()` 等认证方法可能抛出 `ModelsError`

`Model<Api>` 包含 `provider`、`id`、`api`、`input`、`cost`、`contextWindow`、`maxTokens` 和 Provider-specific `compat`。动态查找得到的模型是宽泛的 `Model<Api>`，业务层不应接收它。

### `Context`

SDK `Context` 的结构是：

```ts
interface Context {
  systemPrompt?: string
  messages: Message[]
  tools?: Tool[]
}
```

SDK 没有 `system` role。system 内容必须放在 `systemPrompt`，不能伪造一个 system message。

### `Message`

SDK `Message` 是以下三种消息的联合：

- `UserMessage`: `{ role: 'user', content: string | (TextContent | ImageContent)[], timestamp: number }`
- `AssistantMessage`: SDK 元数据加 `content: (TextContent | ThinkingContent | ToolCall)[]`、`usage`、`stopReason`、`errorMessage?`
- `ToolResultMessage`: `{ role: 'toolResult', toolCallId, toolName, content, isError, timestamp }`，可选 `details`、tool usage 和动态工具字段

第一阶段只支持文本时，项目消息可以把文本内容规范成 `{ type: 'text', text }`，由 infra 转为 SDK 支持的字符串或 `TextContent[]`。项目消息不能直接导出 SDK `Message`。

SDK assistant 内容还可能包含 `thinking`，但当前任务明确不向业务层发送 thinking。Gateway 只消费 `text_delta`、完整工具调用和终态 usage，不把 `partial`、`thinking_*` 或原始 assistant content 转发出去。

### 工具类型

SDK `Tool` 是：

```ts
interface Tool<TParameters extends TSchema = TSchema> {
  name: string
  description: string
  parameters: TSchema
}
```

这里的 `TSchema` 来自 TypeBox，不是 Zod。`packages/contracts` 不能为了暴露 SDK 类型而引入 `@earendil-works/pi-ai`，项目工具定义需要使用可序列化的项目表示，再由 infra 转为 TypeBox schema 或限制为已注册工具引用。

SDK `ToolCall` 是：

```ts
interface ToolCall {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, any>
}
```

虽然 SDK 类型把 arguments 写成 `Record<string, any>`，业务边界应降为 `unknown`。`toolcall_end` 时参数完整，但 SDK 自己也说明它“尚未校验”；真正执行前必须由项目工具 schema 校验。

`ToolResultMessage.content` 是文本/图片内容块数组，第一阶段只生成文本块，并通过 `toolCallId`、`toolName`、`isError` 关联上一次模型工具调用。

### `Usage`、cost 和币种

SDK `Usage` 类型包含：

- `input`、`output`、`cacheRead`、`cacheWrite`
- 可选 `cacheWrite1h`、`reasoning`
- `totalTokens`
- `cost: { input, output, cacheRead, cacheWrite, total }`

`Model.cost` 是模型目录的费率结构，包含同名费率和可选按输入 token 阈值切换的 tiers。类型没有 currency 字段；README 的示例以美元 `$` 打印，模型 cost 类型本身没有明确币种或计价单位字段。

因此审计任务不能仅凭“数字存在”就把币种写成事实。需要在项目 adapter 中明确记录来源语义，例如“pi-ai model catalog cost；当前 SDK 没有 currency 字段”，或者在项目契约中把 cost 设为 null，直到有明确的 SDK/目录币种约定。不能根据 token usage 自行估算价格，也不能把 `Model.cost` 费率对象原样传给业务层。

### Stream event

`AssistantMessageEvent` 的终态和增量事件包括：

- `start`，带 `partial: AssistantMessage`
- `text_start`、`text_delta`、`text_end`
- `thinking_start`、`thinking_delta`、`thinking_end`
- `toolcall_start`、`toolcall_delta`、`toolcall_end`
- `done`，带 `reason` 和完整 `message`
- `error`，带 `reason: 'error' | 'aborted'` 和原始 `error: AssistantMessage`

SDK 文档明确说明不同内容块的事件可能交错，不能假设某个 block 的 start/delta/end 连续出现；若内部需要跟踪增量，必须使用 `contentIndex`。项目 Gateway 只对外发送完整工具调用，因此可忽略 `toolcall_delta`，但不能在收到 delta 时执行工具。

SDK `done.reason` 的类型是 `stop | length | toolUse | deferred`。SDK `StopReason` 还包括 `pending | error | aborted`，后面三者不是成功 `done` 的 reason。项目映射应保持：

- `stop` -> `stop`
- `length` -> `length`
- `toolUse` -> `tool_use`
- `deferred`：当前项目不支持，应归类为稳定的 upstream/unsupported 错误，不能静默当作 `stop`
- `error` / `aborted`：走项目错误终态，不转换成成功完成

### SDK 错误行为

`AssistantMessageEventStream` 的 SDK 文档说明：认证失败、Provider 错误和 abort 通常会产生 `error` 事件，最终结果的 `AssistantMessage.stopReason` 为 `error` 或 `aborted`。`error.error.errorMessage` 可能包含原始 Provider 错误，不能进入 API、数据库或普通业务日志。

当前 Gateway 对 stream 内的 `event.type === 'error'` 会主动抛出 `AiGatewayError`，这与现有 service 的稳定错误映射兼容。新事件契约若要求 Gateway 自己发送 `error` 事件，应避免同时让 route 再发送一条错误事件；建议保留一个明确的终态所有权：要么 Gateway yield 项目错误终态，要么 Gateway 抛出已归一化 `AiGatewayError` 交给 service/route，不能两者都做。

## 事件映射建议

推荐把 SDK 到项目事件的映射集中在 `apps/api/src/infra/ai/ai-gateway.ts`，不要让 service 或 route 读取 SDK event 字段。

| SDK 事件 | 项目 Gateway 事件 | 处理规则 |
| --- | --- | --- |
| `start` | 不对业务层发送，或只作为内部开始标记 | 丢弃 `partial`，不泄露 SDK message |
| `text_delta` | `text_delta` | 只保留 `delta`，重命名为项目字段 `text` 或统一使用 `delta`，全仓库只能选一个 |
| `thinking_*` | 无 | 丢弃 thinking 文本和 partial |
| `toolcall_start` | 无 | 不执行工具 |
| `toolcall_delta` | 无 | 参数不完整，不能进入业务执行层 |
| `toolcall_end` | `tool_call_completed` | 输出 `id`、`name`、`arguments: unknown`；不输出 SDK ToolCall 类型 |
| `done` | `completed` / 旧 `done` | 规范化 stop reason；从 `message.usage` 提取安全 token 摘要，丢弃完整 message |
| `error` | `error` 或归一化抛出的 `AiGatewayError` | 只输出稳定 error kind/code、是否可重试和终态信息；丢弃原始错误、原始 message、Provider payload |

新 Gateway 输入建议至少包含：

```ts
type AiGatewayInput = {
  model: AiModelRef
  systemPrompt?: string
  messages: AiMessage[]
  tools?: AiToolDefinition[]
  sessionId?: string
  signal?: AbortSignal
}
```

其中 `AiMessage`、内容块、工具定义、工具调用和工具结果都由 `packages/contracts` 定义；SDK `Context` 只在 infra 内通过 mapper 创建。`sessionId` 进入 SDK `streamSimple` options 的 `sessionId`，不是 message 字段。

Usage 项目类型至少应区分 `inputTokens`、`outputTokens`、`totalTokens`，若要支持审计趋势还应保留 SDK 明确给出的 `cacheRead`、`cacheWrite` 和 `reasoning`，缺失字段用 null 而不是 0。cost 建议使用项目自己的规范化结构，不返回 SDK cost 明细对象；币种必须有明确来源，没有来源就为 null。

## 旧 `POST /api/ai/test` 兼容方案

现有兼容面由以下文件共同定义：

- 输入和事件 schema：`packages/contracts/src/ai.ts`
- OpenAPI route：`apps/api/src/modules/ai/ai.openapi.ts`
- 请求处理和 SSE：`apps/api/src/modules/ai/ai.route.ts`
- 模型选择、错误映射和 Gateway 调用：`apps/api/src/modules/ai/ai.service.ts`
- Admin 解析器：`apps/admin/src/api/ai/ai.api.ts`
- Admin 兼容测试：`apps/admin/src/test/ai-api.test.ts`

适配步骤：

1. 保留 `AiTestInput` 的 `{ model?, prompt }`，保留 `POST /api/ai/test` 和进入 SSE 前的 JSON failure response。
2. `prepareTest()` 继续调用现有 `requireExplicitModel()` / `selectModelForUser()`，只把 `prompt` 转成新 Gateway input 的一条 user text message；旧调用不提供 system prompt、tools、session ID。
3. Gateway 的 `text_delta` 映射为旧 `AiTestStreamEvent` 的 `text_delta`；Gateway 的成功终态映射为旧 `done`，维持 `stop | length | tool_use` 和当前 token 字段名。
4. route 继续自行发送旧 `start`，因为当前 Gateway 没有 start 项目事件，且旧 start 需要 `requestId` 和已解析的项目 model ref。
5. Gateway 错误继续经过 `service.toStreamError()` 变成 `AI_UPSTREAM_TIMEOUT`、`AI.REQUEST_ABORTED`、`AI.PROVIDER_AUTH_FAILED` 或 `AI_UPSTREAM_ERROR`。不要把 SDK `errorMessage` 放入旧 SSE message。
6. 旧调用不注册工具。若 Provider 在无工具 context 下仍返回工具调用，适配器不能把参数塞进旧响应，应归类为稳定上游/不支持错误，避免旧客户端收到未知 schema。
7. 保留 `streamSSE` heartbeat、客户端 abort、`text/event-stream`、`event: <type>` 和 Admin 的 `eventsource-parser`。Admin 当前只接受 contracts schema 中的事件，未知或损坏事件会被忽略。

这样可以让新 Gateway 使用多消息和工具，而不改变旧客户端的请求字段、SSE 事件名、错误 code 和两阶段错误行为。

## faux Provider 探针结果

使用本地 `@earendil-works/pi-ai@0.84.1` 的 `fauxProvider()` 和 `createModels()` 做了只读探针：

- 输入 context 使用 `systemPrompt`、user、assistant、toolResult 四类项目目标消息，并注册了一个 TypeBox `echo` 工具。
- faux response factory 收到的 roles 是 `['user', 'assistant', 'toolResult']`，system prompt 和工具名保持原值，`options.sessionId` 也保持原值。
- 工具响应事件顺序为 `start`、文本事件、`toolcall_start`、多个 `toolcall_delta`、`toolcall_end`、`done`。`toolcall_end.toolCall.arguments` 是完整对象。
- faux `done.message.usage` 同时包含 token 分类、`totalTokens` 和 cost 对象；faux 默认 cost 为零，不代表真实 Provider 的价格。
- scripted `stopReason: 'error'` 不会让 `for await` 抛异常，而是产生 `error` 事件；该事件携带原始 `errorMessage` 和 partial content，必须由 Gateway 丢弃敏感字段。

可复用的 SDK 测试 API：`fauxProvider()`、`fauxAssistantMessage()`、`fauxText()`、`fauxThinking()`、`fauxToolCall()`。faux Provider 的响应队列按请求开始顺序消费，支持 `tokensPerSecond` 控制事件节奏。

## 测试风险和建议

### 当前覆盖缺口

- `apps/api/src/test/ai.smoke.test.ts` 使用手写 `fakeGateway`，主要验证配置、模型白名单和旧 SSE；它没有验证真实 SDK `Context` 转换，也没有验证 SDK event 到项目 event 的映射。
- 当前没有发现独立的 `ai-gateway` 单元测试。
- Admin 已覆盖 UTF-8 chunk、SSE event 边界、损坏事件忽略、缺少终态和主动取消；这些测试应在旧 SSE 保持兼容时继续通过。

### 新 Gateway 必测项

1. system prompt 转换：`systemPrompt` 独立传入 SDK Context，不进入 messages。
2. user、assistant、toolResult 三种消息的文本内容、timestamp、tool call id/name 和 `isError` 保持 round-trip。
3. 文本增量、完整工具调用、`stop`、`length`、`toolUse` 的事件映射；必须证明 `toolcall_delta` 不会提前执行工具。
4. SDK `thinking_*`、`start.partial`、`done.message`、`error.error` 不会出现在项目事件或日志中。
5. usage 字段存在、缺失、部分 usage 和 abort 时的部分 usage；缺失值必须是 null，不用 0 补齐。
6. faux SDK error event、认证失败、Provider 上游失败、超时和主动取消分别映射到稳定 Gateway error kind/code。
7. timeout 与主动 abort 同时触发时的优先级；当前代码优先检查 timeout signal，需固定并测试该语义。
8. 显式无效模型在业务层被拒绝，未指定模型仍沿用个人默认、全局默认顺序；Gateway mapper 不得引入另一个默认模型回退。
9. 旧 `POST /api/ai/test` 请求和 SSE 响应快照：`start`、文本、`done`、稳定错误 code、无 prompt/response/credential/raw error。
10. TypeBox 工具 schema 与项目序列化工具 DTO 的边界，尤其是参数为 `unknown` 时不能被 `as Record<string, any>` 绕过校验。

### 已由 `design.md` 固定的契约

- 项目 text delta 使用 `text` 字段，SDK `delta` 只在 infra mapper 内转换。
- Gateway 只抛出携带安全 usage/cost 的 `AiGatewayError`；service 生成唯一公开 error event，避免重复终态。
- `start` 由 route/request 层拥有，Gateway 不生成 request ID。
- `pi-ai@0.84.1` 模型目录 cost 采用 USD 估算语义；升级后无法确认时 cost/currency 为 null。
- `deferred` stop reason、Provider response ID 和 SDK diagnostic 不进入第一阶段项目 DTO。
