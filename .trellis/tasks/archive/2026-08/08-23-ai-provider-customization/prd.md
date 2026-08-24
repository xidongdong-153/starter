# 自定义 AI Provider 完整实现

## Goal

在现有 AI Harness 不变的前提下，让拥有 `ai:config:manage` 权限的管理员可以在 Admin 创建、配置、检查、启停、维护模型和删除自定义 Provider，并让这些 Provider 与模型测试、Agent Run、模型白名单、默认模型、用量审计共用同一条 API runtime 调用链。

## Product Scope

首版支持 `@earendil-works/pi-ai` 已有且适合配置驱动的三类协议：

- `openai-completions`：OpenAI Chat Completions 兼容接口。
- `openai-responses`：OpenAI Responses 兼容接口。
- `anthropic-messages`：Anthropic Messages 兼容接口。

Provider 定义由数据库保存，运行时由 API 进程使用 `pi-ai` `createProvider()` 构造；Admin 不上传代码、不填写 JS/TS、不加载 npm 包。

模型首版支持 Admin 手工维护。动态模型目录刷新必须保留明确的接口边界，但不是自定义 Provider 首版的必要能力；如果实现周期允许，可作为 API 子任务的独立增强并保持默认关闭。

## Confirmed Decisions

- 自定义 Provider 与内置 Provider 使用同一个 `Models` 集合。
- 自定义 Provider 不得覆盖内置 Provider ID。
- Provider secret 继续进入现有 AES-256-GCM 加密 payload，不出现在 DTO、日志、Run snapshot、transcript 或 SSE。
- Provider 配置变更后自动停用、递增 `configRevision`、清除认证检查结果和受影响的全局默认模型。
- 只有认证检查通过且检查 revision 等于当前 revision 时才能启用。
- Admin 复用现有 `AI_CONFIG_READ` / `AI_CONFIG_MANAGE` 权限。
- 普通用户只能看到已启用 Provider 的已启用模型，不知道未发布自定义 Provider 的内部配置。
- 删除 Provider 前必须停用，并清理其模型白名单和默认模型引用；存在 Agent 引用时拒绝删除或要求先修改 Agent，具体以 API 校验为准。
- API 必须限制自定义 endpoint 的 URL scheme，并对可访问网络范围执行 SSRF 防护策略。生产环境只允许 HTTPS 公网地址，或命中 API 环境变量配置的 CIDR allowlist 的私网地址；Admin 不能修改该 allowlist。开发环境额外允许 localhost 回环地址。保存、认证检查和实际请求前都必须校验解析后的 IP，每次重定向重新校验。


## In Scope

- contracts：Provider definition、协议、模型定义、兼容参数、创建/更新/删除/测试输入输出 schema。
- database：自定义 Provider definition 表、字段约束、migration、索引、与现有 Provider config/model catalog 的关联策略。
- API runtime：从持久化定义构造三类 `pi-ai` Provider，启动恢复、创建/更新/删除后的热加载、认证、流式调用、模型查找和错误映射。
- API control plane：Admin CRUD、连接检查、启停、模型 CRUD/替换、删除前引用检查、OpenAPI 和权限。
- Admin：自定义 Provider 列表、创建、编辑、删除、凭据配置、认证检查、启停、模型维护、错误和 pending 状态。
- tests：contracts schema、数据库存储、runtime 工厂、协议分发、SSRF、权限、敏感信息过滤、Admin query 和关键交互。
- integration：模型测试、Agent Run、模型白名单、全局默认、用量审计和启动恢复的跨层验证。

## Out of Scope

- Admin 上传或执行 Provider 脚本。
- 任意 npm 包、远程 JS、shell 命令或动态 import。
- 自定义 OAuth 授权流程；首版只支持 API Key 和 keyless/ambient 认证。
- Google、Mistral、Bedrock 等额外专用协议。
- 用户创建 Provider 或按租户隔离 Provider。
- 任意请求 header 模板、任意 body 模板和任意响应转换脚本。
- 自动发现所有模型能力并保证准确；手工模型定义以管理员输入为准，仍需 schema 和范围校验。
- 修改既有 Agent Run 事件协议和旧 Provider 的行为。

## Acceptance Criteria

- [x] 管理员可以创建三类协议之一的自定义 Provider，Provider ID 唯一且不能覆盖内置 Provider。
- [x] 创建和更新时 Base URL、模型定义、协议专属参数和凭据通过 contracts 与 API 双重校验。
- [x] API 重启后可以从数据库恢复自定义 Provider、凭据状态和模型目录。
- [x] 自定义 Provider 认证检查成功后可以启用；配置变化会停用并要求重新检查。
- [x] Admin 可以添加、编辑、删除和排序该 Provider 的模型；模型能进入现有白名单和全局默认流程。
- [x] 三类协议都能通过现有模型测试 SSE 路径完成真实或 fake Gateway 调用。
- [x] 三类协议都能通过现有 Agent Run 原生 Pi stream 路径完成调用和用量审计。
- [x] Provider 删除会处理模型白名单、默认模型和 Agent 引用，不留下悬挂的可用模型。
- [x] 自定义 Provider secret 不出现在所有公开 DTO、日志、测试快照、Run snapshot、transcript 和 SSE。
- [x] 未授权用户不能访问 Admin Provider 管理接口，普通用户不能读取未启用 Provider 或未启用模型。
- [x] URL 校验和请求访问策略阻止危险 scheme、明显 SSRF 地址和不符合部署策略的 endpoint。
- [x] `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm --filter @starter/api db:check` 通过。

## Child Tasks

1. `08-23-ai-provider-contracts-storage`：contracts、数据库 schema、migration、定义/模型存储和基础校验。
2. `08-23-ai-provider-api-runtime`：三类 `pi-ai` Provider runtime、管理 API、认证、热加载和引用清理。
3. `08-23-ai-provider-admin-ui`：Admin Provider 创建、编辑、模型维护和交互状态。
4. `08-23-ai-provider-integration-verification`：跨层验证、回归测试、安全检查和最终集成。

## Dependency Order

- Child 1 先完成并稳定 contracts/schema，Child 2 依赖其 DTO 和数据库结构。
- Child 2 完成 API/OpenAPI 后，Child 3 才接入真实 RPC 类型和 mutation/query。
- Child 4 等 Child 1-3 合并到工作区后执行；若发现契约缺陷，先回到对应子任务修正。
- 父任务不单独实现产品代码，负责审查四个子任务的交付是否满足本 PRD。

## Decisions

- [x] 生产私网访问：允许，但必须命中 API 环境变量配置的 CIDR allowlist；Admin 不能自行放开。默认仍阻止 loopback、link-local、云 metadata 和未命中的 RFC1918/IPv6 私网地址。
- [x] 开发环境：允许 `localhost`、`127.0.0.1`、`::1`，仍禁止危险 scheme 和非 HTTP(S) 地址。

