# AI 模块维护

这篇讲改 AI 模块时的动作顺序：哪些改动要动代码、动哪几个文件、跑什么命令验、出问题先看哪里。系统结构见 [design.md](./design.md)，第三方协议见 [integration.md](./integration.md)。

## 1. 动手前先确认三件事

1. 改的是协议、执行还是控制面。协议改动（`packages/contracts/src/ai.ts`）会同时影响 API、Admin 和产品前端；执行改动（`apps/api/src/infra/agent/`）影响 Run 行为但不改协议；控制面改动只影响 Admin。
2. 影响哪些消费方。运行面协议动了，`apps/web` 的事件折叠和 `test-fixtures/harness-timeline-isomorphism.json` 要一起改。控制面动了，`apps/admin/src/api/ai/` 和对应页面要一起改。
3. 要不要 migration。改了 `apps/api/src/modules/ai/ai.schema.ts` 就要生成并执行 migration，API 启动时不会自动执行。

## 2. 扩展点

### 2.1 新增 Provider

Provider 列表来自 pi-ai 的 `builtinProviders()`，不在本仓维护。`apps/api/src/infra/ai/ai-provider-registry.ts` 只做两件事：把 pi-ai 的 Provider 映射成 `AiProviderDefinition`（认证模式、是否接受管理员填 API Key、是否支持刷新模型），以及在 `overrides` 里给个别 Provider 补配置字段和引导文案。

所以分两种情况：

- pi-ai 里已经有这个 Provider：不改代码。在 Admin 的 Provider 页面填配置、点检查、刷新模型目录、勾选要启用的模型。OAuth 类 Provider 需要在 API 主机上跑 `pnpm --filter @starter/api ai:auth`。
- 这个 Provider 需要额外配置字段或专门的引导说明：在 `overrides` 里加一条，`configFields` 用 `field()` 声明，字段 key 用 Provider 认的环境变量名。

配完用 `pnpm --filter @starter/api ai:provider-smoke` 验一次真实连通性。

### 2.2 新增 Tool

1. 用 `apps/api/src/modules/ai/tool/tool-registry.ts` 的 `defineAiTool` 定义：`name`（小写字母开头）、精确 `version`（`\d+.\d+.\d+`）、`description`、`inputSchema`（object 类型 Zod）、`timeoutMs`（100-30000）、`scope`、`requiredPermission`、`execute`。
2. `execute` 只能返回 `{ modelText, safeSummary }`。`modelText` 上限 16000 字符，给模型；`safeSummary` 上限 1000 字符，给界面和事件。原始入参、原始结果和上游负载都不能返回，也不能落库。handler 只拿受限执行上下文（principal、scope、requestId、signal、reportProgress），不拿裸 userId、Hono Context、Session 或数据库。
3. 注册：所有内置 Tool 统一在 `apps/api/src/modules/ai/tool/tool-catalog.ts` 的 `createBuiltinAiToolRegistry` 显式组装；业务 Tool 留在自己的模块下实现，通过受控 service/repository 访问业务数据，`read_skill` 就是样例。不扫描目录、不动态 import。
4. `requiredPermission` 不为空时由 adapter 按 principal kind 分流：只有 `starter_user` 用 `principalId` 查 Starter 授权表；`product_app` 直接 `AI.TOOL_FORBIDDEN`，伪造与 Starter 用户相同的 external user ID 也不能通过。权限查询异常同样按拒绝处理。给第三方用的工具可以不设权限，靠 `scope` 限定范围。
5. Agent 要用这个工具，得在 Agent Definition 配置里加精确 `toolRefs`（`{ name, version }`），管理员在 Admin 选 `name@version`。同一个 Agent 不能同时选同名不同版本。
6. 测试：`apps/api/src/test/pi-tool-adapter.test.ts` 覆盖参数校验、权限、超时和审计，`ai-test-tools.test.ts` 是内置测试工具的样例。

### 2.3 新增 Skill

不改代码。在 Admin 的 Skills 页面建，或调 `POST /api/ai/skills`。`name` 全库唯一，`content` 上限 32000 字符，`enabled` 为 false 时 Agent 解析会失败。

Agent 引用 Skill 是通过 `skillIds`，模型运行时用 `read_skill` 工具按名字读正文，不会一次性塞进 system prompt。

### 2.4 新增 Prompt

不改代码。System Prompt 走 `/api/ai/system-prompts`，Prompt Template 走 `/api/ai/prompt-templates`，全局默认 System Prompt 走 `/api/ai/settings/system-prompt`。

`content` 上限 8000 字符。被 Agent 或全局设置引用的 Prompt 删不掉，返回 `AI.PROMPT_REFERENCED`。

### 2.5 新增 Agent Definition

不改代码。在 Admin 的 Agents 页面建，或调 `POST /api/ai/admin/agents`。要点：

- 新建时状态是 `draft`，切 `enabled` 前会校验配置可执行：模型、System Prompt 必填且当前可用，Skill 必须 enabled，Tool 必须在 registry 里。
- `config` 改动会让 `revision` +1，只改名字和描述不动 `revision`。
- 已经在跑的 Run 用的是启动时写入的快照，改配置不影响它们。

### 2.6 新增 HarnessEvent 类型

这条链最长，顺序不能反：

1. `packages/contracts/src/ai.ts`：加事件 schema，挂进 `harnessEventSchema` 的联合。
2. `apps/api/src/infra/agent/pi-event-mapper.ts`：把 Pi 的事件映射成新类型。这是唯一的转换位置。
3. 如果新事件要影响进行中的视图，改 `apps/api/src/modules/ai/run/run.live-snapshot.ts` 的折叠。
4. 更新 `test-fixtures/harness-timeline-isomorphism.json`，让事件序列和期望快照都包含新类型。
5. `apps/web/lib/ai/chat-events.ts` 按同一规则折叠，`apps/web/test/chat-events.test.ts` 用同一份 fixture 校验。
6. 补 `apps/api/src/test/ai-harness-contracts.test.ts` 和 `run-live-snapshot.test.ts`。

不要让某一端私自加字段。API 发了前端不认识的字段，前端 `safeParse` 会丢掉整帧。

## 3. 跨层改动顺序

```text
packages/contracts/src/ai.ts
  → apps/api/src/modules/ai/*/{*.schema,*.openapi,*.route,*.presenter}.ts
  → apps/api/src/modules/ai/*/{*.service,*.repository}.ts
  → 消费端封装（控制面 apps/admin/src/api/ai/，运行面产品自己的封装）
  → 消费端页面与测试
```

反过来改会漏：先改 Service 再改协议，`pnpm check-types` 只会在最后一步炸；先改前端再改协议，前端拿到的类型是旧的，编译过了但运行时字段不存在。

存储层改动的顺序：

```text
apps/api/src/infra/agent/pi-session-store.ts
  → apps/api/src/modules/ai/session/session.service.ts
  → session.presenter.ts
  → apps/api/src/test/pi-session-store.test.ts、ai-agent-sessions.test.ts
```

Run 生命周期改动的顺序：

```text
apps/api/src/infra/agent/{agent-executor,pi-event-mapper}.ts
  → apps/api/src/modules/ai/run/run.service.ts
  → run.route.ts / run.openapi.ts
  → packages/contracts/src/ai.ts
  → 产品前端的事件归并
```

Run Service 始终是 Run 行、活跃登记、序号、Pi 终态 entry 和终态事件的唯一所有者。Executor 不写 `ai_agent_runs`，不注册路由，不发终态事件。

## 4. AI 数据表

定义都在 `apps/api/src/modules/ai/ai.schema.ts`，共 17 张。

| 表                               | 存什么                                                                                                                            | 明确不存                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `ai_app_credentials`             | 应用凭据：名称、tenant、project、secret 的 sha256 哈希、前 12 位前缀、状态、最后使用时间                                          | 不存 secret 原文                                |
| `ai_app_credential_audit_events` | 凭据的创建、轮换、撤销事件，带操作人和 requestId                                                                                  | 不存 secret 和请求体                            |
| `ai_provider_configs`            | Provider 的启用状态、凭据类型与提示、加密后的凭据负载、认证状态、最后一次检查结果                                                 | 明文密钥                                        |
| `ai_model_catalogs`              | 每个 Provider 拉回来的模型目录 JSON、etag、检查时间                                                                               | 无                                              |
| `ai_enabled_models`              | 白名单：`providerId` + `modelId` 组合主键                                                                                         | 无                                              |
| `ai_system_prompts`              | System Prompt 名称、正文、启用状态                                                                                                | 无                                              |
| `ai_prompt_templates`            | Prompt Template 名称、描述、正文、启用状态、排序                                                                                  | 无                                              |
| `ai_skills`                      | Skill 名称、描述、正文、启用状态                                                                                                  | 无                                              |
| `ai_settings`                    | 全局默认模型和全局默认 System Prompt，单行配置                                                                                    | 无                                              |
| `user_ai_preferences`            | Starter 用户的模型偏好，按 `userId` 主键                                                                                          | 无                                              |
| `ai_agent_definitions`           | Agent 名称、描述、状态、`revision`、无 secret 的 config JSON                                                                      | Provider secret、Prompt / Skill 正文、Tool 实现 |
| `ai_agent_sessions`              | Session 归属（`principalKind`、`ownerId`、`appId`、tenant、project、`externalUserId`、subject）、标题、`defaultAgentId`、归档时间 | transcript、lane 树、消息正文                   |
| `ai_agent_runs`                  | Run id、Session、Agent 和 `agentRevision`、lane、状态、执行快照、`requestId`、`finalEntryId`、错误码、时间戳                      | 消息正文、事件流                                |
| `ai_model_calls`                 | 每次模型请求：身份与 scope、`scenario`、`runId`、Provider / 模型、耗时、超时、token、成本、结果和错误码                           | prompt、响应正文、secret、上游原始错误          |
| `ai_tool_executions`             | 每次工具执行：关联的模型调用 id、工具名、耗时、超时、状态、错误码                                                                 | 入参、结果、`safeSummary`                       |
| `ai_pipeline_definitions`        | Pipeline 名称、描述、状态、`revision`、步骤定义 JSON（每步 agentId + inputTemplate + laneLabel）                                  | Agent 定义本体、secret                          |
| `ai_pipeline_runs`               | Pipeline run：归属列族（同 `ai_agent_sessions`）、专用 `sessionId`、输入、状态、步骤执行明细 JSON、最终产出、错误码、时间戳       | 步骤的 transcript 与事件（在各自的 Run 里）     |

`ai_tool_executions.ai_call_id` 外键指向 `ai_model_calls.id`，级联删除。查某次 Run 的工具执行要先按 `run_id` 找模型调用。`ai_pipeline_runs.session_id` 外键指向 `ai_agent_sessions.id`，级联删除；步骤执行明细里的 `runId` 指向 `ai_agent_runs.id`，查步骤全文去读对应 Run 的 transcript。

改完 schema：

```bash
pnpm --filter @starter/api db:generate   # 生成 migration
pnpm --filter @starter/api db:check      # 检查状态
pnpm --filter @starter/api db:migrate    # 执行
```

破坏性改动（删列、改约束）要补一条测试到 `apps/api/src/test/ai-destructive-migration.test.ts` 那一类，确认老数据能过。

## 5. 审计口径

`ai_model_calls.scenario` 只有三个值，由 check 约束保证：

| 值           | 什么时候写                 | `run_id`  |
| ------------ | -------------------------- | --------- |
| `model_test` | 管理员点模型连通性测试     | null      |
| `agent_run`  | Agent Run 里的每次模型请求 | 有值      |
| `legacy`     | 历史数据                   | 通常 null |

`principal_kind` 也有 check 约束，只能是 `starter_user` 或 `product_app`。应用凭据发起的调用会带 `app_id`、`tenant_id`、`project_id` 和 `external_user_id`，按 scope 查用量靠这几列的联合索引。

工具审计的规矩：每条 begin 过的记录都必须 finalize。状态取值是 `succeeded`、`not_found`、`invalid_arguments`、`forbidden`、`failed`、`timed_out`、`cancelled`、`interrupted`。留下 `running` 状态的记录说明有代码路径漏了 finalize，按 bug 处理。

两张表都不许出现正文：prompt、模型响应、工具入参、工具结果、`safeSummary`。要排查内容问题，看 Pi transcript，不要往审计表加字段。

## 6. 验收命令

改完 AI 相关代码，从仓库根目录依次跑：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

`pnpm test` 走 turbo，会跑 api、web、admin 三个包的 test 脚本。按改动范围补针对性的单文件命令：

```bash
# Run 生命周期、SSE、终态、恢复
pnpm --filter @starter/api exec vitest run src/test/ai-agent-runs.test.ts --config vitest.config.ts
# Session 归属、双库、transcript
pnpm --filter @starter/api exec vitest run src/test/ai-agent-sessions.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/pi-session-store.test.ts --config vitest.config.ts
# 事件协议与 live 折叠
pnpm --filter @starter/api exec vitest run src/test/ai-harness-contracts.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/run-live-snapshot.test.ts --config vitest.config.ts
# 身份、scope、跨产品运行面
pnpm --filter @starter/api exec vitest run src/test/ai-principal-scope.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/ai-runtime-scope.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/ai-cross-product-runtime.test.ts --config vitest.config.ts
# 应用凭据
pnpm --filter @starter/api exec vitest run src/test/ai-app-credentials.test.ts --config vitest.config.ts
# 工具执行
pnpm --filter @starter/api exec vitest run src/test/pi-tool-adapter.test.ts --config vitest.config.ts
# 前端事件折叠与 SSE 解析
pnpm --filter @starter/web test
```

有一类问题这五条命令都抓不到：共享包在 dev 下的模块解析。`pnpm build` 走 production 条件读 `dist`，tsc 和 vitest 会做扩展名替换，只有 `pnpm dev` 会炸。`apps/web` 第一次从 `@starter/contracts` 做值导入（不是 `import type`）时，必须起一次 `pnpm dev:web` 打开页面确认。改完共享包也要先 `pnpm --filter @starter/contracts build`，web 的 dev 才看得到。

## 7. 运维动作

### 7.1 环境变量

| 变量                           | 默认值                     | 说明                                                               |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `DATABASE_PATH`                | `./data/app.db`            | Starter 主库                                                       |
| `AGENT_SESSION_DATABASE_PATH`  | `./data/agent-sessions.db` | Pi Session 库，独立文件                                            |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | 无默认，必填               | 32 字节密钥的 base64。换了这个值，已保存的 Provider 凭据全部解不开 |
| `AI_REQUEST_TIMEOUT_MS`        | 60000                      | 单次模型请求超时，范围 1000 到 300000                              |
| `AI_TEST_TOOLS_ENABLED`        | false                      | 打开后注册内置测试工具，生产不要开                                 |

### 7.2 migration

API 启动不执行 migration。部署顺序是先 `db:migrate` 再起进程。升级前先 `db:check` 看有没有待执行的。

### 7.3 Provider 凭据轮换

在 Admin 的 Provider 页面重新填 API Key（`PUT /api/ai/admin/providers/{providerId}/config`），或者先删凭据（`DELETE .../credential`）再填。填完点检查（`POST .../check`）确认状态变成 ready。OAuth 类 Provider 用 `pnpm --filter @starter/api ai:auth` 重新授权。

凭据换了不影响已启用模型白名单和 Agent 配置。

### 7.4 应用凭据轮换和撤销

轮换（`POST /api/ai/admin/applications/{appId}/rotate`）会立即让旧 secret 失效，`appId` 不变，所以接入方的历史数据仍然可见。撤销（`.../revoke`）之后这个凭据的所有请求返回 401，数据留在库里但访问不到。

两个动作都会写一条 `ai_app_credential_audit_events`。

### 7.5 备份

两个 SQLite 要一起备：`app.db` 有配置、归属和审计，`agent-sessions.db` 有全部会话历史。只备一个会出现「Session 索引在但历史没了」或者反过来的孤儿状态。备份前停写或者用 SQLite 的在线备份，不要直接复制正在写的文件。

### 7.6 启动日志要看的两条

API 创建 AI 路由时会异步做两件事，结果只出现在日志里：

- Session 一致性检查：发现两库孤儿记录会打 warn，带 `missingInPiCount` 和 `missingInMainCount`。
- Run 启动恢复扫描：扫到非终态 Run 会打 info，带 `scanned`、`recoveredFromEntry`、`interrupted`、`corrupted`。`corrupted` 不为 0 说明 Pi 终态 entry 有重复或身份字段不匹配，要去查是不是同一个 Session 被两个进程写过。

## 8. 故障排查

| 症状                                          | 先看哪里               | 怎么确认                                                                                                                                | 处理                                                                                                 |
| --------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Run 一直停在 `starting` 或 `running`          | 进程是否还活着         | 查 `ai_agent_runs` 的 `started_at` 和当前时间差；重启 API 后看恢复扫描日志                                                              | 重启会把无法恢复的 Run 标成 `interrupted`；让客户端重新发起                                          |
| SSE 一个事件都没收到                          | 启动阶段是否抛错       | 看 API 日志里同 `requestId` 的错误；确认响应状态码不是 4xx                                                                              | 4xx 按错误码修请求；`prepare` / `attach` 失败会写 `failed` 终态，日志里有原因                        |
| 客户端报「流断了」但 Run 其实完成了           | 客户端逻辑             | 查 `GET /runs/{runId}` 的 `status`                                                                                                      | 断流不等于失败，客户端要转轮询再读 transcript                                                        |
| 401 和 404 分不清                             | 身份和 scope           | 401 是凭据或 subject 头问题；404 是 scope 不匹配、Session 已归档或资源真的不存在                                                        | 核对四个头，再核对 `tenantId` / `projectId` / `externalUserId` / subject 是否和创建时一致            |
| 启动 Run 报 `AI.AGENT_CONFIG_INVALID`         | `details.resource`     | 依次查模型是否在白名单、System Prompt 是否 enabled、Skill 是否 enabled、Tool 是否在 registry 且 scope 匹配                              | 修 Agent 配置或启用对应资源                                                                          |
| 模型请求一直失败                              | Provider 认证状态      | Admin 点检查；查 `ai_model_calls` 最近的 `result` 和 `error_code`                                                                       | `AI.PROVIDER_AUTH_FAILED` 重新填凭据，`AI.UPSTREAM_TIMEOUT` 看 `AI_REQUEST_TIMEOUT_MS` 和网络        |
| 工具老是超时                                  | 工具自己的 `timeoutMs` | 查 `ai_tool_executions` 的 `status='timed_out'` 和 `timeout_ms`                                                                         | 调工具定义里的超时，或让工具用 `reportProgress` 分段                                                 |
| 工具返回 `forbidden`                          | 权限和 scope           | 看工具的 `requiredPermission` 和 `scope`；带权限的工具在应用凭据下取决于 `externalUserId` 能不能在 Starter 授权表里命中                 | 给第三方用的工具把 `requiredPermission` 设成 `null`，用 `scope` 限定                                 |
| Run 很快就变 `failed` + `AI.UPSTREAM_TIMEOUT` | 两个超时哪个先到       | 看 `ai_model_calls` 最后一条的 `duration_ms`：接近 `AI_REQUEST_TIMEOUT_MS` 是单次请求超时，接近 120 秒且模型调用有多条是 Run 总时长超限 | 单次请求超时调 `AI_REQUEST_TIMEOUT_MS`；Run 总时长超限要改 `maxRunMs`，或把 Agent 的 `maxTurns` 调小 |
| Session 列表里少了记录                        | 两库一致性             | 看启动日志的一致性检查 warn；对比两库的 Session id                                                                                      | 主库缺记录说明创建补偿失败过，按业务决定补建还是清掉 Pi 侧孤儿                                       |
| 同一个 Session 发第二条就 409                 | 活跃登记               | 错误码是 `AI.SESSION_BUSY`                                                                                                              | 等当前 Run 到终态，或让客户端换 lane；多实例部署时确认请求有没有打到别的进程                         |
