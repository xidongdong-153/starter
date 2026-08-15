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
```

用户接口：

```text
GET  /api/ai/models
GET  /api/ai/preferences
PUT  /api/ai/preferences
POST /api/ai/test
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

配置或凭据变化必须递增 `config_revision`、设置 `needs_check` 并停用 Provider。只有检查成功且检查时的 revision 仍等于当前 revision，Provider 才能启用。OAuth token refresh 只通过 `row_version` CAS 更新凭据，不改变 `config_revision`。

数据库已保存的 credential 会遮蔽环境认证。解密失败、credential 类型错误或 refresh 失败时不得静默改用环境变量；管理员必须先清除已保存凭据。

## 5. 正常、基础与错误用例

- 正常：管理员保存凭据，认证检查成功，启用 Provider，把目录模型加入白名单并设置全局默认；用户随后能查看和调用该模型。
- 基础：没有配置任何 Provider 时，管理员仍能查看内置模型目录；用户模型列表为空，模型测试返回 `AI.NO_AVAILABLE_MODEL`。
- 错误：用户显式提交未进白名单的模型时返回 `AI.MODEL_NOT_ALLOWED`，不能切换到其他默认模型，也不能泄漏该模型是否存在于管理员目录。
- 并发：OAuth refresh 与管理员替换凭据同时发生时，旧 refresh callback 的 CAS 必须失败，不能覆盖新凭据。
- 取消：Admin 主动停止流式请求时保留原始 `AbortError`，界面显示已停止状态，不显示“API 服务连不上”。

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
- `apps/api/src/test/ai.smoke.test.ts`：权限、Provider 状态机、白名单、默认解析、SSE 两阶段错误和敏感信息过滤。
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
