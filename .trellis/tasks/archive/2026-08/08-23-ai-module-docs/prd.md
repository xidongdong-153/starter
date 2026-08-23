# AI 模块文档：设计、维护与第三方集成

## Goal

在 `docs/ai/` 下产出一组人读文档，讲清 `apps/api` AI 模块的架构、维护方式和第三方应用接入方式。产出只是文档，不改任何运行代码。

## 背景与现状

- AI 业务代码在 `apps/api/src/modules/ai/`，分 8 个子域：`agent`、`application`、`configuration`、`prompt`、`run`、`session`、`skill`、`tool`、`usage-audit`。
- Pi Agent 执行与 Provider 接入在 `apps/api/src/infra/agent/` 和 `apps/api/src/infra/ai/`。
- 跨端协议单一来源是 `packages/contracts/src/ai.ts`。
- AI 路由现有 53 个 OpenAPI 端点定义，OpenAPI tag 分三面：`AI Control`、`AI Runtime`、`AI Compatibility`。
- 已有消费方两个：`apps/admin` 做控制面页面，`apps/web` 做运行面聊天页。
- 第三方接入已经有实现：`ai_app_credentials` 表 + `Authorization: Bearer <secret>` + `X-AI-External-User-Id` / `X-AI-Subject-Type` / `X-AI-Subject-Id` 头，`principal.guard.ts` 按有没有 Bearer 头分叉到应用凭据或 Better Auth 用户。
- 现有 `.trellis/spec/api/backend/ai-system-design.md`（608 行）写的是给 Agent 看的实现规范，且没覆盖 `application` / `principal` / scope 隔离这部分较新的代码。仓库目前没有 `docs/` 目录，也没有任何面向外部接入方的说明。

## Requirements

### 交付物

- 新建 `docs/ai/`，四个文件，每篇 200-400 行：
  - `index.md`：入口、四篇文档的选择路径、统一术语表。
  - `design.md`：分层与职责、数据流、双库分工、事件与记录的关系、Run 状态机、鉴权与 scope 隔离。
  - `maintenance.md`：扩展点、跨层改动顺序、数据表与审计口径、验收命令、运维动作、故障排查。
  - `integration.md`：第三方接入 quickstart、鉴权头、Runtime 接口详表、SSE 消费与断流恢复、错误码表、限制与规避做法。
- `README.md` 目录一节加一行 `docs/ai` 入口链接。

### 读者与详略

- 双读者分区：`design.md` + `maintenance.md` 给本仓维护者，`integration.md` 给外部接入方，两边术语一致（Agent / Session / Run / lane / Principal / Scope / HarnessEvent / Transcript / live）。
- `integration.md` 只写外部可见的协议、请求、响应和错误码，不引用仓库内部源码路径。
- `design.md` / `maintenance.md` 可以引用源码路径，深层执行细节不复制，指向 `.trellis/spec/api/backend/` 对应文件：`ai-system-design.md`、`agent-run-guidelines.md`、`agent-session-guidelines.md`、`pi-agent-execution-guidelines.md`、`ai-integration-guidelines.md`。

### 接口覆盖

- Runtime 面逐个详写：`GET /api/ai/agents`、`GET /api/ai/agents/{agentId}`、Session 六个端点、Run 五个端点、Transcript。写清方法、路径、请求字段、响应形态、鉴权要求。
- Control 面按分组给表格概览：Provider、模型目录与白名单、Prompt、Skill、Agent Definition、应用凭据、用量审计。
- Compatibility 面（`GET /api/ai/models`、`GET/PUT /api/ai/preferences`）只说用途，并说明它依赖 Starter 用户模型，不作为第三方接入协议。

### 第三方集成章节

- 完整 quickstart 链路：Admin 创建应用凭据 → `Authorization: Bearer` + 三个 subject 头 → 创建 Session → `POST .../runs` 读 SSE → 断流轮询 `GET .../runs/{runId}` 的 `live` → 终态读 transcript。
- 每一步给 curl 和 TypeScript 两组示例。
- 错误码表覆盖接入方会遇到的分支，至少包含 `AUTH.UNAUTHENTICATED`、`COMMON.NOT_FOUND`、`COMMON.INVALID_REQUEST`、`AI.SESSION_BUSY`、`AI.AGENT_NOT_ENABLED`、`AI.RUN_NOT_ACTIVE`、`AI.RUN_INTERRUPTED`、`AI.SESSION_STORAGE_FAILED`、`AI.UPSTREAM_ERROR`、`AI.UPSTREAM_TIMEOUT`。`AI.NO_AVAILABLE_MODEL` 不列：它只在 `POST /api/ai/test` 路径上抛，Agent Run 路径上模型不可用一律走 `AI.AGENT_CONFIG_INVALID` 或终态 `AI.MODEL_NOT_FOUND`。
- 写清 subject 头规则：`X-AI-External-User-Id` 必填，`X-AI-Subject-Type` 和 `X-AI-Subject-Id` 必须同时给或同时不给，头解析失败统一返回 401。
- 写清隔离维度：应用凭据的数据可见范围是 `appId + tenantId + projectId + externalUserId + subjectType + subjectId` 全等匹配，换一个 subject 就看不到原来的 Session。

### 限制与规避做法

单独一章写清当前边界，每条配接入方该怎么做：

- `GET /api/ai/agents` 和 `GET /api/ai/agents/{agentId}` 只认 Better Auth 用户，Bearer 应用凭据调不通。规避做法：管理员在 Admin 复制 `agentId` 交给接入方，或建 Session 时带 `defaultAgentId`。这个缺口只记录，不改代码。
- `live` 快照是进程内视图，Run 进终态或 API 重启后为 `null`，持久事实看 `AgentRun.status` 和 transcript。
- active Run registry 是单进程的，多实例部署不共享。
- 没有「列出某 Session 的 Run」接口，接入方要自己存 `runId`。
- SSE 不支持 `Last-Event-ID` 重连，断了只能轮询 Run 状态。
- 应用凭据没有频率限制，也没有 Agent 白名单，凭据能用任何已启用 Agent。
- 同一个 `sessionId + lane` 同时只能有一个 active Run，冲突返回 409 `AI.SESSION_BUSY`。

### 维护章节

- 扩展点各写一条改动路径：新增 Provider、新增 Tool、新增 Skill、新增 Prompt、新增 Agent Definition、新增 HarnessEvent 类型。
- 跨层改动顺序：contracts → api schema/route/presenter → service/repository → 消费端封装 → 测试。
- AI 相关数据表清单与审计口径：`ai_app_credentials`、`ai_app_credential_audit_events`、`ai_provider_configs`、`ai_model_catalogs`、`ai_enabled_models`、`ai_system_prompts`、`ai_prompt_templates`、`ai_skills`、`ai_settings`、`user_ai_preferences`、`ai_agent_definitions`、`ai_agent_sessions`、`ai_agent_runs`、`ai_model_calls`、`ai_tool_executions`，并写明哪些字段禁止落库（prompt 正文、响应正文、tool arguments/result、secret）。
- 验收命令：`pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm --filter @starter/api db:check`，以及 AI 相关 vitest 单文件命令。
- 运维动作：migration 执行时机、Provider 密钥轮换、应用凭据 rotate/revoke、Pi Session DB 备份、启动恢复扫描日志怎么看。
- 故障排查：Run 卡在非终态、SSE 没有事件、401/404 分不清、模型不可用、Tool 超时、Session 双库孤儿记录。

### 图

6 张 Mermaid，内联在 md 里，首行统一 `%%{init: {"theme": "dark"}}%%`：

- `design.md`：模块分层总览、一次 Run 的时序、Run 状态机、双库写入与审计去向。
- `integration.md`：鉴权分叉（Cookie vs Bearer）与 scope 隔离、第三方接入时序（含断流轮询与终态读 transcript）。

### 文案约束

- 遵守 `xdd-plain-docs`：中文、不写 emoji、不写互联网八股词、不写客服腔、不展开版本历史和设计愿景。
- 所有路径、字段名、header 名、错误码、命令来自源码核对，查不到就写「没查到」。

## 事实核对来源

写作时逐条对照，不凭记忆：

- 路径与方法：`apps/api/src/modules/ai/*/*.openapi.ts`
- 请求/响应字段与事件联合：`packages/contracts/src/ai.ts`
- 错误码：`packages/contracts/src/common.ts`
- 鉴权与 scope：`apps/api/src/modules/ai/principal.ts`、`principal.guard.ts`、`application/application.guard.ts`、`session/session.repository.ts` 的 `accessWhere`
- 凭据生成与校验：`apps/api/src/modules/ai/application/application.crypto.ts`、`application.service.ts`
- 表结构：`apps/api/src/modules/ai/ai.schema.ts`
- 折叠规则：`apps/api/src/modules/ai/run/run.live-snapshot.ts`、`test-fixtures/harness-timeline-isomorphism.json`
- 客户端消费参考：`apps/web/lib/ai/`、`apps/web/hooks/use-chat-run.ts`、`apps/admin/src/api/ai/`
- 现有测试：`apps/api/src/test/ai-*.test.ts`、`apps/web/test/*.test.ts`

## Acceptance Criteria

- [x] `docs/ai/index.md`（103）、`design.md`（349）、`maintenance.md`（241）、`integration.md`（532）四个文件存在
- [x] `README.md` 目录一节有 `docs/ai` 入口链接
- [x] 文档里出现的每个接口路径、方法、header 名、字段名、错误码，都能在上面「事实核对来源」里找到对应定义；文中引用的 32 个仓库路径脚本校验全部存在
- [x] Runtime 面端点逐个写清；Control 面有分组表格；Compatibility 面标注不作为第三方协议
- [x] quickstart 六步齐全，curl 和 TypeScript 两组示例都在，SSE 帧解析规则（空行切帧、跳过 `:` 注释心跳、坏帧只丢该帧）写清
- [x] 限制清单共十条（计划七条 + 工具权限、工具 scope、Run 总时长上限），每条带规避做法
- [x] 6 张内容图按归属就位（design 4、integration 2），另加 index 一张读者分流图，首行都是暗色主题声明，8 个块全部 `mmdc` 渲染通过
- [x] `integration.md` 全文不出现仓库内部源码路径
- [x] 全文无 emoji，无 `xdd-plain-docs` 硬边界里的八股词和客服腔
- [x] `pnpm format:check` 通过；`pnpm check-types`、`pnpm lint`、`pnpm test` 全绿（api / web / admin 三包）
- [x] `git status` 只有 `docs/ai/` 四个新文件、`README.md` 一行改动和本任务目录，运行代码零改动

## 写作时发现的事实（与现有 spec 不一致）

- `.trellis/spec/api/backend/ai-system-design.md` 没覆盖 `application/` 、`principal.ts` 和 scope 隔离，第 8 节只写了 Starter 用户归属，第 10 节还写着「不提前加租户」。
- 单个 Run 有总时长上限：Executor 的 `maxRunMs` 默认 120000 ms，`ai.route.ts` 没传这个参数，也没接环境变量；超时终态是 `failed` + `AI.UPSTREAM_TIMEOUT`。
- `GET /api/ai/agents` 和 `GET /api/ai/agents/{agentId}` 用的是 `requireAuth`，应用凭据调不通；运行面 OpenAPI 的 security 只声明了 `cookieAuth`，没跟上双身份实现。
- Session 归档后 transcript 接口也读不到（`requireActiveSession` 拒已归档），不只是不能启动新 Run。
- Tool 权限检查没有 principalKind 判据：`hasPermission` 拿 `externalUserId` 直接查 `user_roles`，第三方把 `X-AI-External-User-Id` 填成某个 Starter 用户 id 就能通过带 `requiredPermission` 的工具。当前内置工具的 `requiredPermission` 全为 `null`，暂无可利用面，已记入 spec。
- Skill 没真正接通：`run.service.ts` 传给 executor 的 config 不包含 skills，`appendSkillDescriptions` 只在测试里被调，模型拿不到可用技能清单。
- `AI.TOOL_FAILED` 不会成为 Run 终态错误码；工具层只有用户取消和「Run 剩余时长为 0 但模型还要调工具」会终止 Run。
- `AI_CREDENTIAL_ENCRYPTION_KEY` 在 `env.ts` 里是 `optional()`，不填 API 仍能启动，只是 Provider 凭据存取报 `AI.CREDENTIAL_KEY_UNAVAILABLE`。
