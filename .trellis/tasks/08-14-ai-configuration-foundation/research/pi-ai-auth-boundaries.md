# `pi-ai` 认证边界与服务端配置限制

## 版本证据

- npm `@earendil-works/pi-ai@0.84.1` 的 `gitHead` 是 `53fa77ccd8a279eb87e92294ef3687b03ff80112`。
- 本地 `/Users/wuwanzhu/Code/pi` 当前 HEAD 是 `9d2ec7ffabe927bfad2214c1cee25b6632a78dcf`，是 npm gitHead 的后继提交，但不是同一个源码快照。
- 两个提交之间 `packages/ai` 有 40 个文件变更，包含 Provider API、OAuth、Bedrock、Mistral 和模型目录相关改动。
- 任务实施时应锁定 npm 发布版本，或明确锁定本地 Git commit；不能把本地 main 的源码行为直接当作 npm `0.84.1` 的契约。

## Provider 注册

`packages/ai/src/providers/all.ts` 的 `builtinProviders()` 当前注册了全部内置 Provider。列表包含普通 API Key Provider、OAuth Provider、云平台凭据 Provider，以及动态目录 Provider：

- 普通或兼容 API：OpenAI、Anthropic、Google、DeepSeek、Mistral、Groq、Cerebras、NVIDIA、Together、Baseten、Fireworks、Hugging Face、Moonshot、MiniMax、Qwen、Z.AI、Xiaomi、OpenCode、OpenRouter、Vercel AI Gateway 等。
- OAuth：Anthropic、OpenAI Codex、GitHub Copilot、OpenRouter、Kimi Coding、xAI；`radius` 同时声明 API Key 和 OAuth。
- 特殊环境凭据：Amazon Bedrock、Google Vertex AI。
- 多字段 API Key：Cloudflare Workers AI、Cloudflare AI Gateway。
- 动态目录：`radius` 的模型列表需要根据凭据和网关配置刷新。
- 图片生成 Provider 是独立的 `ImagesModels` 表面，目前只有 OpenRouter 图片 Provider，不应与聊天模型配置混为一张调用表。

## `CredentialStore` 的硬边界

位置：`packages/ai/src/auth/types.ts`、`packages/ai/src/auth/credential-store.ts`、`packages/ai/src/models.ts`。

- `CredentialStore` 以 `Provider.id` 为键，每个 Provider 只有一个凭据。
- 凭据只有两种规范形态：`api_key` 和 `oauth`。
- `api_key` 可以包含 `key` 和 Provider 专用的 `env` 字段；`oauth` 保存 access、refresh、expires 及额外字段。
- `modify()` 是唯一写入口，负责串行化登录和 OAuth 刷新。callback 可以等待网络，不能简单包在 `better-sqlite3` transaction 中。
- 本任务使用同进程 Provider queue 加短事务 `row_version` compare-and-swap：跨请求串行，跨进程冲突不覆盖新 credential，而是返回可重试错误。第一版不声明分布式互斥。
- callback 返回 `undefined` 表示保留当前 credential；删除必须调用独立 `delete()`。
- `Models.setProvider()` 按 Provider ID 覆盖，Provider ID 在一个 `Models` collection 中必须唯一。
- 因此，多个同类 Provider 配置或多个账号不能直接重复注册内置 Provider。要么限制为每个 Provider 一份全局配置，要么用 `createProvider()` 创建唯一 ID，并复制/重写模型的 `provider` 字段。
- `Models.login()` 是应用层调用的长流程，成功后会自动通过 `CredentialStore.modify()` 保存凭据。
- 固定版本的 `resolveProviderAuth()` 规定：只要存在 stored credential，它就拥有该 Provider；stored credential 类型不匹配、OAuth refresh 失败或解析失败时不会静默回退 ambient auth。切回环境认证必须先清除 stored credential。

## OAuth 对 Web Admin 的影响

位置：`packages/ai/src/auth/types.ts`、`packages/ai/src/auth/oauth/*.ts`、`packages/ai/src/models.ts`。

- `AuthInteraction` 只有 `prompt()` 和 `notify()` 两个应用回调；它不是一个现成的 Web OAuth controller。
- `notify()` 会发出 `auth_url`、`device_code`、`progress` 等事件，Admin 可以把这些事件转成页面状态。
- GitHub Copilot、xAI、Kimi Coding 等流程使用 device code，比较适合“Admin 开始登录 → 页面显示验证码和验证地址 → API 轮询 → 完成”的异步任务。
- Anthropic、OpenAI Codex、OpenRouter 的部分流程会在 API 进程启动 Node 本地 callback server，并同时要求 `manual_code` 输入。源码中有固定或临时 localhost callback 处理。
- 当 API 部署在服务器时，`localhost` 指向 API 主机，不是管理员浏览器；不能直接把 CLI 登录流程原样挂到浏览器按钮上。需要单独设计 OAuth 会话、回调地址、状态校验、取消、超时和结果回传，或只支持手工粘贴重定向 URL/设备码。
- `packages/ai/src/auth/oauth/openai-codex.ts` 明确写明相关 Node `crypto`/`http` 流程只 intended for CLI use；该流程不能假定可直接用于 Vite 浏览器包。

## Bedrock 与 Vertex 的影响

位置：`packages/ai/src/providers/amazon-bedrock.ts`、`packages/ai/src/providers/google-vertex.ts`、`packages/ai/src/env-api-keys.ts`。

- Bedrock 的登录流程可以保存 bearer token 或 `AWS_PROFILE`，也可以要求操作者先配置现有 AWS credential chain。
- Bedrock 的默认解析会检查 API 主机的 `AWS_PROFILE`、访问密钥对、bearer token、ECS task role 和 web identity token。Admin 不能凭一个普通 API Key 表单代表所有这些来源。
- Vertex 支持 Google Cloud API Key、ADC 和服务账号文件路径。ADC 需要 API 主机上的 gcloud 凭据文件、project 和 location；服务账号配置也要求 API 主机能访问给定文件路径。
- Admin 浏览器上传一个本地服务账号文件后，不能直接让 `pi-ai` 使用浏览器本地路径。若要支持上传，项目必须增加服务端密钥文件存储、权限、加密和路径映射，或把 JSON 转换为另一种服务端凭据实现。

## 其他多字段配置

- Cloudflare API Key 还需要 account ID；AI Gateway 还需要 gateway ID。源码使用 `ApiKeyCredential.env` 保存这些 Provider 专用值。
- Azure OpenAI 的 API Key 之外还需要 base URL 或 resource name，并可配置 API version 和 deployment 映射；这些配置来自 Provider 环境值/请求环境，不是单一 key。
- `envApiKeyAuth()` 会把保存的 `credential.env` 传回解析结果，但每个特殊 Provider 是否读取这些字段由它自己的 `ApiKeyAuth.resolve()` 决定，不能在数据库层假设所有环境变量都有效。

## `ModelsStore` 与动态目录

位置：`packages/ai/src/models-store.ts`、`packages/ai/src/models.ts`、`packages/ai/src/providers/radius.ts`。

- `ModelsStoreEntry` 除 `models`、`checkedAt` 外，还允许 `lastModified` 和 `etag`；持久 Store 必须完整 round-trip，不能只保存模型数组。
- `Models.refresh()` 返回 `{ aborted, errors }`，Provider 刷新错误不会直接 reject 整个调用；业务 service 必须检查目标 Provider 的 error map。
- `models.refresh({ allowNetwork: false })` 可以只恢复动态 Provider 的持久 cache。现有 API runtime 是同步创建，设计使用第一个 AI 操作触发的 memoized `ensureReady()`，不改动全局 runtime 为 async。
- 固定版本中 `radius` 是纯动态 catalog Provider；模型刷新成功后才重校验白名单和默认值，失败保留旧 cache。

## 对本任务的直接结论

“支持全部内置 Provider”拆成三层能力，而不是一个 `ProviderConfig` 表单：

1. Provider 目录与模型目录：固定版本的 40 个文本 Provider 全部展示；只有认证可解析的 catalog 可以加入白名单。
2. API Key / Provider 配置：由 Admin 页面完成，字段按项目 registry 变化；Bedrock bearer token 和 Vertex API Key可以保存。
3. 特殊认证：OAuth 由 API 主机运维命令执行；AWS credential chain、Vertex ADC 和服务账号文件由部署环境配置；Admin 只展示规范化状态、说明和重新检查动作。

用户已确认该归属。本任务不实现浏览器 OAuth callback、AWS 原始凭据表单、Vertex 文件上传和 `ImagesModels`。
