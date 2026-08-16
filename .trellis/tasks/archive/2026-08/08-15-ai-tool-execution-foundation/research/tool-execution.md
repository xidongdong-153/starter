# Tool calling 执行循环研究

## 结论

Starter 应自行拥有工具 DTO、运行时注册表、授权检查、执行预算和错误分类。`@earendil-works/pi-ai@0.84.1` 只负责把工具定义发送给 Provider，并把模型输出转换为 `ToolCall` 和流事件；它不执行 handler，也不提供完整的多轮工具循环。

第一阶段生产 registry 必须为空。测试通过 `createRuntime` 或工具循环构造函数注入确定性测试工具，不能根据 `APP_ENV` 自动注册测试工具。

`pi-ai` 的 `validateToolCall()` 可以在 `apps/api/src/infra/ai/` 内复用，但不能把它抛出的异常消息直接写入日志、审计、tool result 或客户端响应。参数校验失败消息会包含完整原始参数。

## 已检查的来源

- `pnpm-workspace.yaml`、`pnpm-lock.yaml`：Starter 固定使用 `@earendil-works/pi-ai@0.84.1`。
- `node_modules/.../@earendil-works/pi-ai/dist/types.d.ts`：`Tool`、`ToolCall`、`ToolResultMessage`、`AssistantMessageEvent` 和 `StopReason`。
- `node_modules/.../@earendil-works/pi-ai/dist/utils/validation.js`：`validateToolCall()` 和参数转换实现。
- `node_modules/.../@earendil-works/pi-ai/dist/providers/faux.js`：faux Provider 的响应队列、事件和取消行为。
- `node_modules/.../@earendil-works/pi-ai/README.md`：工具调用、参数校验、错误、取消和 faux Provider 用法。
- `.trellis/spec/api/backend/ai-integration-guidelines.md`：SDK 类型边界和敏感数据规则。
- `.trellis/spec/api/backend/authorization-guidelines.md`：服务端权限查询和 admin 特权语义。
- `.trellis/spec/api/backend/logging-guidelines.md`：请求 logger、结构化事件和脱敏规则。
- `packages/contracts/src/ai.ts`、`packages/contracts/src/authorization.ts`、`packages/contracts/src/common.ts`：现有 AI DTO、权限和错误码。
- `apps/api/src/infra/ai/ai-gateway.ts`、`ai-runtime.ts`：当前 Gateway 和 Models 生命周期。
- `apps/api/src/modules/ai/ai.route.ts`、`ai.service.ts`：当前用户、request ID、SSE 取消和日志路径。
- `apps/api/src/modules/authorization/authorization.guard.ts`、`authorization.repository.ts`：权限检查入口。
- `apps/api/src/infra/log/logger.ts`、`apps/api/src/middleware/request-context.middleware.ts`：logger 和 request ID。

## `pi-ai@0.84.1` 的工具契约

### Tool 与消息

SDK 类型如下：

```ts
interface Tool<TParameters extends TSchema = TSchema> {
  name: string
  description: string
  parameters: TParameters
  constrainedSampling?: false | ConstrainedSamplingConfig
}

interface ToolCall {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, any>
  thoughtSignature?: string
}

interface ToolResultMessage<TDetails = any> {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: (TextContent | ImageContent)[]
  details?: TDetails
  isError: boolean
  timestamp: number
}
```

边界含义：

- `Tool` 只有 Provider 可见定义，没有 handler、权限、超时或审计字段。
- `ToolCall.arguments` 和 `ToolResultMessage.details` 都是宽类型，不能进入业务层或持久化层。
- `Context.tools` 只描述本轮允许模型选择的工具。
- 工具结果必须作为 `role: "toolResult"` 消息追加到上下文，再发起下一次模型调用。
- SDK 不执行工具，也不限制轮数、单轮数量或总时间。

### 流事件

工具相关事件为：

- `toolcall_start`：开始一个工具块。
- `toolcall_delta`：参数 JSON 增量；`partial.content[contentIndex].arguments` 可能缺字段、截断或只有部分数组。
- `toolcall_end`：完整工具调用，但仍未经过项目校验。
- `done`：成功终态，reason 可为 `stop`、`length`、`toolUse` 或 `deferred`。
- `error`：错误终态，reason 只为 `error` 或 `aborted`。

事件可能交错，不能假设同一 content block 的 start/delta/end 连续出现。消费者必须使用 `contentIndex`。工具 handler 只能在 `toolcall_end` 或最终 assistant message 完整后执行，不能根据 `toolcall_delta` 执行。

执行循环不应只依赖 `stopReason === "toolUse"`。应以最终 assistant message 中实际存在的 tool call 为准，并把“`toolUse` 但没有 tool call”视为上游协议错误。

### `validateToolCall()`

`validateToolCall(tools, toolCall)` 执行两步：

1. 使用名称精确查找第一个 Tool，未找到时抛出 `Tool "..." not found`。
2. 克隆参数，执行 TypeBox `Value.Convert()` 和额外 JSON Schema primitive coercion，再编译 schema 校验。

它可能把字符串转换为 number/boolean，也可能把 `null` 转换为 `0`、`false` 或空字符串。项目必须决定是否接受这种宽松转换；如果要求严格输入，应使用项目 Zod schema 先执行严格校验，不能把 SDK coercion 当作唯一安全边界。

校验失败异常会追加：

```text
Received arguments:
<完整 JSON 参数>
```

因此只能读取“校验失败”这个结果，不能复用 `error.message`。建议在 infra 适配层立即转换为项目错误 `invalid_arguments`，丢弃原始消息。

### faux Provider

`fauxProvider()` 适合工具循环自动测试：

- `setResponses()` 替换响应队列，`appendResponses()` 追加。
- 每次模型请求按开始顺序消费一个 response step。
- response step 可以是固定 `AssistantMessage`，也可以是接收 `context`、`options`、`state` 和 `model` 的工厂函数。
- `fauxToolCall()` 创建 tool call，`fauxAssistantMessage(..., { stopReason: "toolUse" })` 创建第一轮工具响应。
- `state.callCount` 可验证模型轮数。
- 队列为空时返回 `stopReason: "error"` 的 assistant message，不会从 stream 函数向外抛出。
- 工具参数会产生 `toolcall_delta`，chunk 大小使用随机值。测试不能断言 delta 数量或边界。
- `tokensPerSecond` 未设置时每个 chunk 走 microtask；设为正数可测试中途取消，但会增加时钟不确定性。
- 并发独立流程应使用不同 faux provider ID 和不同 handle。

## Starter 现有边界

### contracts 与 infra

`.trellis/spec/api/backend/ai-integration-guidelines.md` 规定：

- `@earendil-works/pi-ai` 只能在 `apps/api/src/infra/ai/` 导入。
- contracts、业务模块、数据库 schema、Admin 和 Web 只能使用项目 DTO。
- prompt、response、credential、Provider payload、原始错误和 thinking 不能进入客户端或日志。

兄弟任务 `08-15-ai-gateway-message-contract` 还要求项目工具参数进入业务执行层前保持 `unknown`，并由项目 schema 校验。

当前 `AiGateway` 只接收 `model + prompt + signal`，只转发 `text_delta` 和 `done`。工具执行基础应建立在新 Gateway 多消息契约之上，不直接扩展 `AiTestStreamEvent` 为 SDK event 镜像。

### 权限

现有权限来源是 `packages/contracts/src/authorization.ts` 的封闭 `PermissionKeys`。`createRequirePermission()` 适用于进入 HTTP route 前的固定权限，工具权限发生在模型返回之后，不能只靠 route middleware。

工具执行前应调用服务端权限查询：

```ts
hasPermission(currentUserId, registeredTool.requiredPermission)
```

不能接收客户端提交的 roles 或 permissions。权限应在每次执行前检查，因为一次多轮调用期间角色可能变化。第一阶段没有生产工具，不需要新增业务 permission；权限拒绝测试可给注入工具声明一个现有合法 permission，并注入拒绝结果。

### request ID、取消与日志

- `request-context.middleware.ts` 创建 `requestId` 和请求级 logger。
- AI route 已把浏览器断开和 `stream.onAbort()` 合并到一个 `AbortController`。
- 现有 Gateway 再使用 `AbortSignal.any()` 合并调用信号和服务端 timeout。
- 工具上下文应沿用同一个 `requestId`、`currentUserId` 和父 signal。

日志只记录字段白名单：

```ts
{
  event: 'ai.tool.completed' | 'ai.tool.failed',
  requestId,
  toolCallId,
  toolName,
  status,
  durationMs,
  errorCode?: stableCode,
}
```

禁止记录：

- tool arguments、完整 tool result、model-facing result text。
- `error.message`、stack、HTTP response body、文件路径。
- 从参数或结果生成的任意动态对象。

Pino 现有 redact path 只覆盖常见 secret key，不能防止参数对象使用其他字段名。安全依赖字段白名单，不依赖 redact。

## 建议的项目 DTO

### 可序列化 contracts

建议在 Gateway 消息契约中定义以下项目类型。字段名可在设计阶段调整，但边界应保持：

```ts
type AiToolDefinitionDto = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

type AiToolCallDto = {
  id: string
  name: string
  arguments: unknown
}

type AiModelToolResultStatus =
  | 'succeeded'
  | 'unknown_tool'
  | 'invalid_arguments'
  | 'forbidden'
  | 'failed'
  | 'timed_out'
  | 'aborted'

type AiToolErrorCode =
  | 'AI.TOOL_NOT_FOUND'
  | 'AI.TOOL_INVALID_ARGUMENTS'
  | 'AI.TOOL_FORBIDDEN'
  | 'AI.TOOL_FAILED'
  | 'AI.TOOL_TIMED_OUT'
  | 'AI.TOOL_CANCELLED'

type AiToolResultDto = {
  toolCallId: string
  toolName: string
  status: AiModelToolResultStatus
  isError: boolean
  summary: string | null
  errorCode: AiToolErrorCode | null
}
```

约束建议：

- name 使用稳定小写标识，建议 `^[a-z][a-z0-9_-]{0,63}$`。
- description 有长度上限，不包含运行时凭据或内部路径。
- `arguments` 在 Gateway 输出 DTO 中保持 `unknown`。
- `summary` 是早期研究中的候选字段；当前设计不把它写入持久化或审计。正式 handler 使用 `modelText` 回填模型，`safeSummary` 只在当前 SSE 返回。
- 持久化 tool call 时是否保存 arguments 由会话任务决定；当前父任务明确禁止敏感工具参数进入审计。第一阶段测试工具仍应使用标记 secret 扫描，避免误存。
- contracts 不定义 handler、AbortSignal、Zod schema 或 `pi-ai Tool`。

### API 内部注册项

运行时注册项不是跨层 DTO，可以包含函数：

```ts
interface RegisteredAiTool<TInput> {
  definition: AiToolDefinitionDto
  inputSchema: z.ZodType<TInput>
  timeoutMs: number
  requiredPermission: Permission | null
  execute: (
    context: {
      userId: string
      requestId: string
      signal: AbortSignal
    },
    input: TInput,
  ) => Promise<{
    modelText: string
    safeSummary: string | null
  }>
}
```

规则：

- `definition.inputSchema` 是从项目 Zod schema生成的 JSON Schema，仅供 Gateway 转换成 `pi-ai Tool.parameters`。
- `inputSchema` 是实际执行前的唯一项目校验器。
- `modelText` 必须是 handler 主动生成、允许回填模型的文本，不接受任意对象后统一 `JSON.stringify()`。
- `safeSummary` 必须由 handler 显式生成并限制长度；不能默认截断完整结果；它只进入当前 SSE，不进入日志或审计。
- handler 只收到已校验的 `TInput`。
- handler 不收到数据库、logger 或凭据容器，除非未来生产工具明确注入最小依赖。

如果实现仍调用 `validateToolCall()`，应把它放在 `toPiTool()` 适配层内作为 Provider schema 兼容检查。业务执行授权仍以项目 Zod parse 的结果为准。

## 注册表

建议使用不可变 Map：

```ts
interface AiToolRegistry {
  listDefinitions(): readonly AiToolDefinitionDto[]
  find(name: string): RegisteredAiTool<unknown> | undefined
}

function createAiToolRegistry(
  tools: readonly RegisteredAiTool<unknown>[],
): AiToolRegistry
```

构造时检查：

- name 重复时立即抛错，不能让“第一个匹配”决定实际 handler。
- definition name、description、JSON Schema 和 timeout 范围合法。
- `requiredPermission` 来自 `PermissionKeys`。
- schema 顶层必须是 object；第一阶段不支持 grammar tool、deferred tool 或动态加载工具。

生产装配：

```ts
const toolRegistry = createAiToolRegistry([])
```

测试装配通过依赖注入传入 test registry。不要把测试工具放进默认 registry 后依赖环境判断隐藏，也不要新增 shell、SQL、文件、网络或用户资料工具。

## 执行循环

建议把循环放在 API 服务端的独立 orchestrator 中。Gateway 只处理项目消息和 SDK 转换，registry 只负责定义查询，handler 只处理单次工具执行。

伪代码：

```ts
for (let round = 0; round <= maxToolRounds; round += 1) {
  assertTotalDeadline()
  const assistant = await callGateway(messages, registry.listDefinitions(), totalSignal)
  messages.push(assistant.message)

  const calls = assistant.toolCalls
  if (calls.length === 0) return finalTextResult(assistant)

  if (round === maxToolRounds) throw toolRoundLimitError()
  if (calls.length > maxCallsPerRound) throw toolCallLimitError()

  const results = await executeRound(calls, executionContext)
  if (results.some(isTerminalTimeoutOrAbort)) throw terminalToolError(results)

  messages.push(...results.map(toProjectToolResultMessage))
}
```

每轮顺序：

1. 调用 Gateway，完整消费该轮终态。
2. 持久化或保留完整项目 assistant message，包括 tool calls。
3. 检查 tool call 数量和剩余总时间。
4. 对每个 call 执行查名、参数校验和权限判断。
5. 只有三步都通过才调用 handler。
6. 按原 tool call 顺序追加项目 tool result messages。
7. 再调用模型，直到没有 tool call 或达到限制。

### 并行策略

模型同一轮返回多个 tool call 时，建议并行执行，但保持结果顺序稳定：

- 先完成全组的查名、参数校验和权限检查。
- 对可执行项使用 `Promise.all()` 并行运行。
- 单个普通 handler 失败不取消同轮其他 handler。
- 结果数组按原 tool call 顺序生成，不按完成顺序生成。
- 任一工具超时或父请求取消时，abort 同轮所有仍在运行的 handler，并停止整个循环。
- 超过 `maxCallsPerRound` 时本轮一个 handler 都不执行。

这样既保留 Provider 的并行 tool call 语义，也让测试、消息顺序和审计顺序可重复。

### 轮数和时间预算

配置应由服务端常量或受控环境变量给出，客户端不能提交：

```ts
type AiToolLoopLimits = {
  maxToolRounds: number
  maxCallsPerRound: number
  maxTotalDurationMs: number
}
```

还应使用每个工具自己的 `timeoutMs`。有效工具 deadline 取以下最早值：

- 父请求 signal。
- 整个调用的总 deadline。
- 当前工具的 timeout deadline。

使用 `AbortSignal.any()` 合并信号，并保留独立 signal 引用以判断分类：父 signal -> `aborted`，tool timeout -> `timed_out`，总 deadline -> `total_timeout`。

不能只用 `Promise.race()` 返回超时，因为 handler 可能继续写数据库或调用外部服务。handler 契约必须接收并遵守 `AbortSignal`。对于无法取消的依赖，设计阶段必须明确其副作用和幂等策略后才能注册为生产工具。

模型每轮已有 Provider timeout，但多轮循环仍需总 deadline，否则每轮重新计时会把单次请求放大为 `Provider timeout * rounds`。

## 错误回填

建议区分“可回填给模型的单次调用错误”和“停止整个循环的终态错误”。

| 条件 | 是否执行 handler | 是否回填 tool result | 是否继续模型 |
| --- | --- | --- | --- |
| 未注册工具 | 否 | `unknown_tool` | 是，允许模型改正 |
| 参数无效 | 否 | `invalid_arguments` | 是，允许模型改正 |
| 权限拒绝 | 否 | `forbidden` | 是，但不暴露缺少的角色或内部权限集合 |
| handler 普通失败 | 已执行 | `failed` | 是，允许模型解释或改用其他方案 |
| 工具 timeout | 已执行并 abort | `timed_out` | 否，返回稳定终态错误 |
| 用户取消 | 可能已执行并 abort | `aborted` | 否 |
| 单轮调用数超限 | 否，本轮全部不执行 | 请求级错误 | 否 |
| 轮数超限 | 否，不再发起工具 | 请求级错误 | 否 |
| 总时间超限 | abort 运行中工具 | 请求级错误 | 否 |

model-facing tool result 建议使用固定结构序列化为文本：

```json
{"ok":false,"code":"invalid_arguments","message":"工具参数无效"}
```

禁止包含 Zod issues 的原始 received 值、`validateToolCall()` 异常消息、权限查询细节、stack 或 handler 原始异常。

需要在 `ApiErrorCodes` 增加哪些终态 code，应由 Gateway/tool 设计统一决定。至少要能稳定区分：

- tool timeout。
- tool loop aborted。
- per-round call limit。
- round limit。
- total duration limit。
- internal tool execution failure。

普通 tool result 的 `errorCode` 可以使用独立 `AiToolErrorCode`，不必全部映射成 HTTP API error code。

## 审计接口边界

工具执行循环应向审计模块提交字段白名单事件，不直接提交 registry entry、参数、handler result 或 Error：

```ts
type AiToolExecutionStatus =
  | 'running'
  | 'succeeded'
  | 'not_found'
  | 'invalid_arguments'
  | 'forbidden'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted'

type AiToolAuditRecord = {
  aiCallId: string
  toolCallId: string
  toolName: string
  status: AiToolExecutionStatus
  startedAt: Date
  finishedAt: Date
  durationMs: number
  errorCode: AiToolErrorCode | null
}
```

- 审计输入 DTO 不接收 `safeSummary`。safeSummary 只由工具显式生成、按 schema/长度限制后通过当前 SSE 返回。完整 arguments、modelText 和原始 Error 仍不进入数据库、tool activity、审计 API 或日志。

依照 `08-15-ai-usage-audit` 的要求，审计写失败不能改变已经完成的模型或工具结果。记录器应捕获数据库错误并写结构化服务端错误日志，日志只包含 request ID、toolCallId、toolName 和稳定分类，不包含待写 record 的动态文本。

## 测试方法

### 单元测试矩阵

1. 合法调用：第一轮 faux 返回 tool call，handler 收到已校验参数，第二轮看到 tool result 并返回文本。
2. 未注册工具：handler 计数保持 0，下一轮 context 出现 `unknown_tool` result。
3. 参数错误：handler 计数保持 0；错误结果和日志不包含预置 secret 参数。
4. 权限拒绝：权限 resolver 返回 false，handler 不执行，客户端只看到安全状态。
5. 普通失败：handler 抛出包含 secret 的 Error，下一轮只收到稳定 `failed` 文本。
6. 工具超时：handler 监听 signal；超时后 signal 为 aborted，不再调用模型。
7. 用户取消：测试主动 abort 父 controller；工具和后续模型都停止。
8. 轮数上限：faux 连续返回 tool call；`state.callCount` 等于允许值，之后返回稳定 limit error。
9. 单轮数量上限：一条 assistant message 返回超量 tool calls，所有 handler 计数均为 0。
10. 总时限：多轮每轮未超单工具 timeout，但总 deadline 到期后停止。
11. 并行顺序：两个 handler 反向完成，tool result messages 仍按原 call 顺序追加。
12. 重复名称：registry 构造立即失败。
13. 生产 registry：默认 `createRuntime()` 的 registry 定义数组为空。

### faux Provider 用法

```ts
const faux = fauxProvider({ provider: 'faux-tool-loop' })
const models = createModels()
models.setProvider(faux.provider)

faux.setResponses([
  fauxAssistantMessage(
    fauxToolCall('test_echo', { text: 'hello' }, { id: 'call-1' }),
    { stopReason: 'toolUse' },
  ),
  (context) => {
    // 断言 context 已包含 assistant tool call 和对应 toolResult。
    return fauxAssistantMessage('done')
  },
])
```

断言重点：

- 使用固定 tool call ID，便于关联消息与审计。
- 断言最终 context，不断言 `toolcall_delta` 的 chunk 数量。
- 每个并发测试使用独立 faux provider ID。
- response factory 抛错会被 faux 转成 assistant error，测试要按 Gateway error event 断言，不使用 `rejects` 假设。
- 使用 fake timers 时要同时推进 `AbortSignal.timeout()` 和 handler timer；如果运行时 timer 行为不稳定，注入 clock/deadline factory，而不是在生产代码加入测试分支。

### 敏感信息扫描

每组安全测试预置不同 marker：

```text
TOOL_ARG_SECRET_...
TOOL_RESULT_SECRET_...
TOOL_ERROR_SECRET_...
```

测试结束后扫描：

- SQLite 中持久化 tool activity 和工具审计相关列。
- 公开 `AiToolActivityEvent` 的序列化内容。
- 捕获的结构化 logger 调用参数。

完整 arguments/result marker 不能出现在以上范围。模型最终 assistant 文本和合法会话文本可能复述 model-facing result，不参与该 marker 断言。

## 已固定的设计决定

- tool definition/call/result 字段使用 `design.md` 中的 `AiModel*` 项目类型，公开消息只使用 `AiToolActivity`。
- Zod 到 JSON Schema 再到 `pi-ai Tool.parameters` 的唯一适配函数放在 `apps/api/src/infra/ai/ai-tool-schema.ts`。
- `maxToolRounds` 表示允许出现 tool call 的模型轮数，不包含最后一次纯文本调用。
- 单工具 timeout、用户取消和总时限按 generation 终态处理，不回填模型后继续。
- 中间轮 assistant text 通过 SSE 实时发送，并按 `(turnIndex, contentIndex)` 聚合进公开 assistant 消息。
- 会话不持久化 tool arguments 或 model-facing result，只保存脱敏 `AiToolActivity`。
