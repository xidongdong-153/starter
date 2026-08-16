# Provider Smoke Runner 研究

## 结论

当前仓库还没有真实 Provider smoke runner、smoke 专用环境变量或对应 `pnpm` script。最短的正式调用路径应是：runner 读取 smoke 选择变量，调用 `createRuntime` 创建正式 `AiRuntime` 和 `AiGateway`，完成 Provider/model 目录校验后只消费项目 Gateway 事件。runner 不应导入 Provider SDK，也不应直接调用 `streamSimple`。

建议把真实验证命令做成 API 包的独立 script，例如：

```bash
pnpm --filter @starter/api ai:provider-smoke
```

脚本不加入根目录 `pnpm test`、`pnpm build` 或默认 Turbo 任务。默认测试和构建不读取 smoke 配置，也不访问真实上游。

## 当前实现

### 环境解析

文件：`apps/api/src/shared/env.ts`

`parseEnv()` 当前只解析应用级变量和两个 AI 运行时变量：

- `AI_CREDENTIAL_ENCRYPTION_KEY`：可选的 32 字节 AES-256-GCM 密钥，要求是规范 base64；空字符串按未配置处理。
- `AI_REQUEST_TIMEOUT_MS`：整数，范围 1,000 到 300,000，默认 60,000。

Provider 原生环境变量没有加入 `AppEnv` schema。它们由 `@earendil-works/pi-ai` 在 Node.js 进程环境中自行解析；`createAiRuntime()` 通过 `builtinModels({ credentials, modelsStore })` 创建模型集合。smoke 变量应单独解析，不要把 Provider secret 或 prompt 扩展进通用 `AppEnv`。

现有默认环境文件是 `apps/api/.env.example`，真实本地覆盖文件为 `apps/api/.env.development`。`.env.development` 不提交。当前示例文件只包含应用配置、加密密钥和超时，没有 Provider API key 或 smoke 变量。

### `pnpm` scripts

文件：`apps/api/package.json`

现有命令包括：

```bash
pnpm --filter @starter/api dev
pnpm --filter @starter/api ai:auth -- <providerId> [--logout]
pnpm --filter @starter/api db:migrate
pnpm --filter @starter/api test
```

`ai:auth` 使用：

```json
"ai:auth": "dotenv -e .env.development -- tsx src/scripts/ai-auth.ts"
```

smoke script 可以沿用同一套 dotenv 加载方式：

```json
"ai:provider-smoke": "dotenv -e .env.development -- tsx src/scripts/ai-provider-smoke.ts"
```

调用时通过 shell 环境变量或未提交的 `.env.development` 提供选择值。不要把 API key 放到 positional args、`--api-key=...` 或命令输出中。已有 `ai-auth.test.ts` 明确验证了带 `--api-key=secret` 的参数会被拒绝，且错误输出不能含 secret。

### `ai:auth`

文件：`apps/api/src/scripts/ai-auth.ts`

执行顺序：

1. 解析唯一 positional `providerId` 和可选 `--logout`；未知 option 或多余 positional 参数直接失败。
2. 调用 `parseEnv(input)`。
3. 创建 `AiCrypto`。登录和 logout 前都要求 `AI_CREDENTIAL_ENCRYPTION_KEY` 可用；缺少密钥时不启动 OAuth 交互。
4. 打开 `DATABASE_PATH`，创建 `AiRuntime`，执行 `runtime.ensureReady()`。
5. 从 runtime provider registry 查 Provider，并要求 `supportedAuthModes` 包含 `oauth`。
6. 登录时调用 `runtime.login(providerId, "oauth", interaction)`；logout 时要求数据库中已有 OAuth 凭据，再调用 `runtime.logout()`。
7. 通过 repository `markCredentialChanged()` 将 Provider 置为需要重新检查的状态。

正式命令示例：

```bash
pnpm --filter @starter/api db:migrate
pnpm --filter @starter/api ai:auth -- openai-codex
pnpm --filter @starter/api ai:auth -- openai-codex --logout
```

OAuth 交互由 `AiAuthInteraction` 抽象，终端实现只打印授权 URL、设备码和非敏感提示。测试可注入 interaction，不需要真实浏览器或 OAuth 网络流程。当前自动测试只覆盖命令参数拒绝和缺少加密密钥，不覆盖真实 OAuth。

### `AiRuntime`

文件：`apps/api/src/infra/ai/ai-runtime.ts`

`createAiRuntime(db, crypto)` 负责：

- 用 `AiCredentialStore` 保存和读取加密 API key/OAuth credential。
- 用 `AiModelsStore` 持久化动态模型目录。
- 用 `builtinModels({ credentials, modelsStore })` 创建 pi-ai `Models` 集合。
- 用 `createAiProviderRegistry()` 暴露 Provider 白名单及认证能力。
- `ensureReady()` 只允许模型初始化阶段离线刷新，随后校验数据库中的目录和默认模型。
- `listModels(providerId?)` 返回 registry/catalog 中的模型。
- `listAvailableModels(providerId?)` 读取 credential 后按 Provider 规则过滤可用模型。
- `getProviderRequestEnv(providerId)` 只返回数据库密文解出的非 secret runtime settings，例如 `GOOGLE_CLOUD_PROJECT`、`RADIUS_GATEWAY_URL`；不返回 Provider credential key。
- `checkAuth(providerId, signal)` 调用 `models.getAuth()` 和 credential store，返回 credential type 与规范化 auth source，不返回 token 或 header。
- `refreshModels(providerId, signal)` 强制刷新动态目录；未知 Provider 抛 `provider_not_found`，刷新失败归类为 `catalog`，取消通过 `AbortError` 传出。
- `login/logout()` 统一转调 pi-ai 的认证流程。

Provider registry 当前从 pi-ai `builtinProviders()` 生成。当前测试固定了 40 个文本 Provider，实际 provider/model 选择必须使用 runtime 的 registry/catalog，不应接受任意字符串并直接交给 SDK。

### `AiGateway`

文件：`apps/api/src/infra/ai/ai-gateway.ts`

当前接口是：

```ts
stream({
  model: { providerId, modelId },
  prompt,
  signal,
}): AsyncGenerator<AiGatewayEvent>
```

Gateway 内部负责：

1. 通过 provider/model 复合 ID 查找模型，不存在时抛 `model_not_found`。
2. 合并调用方 signal 与 `AbortSignal.timeout(timeoutMs)`。
3. 调用 `models.streamSimple()`，并传入 `runtime.getProviderRequestEnv(providerId)`、`maxRetries: 0`、`maxTokens: min(model.maxTokens, 2048)`。
4. 只向上层发送 `text_delta` 和安全的 `done` usage/stop reason。
5. 丢弃 SDK 原始 message、Provider payload 和原始错误。

Gateway 当前错误类型：

```text
model_not_found
 timeout
aborted
auth
upstream
```

归类规则：

- timeout signal 已取消，归 `timeout`。
- 调用方 signal 已取消，或 SDK error event 的 reason 是 `aborted`，归 `aborted`。
- `ModelsError.code` 为 `auth` 或 `oauth`，归 `auth`。
- 其他 SDK error event、非 auth `ModelsError` 和普通异常归 `upstream`。
- 流没有 `done` 就结束，归 `upstream`。

当前业务层把它们映射为 `AI_UPSTREAM_TIMEOUT`、`AI_REQUEST_ABORTED`、`AI_PROVIDER_AUTH_FAILED` 和 `AI_UPSTREAM_ERROR`。smoke runner 应使用 Gateway error kind 或业务层稳定错误码输出，不能打印 SDK 的 `message`、`cause` 或响应体。

Gateway message-contract 子任务完成后，runner 应改用新的项目调用 DTO 和多消息 Gateway 输入，但保留同一条边界：runner 只消费项目事件，不接触 pi-ai 类型。

## 建议的 smoke 环境变量

只增加 smoke runner 自己的非 secret 选择变量；Provider 凭据继续使用正式 runtime 支持的来源。

| 变量 | 必需 | 用途 | 安全边界 |
| --- | --- | --- | --- |
| `AI_SMOKE_PROVIDER_ID` | 是 | Provider registry 中的 ID，例如 `openai` | 可打印；调用前校验 |
| `AI_SMOKE_MODEL_ID` | 是 | 该 Provider catalog 中的 model ID | 可打印；调用前校验 |
| `AI_SMOKE_PROMPT` | 是 | 很短的测试 prompt | 不打印、不写日志；建议限制长度 |
| `AI_SMOKE_CHECK_AUTH` | 否 | 调用前执行 `runtime.ai.checkAuth()` | 只打印 auth source/type，不打印 credential |
| `AI_SMOKE_REFRESH_MODELS` | 否 | 对支持动态目录的 Provider 强制刷新后再校验 model | 只打印是否执行和安全结果 |
| `AI_SMOKE_TIMEOUT_MS` | 否 | smoke 调用级超时；缺省沿用 `AI_REQUEST_TIMEOUT_MS` | 只打印数值；仍受同样上下限约束 |

不建议设置通用的 `AI_SMOKE_API_KEY`。API key 应使用 pi-ai 对应的原生环境变量，例如 `OPENAI_API_KEY`，或者先由 Admin 保存到 `ai_provider_configs` 的加密 credential。不同 Provider 的 key 名称和认证方式不一致，runner 不应再建立一套通用 secret 解析规则。

如果为了一次性隔离测试必须从环境注入 API key，仍使用 Provider 原生变量，并将其仅留在进程环境中。runner 不能把 `process.env` 整体传给输出对象，不能将 key 放进异常 message、JSON 结果、临时文件或 Pino context。

`AI_SMOKE_PROMPT` 也属于敏感输入边界。需求要求不保存 prompt/response；runner 的日志和 stdout 只允许包含 Provider、model、事件类型、stop reason、usage、耗时和稳定错误码。不要用 prompt 内容判断测试分支；测试分支应通过 faux Provider 或注入的 Gateway 控制。

## 推荐 runner 流程

```text
读取 smoke 非 secret 变量
    -> parseEnv + 独立 smoke schema
    -> createRuntime(process.env)
    -> runtime.ai.ensureReady()
    -> 校验 provider registry
    -> 可选 checkAuth
    -> 可选 refreshModels（仅支持动态目录时）
    -> 校验 provider/model 复合 ID
    -> runtime.aiGateway.stream(项目调用输入)
    -> 统计安全事件、usage、stop reason、耗时
    -> 只输出安全摘要并按稳定分类返回 exit code
    -> finally 关闭 runtime.database.sqlite
```

当前 Gateway 还是单条 prompt 时，runner 可以传 `AI_SMOKE_PROMPT`；Gateway message-contract 稳定后，用项目自己的 user text message 组装调用输入。两种实现都必须调用 `runtime.aiGateway.stream()`，不能直接从 `runtime.ai.getModelsCollection()` 获取 stream 并绕过 Gateway。

调用前应先做三层校验：

1. `providerId` 在 `runtime.ai.providers` 中。
2. `modelId` 在 `runtime.ai.listModels(providerId)` 中；动态 refresh 成功后重新读取。
3. 若 runner 要验证可用认证，`checkAuth` 返回非 null；若只验证 keyless/环境认证，则以 Gateway 实际请求为准。

建议输出结构类似下面的安全摘要，不输出 prompt、response、credential 或原始 error：

```text
provider=openai model=gpt-5-mini event=start
provider=openai model=gpt-5-mini event=text_delta
provider=openai model=gpt-5-mini event=done stop_reason=stop input_tokens=... output_tokens=... total_tokens=... duration_ms=...
result=success
```

text delta 事件只输出事件类型，不输出 delta 文本。为避免输出过长，事件计数也可以替代逐条 text delta。

建议约定：成功返回 0；参数、Provider/model 不存在、未配置认证或动态目录不可用返回配置/运行失败的非 0；上游认证失败、超时、取消和其他上游失败分别映射稳定分类。缺失可选 OAuth 或动态目录能力时应打印“未配置/不支持，已跳过”的安全说明；只有显式要求该能力验证时才将缺失视为失败。

## 真实 secret 边界

### API key

支持两种正式来源：

1. Admin 配置 API key：`AiRuntime.prepareProviderConfig()` 生成 AES-256-GCM 密文，`AiCredentialStore` 写入 `ai_provider_configs`。数据库只保存密文、IV、auth tag、版本和 `****` 末四位提示；runner 通过正式 runtime 使用，不读取明文。
2. API 主机 ambient env：pi-ai Provider 读取它定义的原生变量。runner 不能枚举、打印或复制这些变量。

`AiCredentialStore` 的规则是：已有 stored credential 时由它拥有 Provider，环境变量不会静默替代；失败的 OAuth refresh 也不会退回环境 key。smoke 结果必须记录实际安全 auth source（若启用 `AI_SMOKE_CHECK_AUTH`），便于确认测试到底使用了存储 credential、环境认证还是 keyless。

### OAuth

OAuth token 只允许通过 `ai:auth` 的正式交互写入加密数据库。runner 不接受 OAuth access/refresh token 环境变量，也不执行登录流程。要验证 OAuth：

```bash
pnpm --filter @starter/api ai:auth -- <providerId>
pnpm --filter @starter/api ai:provider-smoke
```

smoke 可选调用 `runtime.ai.checkAuth()`，确认 provider 的 `supportedAuthModes` 包含 `oauth` 且 auth source/credential type 符合预期，然后继续走 Gateway。缺少 OAuth credential 时应返回明确配置说明，而不是将 token 内容写入错误。

### Provider settings 与动态目录

Provider 的非 secret 配置，例如 Vertex project/location、Azure endpoint、Radius gateway URL，来自加密 payload 中的 `runtimeSettings`，由 `getProviderRequestEnv()` 解出后传给 Gateway。runner 不需要另设一组同名变量，也不能把这些 settings 全部当作“安全可打印”；URL 和 project 仍可能包含内部信息，输出只打印 provider/model。

`refreshModels()` 只在 `AiProviderDefinition.supportsModelRefresh` 为 true 时执行。对于 Radius 等动态目录 Provider，显式启用 `AI_SMOKE_REFRESH_MODELS=true` 后先 refresh，再重新检查指定 model；refresh 返回 `catalog` 或被取消时按稳定错误分类结束。对不支持刷新的静态目录 Provider，应跳过 refresh，不把“无动态目录”误报为网络失败。

## 自动测试替身

当前测试基础设施：

- `apps/api/src/test/helpers.ts` 的 `createTestApp()` 每次创建临时 SQLite、临时文件目录和独立 runtime。
- helper 默认注入 `APP_ENV=test`、固定测试 `BETTER_AUTH_SECRET`、固定 AES key、`AI_REQUEST_TIMEOUT_MS=5000`，migration 后再返回 app/runtime/cleanup。
- `createRuntime()` 的 `RuntimeDeps` 可注入 `ai`、`aiGateway`、`mailer`；其中 `aiGateway` 是 runner 最直接的替身边界。
- `apps/api/src/test/ai.smoke.test.ts` 已有 `fakeGateway`，验证 SSE 层的成功和 timeout 映射，并扫描响应不含 prompt/key。
- `apps/api/src/test/ai-auth.test.ts` 已有命令行参数与缺少加密 key 的脱敏测试。

建议分两层测试：

### runner 单元测试

注入一个记录调用参数的 `AiGateway` fake，不导入 pi-ai。用固定非敏感 marker 控制结果，不把真实 prompt/response 写入日志。覆盖：

- 成功：收到 `text_delta` 和 `done`，输出只含事件类型、usage、stop reason、duration。
- auth：fake gateway 抛 `AiGatewayError("auth")`，返回认证失败稳定分类。
- timeout：抛 `AiGatewayError("timeout")`，返回超时分类。
- cancel：抛 `AiGatewayError("aborted")`，返回取消分类。
- upstream：抛 `AiGatewayError("upstream")`，返回上游失败分类。
- provider/model 未找到：请求未到 fake Gateway，且输出不含 prompt。
- secret scan：把预置 secret、prompt、response 作为测试数据，扫描 stdout、错误输出和捕获 logger；三者都不得出现。
- 调用边界：断言 fake Gateway 被调用，断言不存在任何 SDK stream spy 或直接 Provider API 调用。

### Gateway/Provider 集成替身

`@earendil-works/pi-ai@0.84.1` 自带 `fauxProvider()`、`createModels()`、`fauxAssistantMessage()`、`fauxText()`。它通过队列返回确定性 Assistant message，可提供 text delta、done、stop reason 和估算 usage；`tokensPerSecond` 可控制流速，便于测试取消和超时。

项目约束是 `@earendil-works/pi-ai` 只出现在 `apps/api/src/infra/ai/`。因此 faux Provider 测试应放在 `apps/api/src/infra/ai/` 相关测试，或通过 infra 内部 helper 暴露项目自己的 Gateway 测试替身；contracts、modules、scripts 和 admin 测试不应直接导入该 SDK。

推荐用 faux Provider 验证：

- 成功文本流：脚本响应 `fauxAssistantMessage([fauxText(...)])`，通过正式 `createAiGateway(fauxModels, timeout)`。
- stop reason/usage 映射：使用 faux message 的 stop reason 和生成结果，确认 Gateway 只输出项目事件。
- 取消/超时：使用 `tokensPerSecond` 或延迟脚本让 Gateway 的合并 signal 触发，确认 `aborted` 与 `timeout` 不混淆。

认证失败需要单独的确定性 `Models`/Gateway boundary fake，因为 faux Provider 的主要用途是脚本化成功响应；fake 的 `streamSimple` 可以抛项目测试所需的 `ModelsError("auth", ...)`，再由正式 Gateway 验证 auth 映射。不要向测试输出 `ModelsError.message` 或 cause。

## OAuth 与动态目录的可选验证

建议默认 smoke 只验证已选 provider/model 的文本流，不自动登录、不自动刷新所有 Provider，也不为每次默认调用发起额外目录网络请求。

可选验证策略：

- `AI_SMOKE_CHECK_AUTH=true`：调用一次 `runtime.ai.checkAuth()`，输出 `auth_source` 的规范值和 credential type；没有配置时安全失败并给出配置说明。
- `AI_SMOKE_REFRESH_MODELS=true`：先读取 Provider definition；支持 `refreshModels` 才调用 `runtime.ai.refreshModels()`，成功后重新校验 model；静态目录则记录 skipped。
- OAuth Provider：先由人工执行 `ai:auth`，runner 只检查和使用已存 credential；不在 smoke 中弹交互。
- 动态目录 Provider：使用真实 runtime 的 `AiModelsStore` 写入临时数据库或当前配置数据库，避免 runner 自己维护 catalog；测试环境应使用独立 `DATABASE_PATH`，不要污染开发库。

这两个选项应相互独立，方便区分“认证可用但目录刷新失败”和“目录已存在但请求认证失败”。

## CI 隔离

默认 CI 不提供 `AI_SMOKE_PROVIDER_ID`、`AI_SMOKE_MODEL_ID`、`AI_SMOKE_PROMPT` 或 Provider 原生 secret，因此 `pnpm test`、`pnpm build` 和 `pnpm check` 不应触发真实请求。smoke script 必须是独立 script，不能被 Vitest 默认 glob 或 Turbo `test` 依赖自动发现。

需要执行真实验证时使用手动或受保护的 CI job：

- 仅在显式 workflow dispatch / protected environment 条件满足时运行。
- Provider API key 以 CI secret 注入原生环境变量，不写到 command args、`.env` artifact 或普通日志。
- 需要 OAuth 的 job 不把 access/refresh token 放到环境变量；使用受保护的临时数据库和 `AI_CREDENTIAL_ENCRYPTION_KEY`，或只在本地/受控环境执行。
- 使用独立临时 `DATABASE_PATH`、`FILES_DIR`、`LOGS_DIR`，不要读取或上传 `apps/api/data/app.db`、开发日志和 OAuth 数据库。
- 设置 `LOG_LEVEL=warn`，避免 debug SQL 日志；不使用 `set -x`；不要输出完整 `process.env`、异常对象、Provider headers、request body 或 response body。
- 禁止上传 stdout、stderr、数据库、日志和 core dump 作为普通 artifact；即便失败也只保留脱敏的稳定错误码和耗时摘要。
- 设置单次 timeout 和 job timeout，确保网络挂起时 CI 能终止；smoke runner 的 finally 必须关闭 SQLite。
- 真实 smoke job 不应并行执行同一个 OAuth credential 或同一个动态目录写入目标，避免刷新 token 和目录缓存互相覆盖。

## 已核对文件

- `apps/api/src/shared/env.ts`
- `apps/api/.env.example`
- `apps/api/package.json`
- `apps/api/src/scripts/ai-auth.ts`
- `apps/api/src/infra/ai/ai-runtime.ts`
- `apps/api/src/infra/ai/ai-gateway.ts`
- `apps/api/src/infra/ai/ai-provider-registry.ts`
- `apps/api/src/infra/ai/ai-credential-store.ts`
- `apps/api/src/infra/ai/ai-models-store.ts`
- `apps/api/src/bootstrap/create-runtime.ts`
- `apps/api/src/test/helpers.ts`
- `apps/api/src/test/ai-auth.test.ts`
- `apps/api/src/test/ai-stores.test.ts`
- `apps/api/src/test/ai.smoke.test.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/node_modules/@earendil-works/pi-ai/README.md`
- `apps/api/node_modules/@earendil-works/pi-ai/package.json`
- `.trellis/tasks/08-15-ai-provider-smoke/prd.md`
- `.trellis/tasks/08-15-ai-gateway-message-contract/prd.md`
- `.trellis/tasks/08-15-ai-runtime-application-capabilities/prd.md`
