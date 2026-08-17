# 重构 AI 为 Pi Agent Harness

## 目标

直接把 Starter 当前 AI Conversation runtime、HTTP API、contracts 和 Admin 调用重构为通用 Agent Harness。后续聊天、群聊、Agent 好友和节点图等产品只组合 Agent、Session、Run 和 Event，不重复实现模型调用、工具循环、Session tree、分支、压缩和运行状态管理。

规划获批后，在一个任务内完成旧实现删除、旧会话数据清空、数据库切换、新 Harness API 和 Admin AI 页面改造。不保留兼容 facade、legacy read path、双 runtime、双写或旧 contracts。

## 背景

- Starter 已有 Provider 配置、模型选择、Prompt、Skill、Tool、Conversation、SSE 和用量审计能力。
- 当前 Conversation Service、Repository 和 Tool Orchestrator 自行维护消息历史、generation 状态和多轮工具调用。
- Pi 已提供统一模型层、`Agent`、`agentLoop`、Session tree、lane、branch、compaction、records 和 SQLite Session backend。
- Pi 当前发布版的 `AgentHarness` 仍有未实现方法，不能直接作为 Web Harness 使用。
- 用户希望 Starter 主要组合成熟依赖，只维护身份、权限、业务配置、HTTP 协议和必要适配。
- 用户接受破坏性改造，并明确要求删除旧 Conversation 数据，从空的 Pi Session store 开始。

## 核心对象

- `AgentDefinition`：Admin 管理的可复用 Agent 配置，引用模型策略、系统 Prompt、Skill 和 Tool。
- `AgentSession`：持久化交互上下文，不绑定具体产品 UI，也不强制只允许一个 Agent。
- `AgentRun`：某个 Agent 在指定 Session 和 lane 上的一次执行。
- `HarnessEvent`：Run 的稳定事件协议，供 SSE、日志、测试和未来其他 transport 使用。
- `Lane`：Session 内的独立上下文分支，默认使用 `main`。

## 需求

### R-1 复用 Pi

- 模型、Provider、认证和 stream 继续基于 `@earendil-works/pi-ai`。
- Agent loop、Tool 调用、队列和运行事件基于 `@earendil-works/pi-agent-core` 的 `Agent` 或 `agentLoop`。
- Session history、tree、lane、branch、records 和 compaction 使用 Pi Session API。
- Node.js 持久化使用 `@earendil-works/pi-session-backend-sqlite-node`。
- Starter 不复制 Pi 已提供的 Agent loop、Session reducer、branch cache、writer lease、FTS、token 估算或 compaction 算法。

### R-2 Starter 责任

- Better Auth 继续负责用户身份。
- Drizzle 主库保存 AgentDefinition、Session 业务索引、Run 索引、权限关系和用量审计。
- API Service 负责资源归属、Agent 配置解析、运行装配和错误转换。
- Hono Route 负责请求校验、SSE 输出和公开 DTO。
- `packages/contracts` 只保存跨端 Zod schema、DTO、事件和错误码，不导出 Pi、Drizzle、Hono 或 Provider 内部类型。

### R-3 通用 Harness API

- API 以 Agent、Session、Run 和 Event 为核心，不以聊天页面、群聊房间或 React Flow 节点为核心。
- 同一个 Session 可以由不同 Agent 发起 Run，支持未来多 Agent 产品组合。
- 每个 Run 记录 Agent revision 和无 secret 的配置快照。
- SSE 只是一种 Event transport；事件定义不能依赖 Hono stream 对象。
- 客户端断开 SSE 不自动取消 Run；显式 abort 才改变 Run 状态。

### R-4 状态与持久化

- Pi Session store 是 transcript、branch、lane、compaction 和运行记录的事实来源。
- Starter 主库只保存适合鉴权、列表、筛选和审计的业务索引，不复制完整消息历史。
- Pi Session 使用独立 SQLite 文件，由 Pi 管理 migration；不得与 Drizzle 主库共用 schema、connection 或 migration。
- 运行中的 `Agent`、AbortController、订阅和 Event fan-out 只放内存。
- 同一个 Session lane 同时只允许一个写 Run；并发冲突返回稳定错误。

### R-5 管理与权限

- Admin 管理 Provider、模型、Prompt、Skill、Tool allowlist、AgentDefinition 和用量审计。
- 普通已登录用户只能读取可用 Agent、管理自己的 Session，并执行已启用 Agent。
- Provider secret 不能进入 AgentDefinition、Run snapshot、Session metadata、SSE 或公开 DTO。
- 第一版不增加组织、租户、复杂 ACL 或用户创建 Agent 的所有权字段。

### R-6 产品适配

- 单聊把一个产品会话映射为一个 Session，把发送消息映射为 Run。
- 群聊自行管理好友、房间、成员和发言路由，只向 Harness 提交 Agent、Session、lane 和输入。
- React Flow 自行管理画布和图定义；后续 Graph adapter 调用同一个 AgentRun application port。
- Graph engine、checkpoint 和节点数据流不由 Pi Session 代替，也不在本任务实现。

### R-7 破坏性切换

- 本节的 migration 只指 Drizzle schema migration，不包含旧 Conversation 业务数据转换。
- 删除现有 Conversation Service、Repository、Presenter、OpenAPI、Route、generation 状态机和自有 Tool Orchestrator。
- 移除 `/api/ai/conversations` 及其旧 contracts、错误码、SSE event 和测试。
- 删除 `ai_conversations`、`ai_conversation_messages`、`ai_generations` 及只服务旧 runtime 的字段和 relation。
- 不导出、不转换、不备份旧会话、消息和 generation；新 `agent-sessions.db` 从空库开始。
- 旧数据清理与新 schema 在一次 Drizzle migration 中完成；最终代码不能包含 legacy 分支或双写。
- Provider、模型配置、Prompt、Skill、Tool Registry、用量审计及其现有数据保留，并接入新 Harness。
- `ai_model_calls` 删除旧 `conversationId`、`generationId` 关联，改为 nullable `runId`；已有审计记录可以保留为 `runId=null`。

### R-8 Admin 同步改造

- `apps/admin` 的 AI 请求函数、query keys、hooks、页面状态和测试改用 Agent、Session、Run 和 HarnessEvent contracts。
- 新增 AgentDefinition 管理入口。
- 当前 `AiConversations` 页面直接替换为 Session/Run 调试页面，不保留 Conversation view model、retry generation 或旧 SSE reducer。
- Admin 可创建 Session、选择 Agent、启动或停止 Run、查看 transcript 和 Tool 活动。
- Admin 不直接读取 Pi Session database 或 runtime 内存状态。

## 非目标

- 不迁移、导出、备份或恢复旧 Conversation 数据。
- 不保留旧 Conversation API、旧 generation 状态机或兼容 facade。
- 不实现好友、群聊、房间、成员、消息已读或通知。
- 不实现 React Flow 页面、Graph DSL、Graph compiler 或工作流调度器。
- 不安装 LangGraph，也不自行实现 DAG、checkpoint 或节点调度。
- 不实现多进程 Event 总线、分布式队列、跨节点 Run 恢复或水平扩容。
- 不复制 `pi-coding-agent` 的 cwd、编码工具、CLI resource loader 或 extension 系统。

## 验收条件

- [ ] `research/pi-capability-matrix.md` 记录 Pi 可复用、需要薄适配和不采用的能力，并给出源码依据。
- [ ] `design.md` 写清模块边界、状态归属、数据库重置、API、事件、并发、失败恢复、Admin 切换和 Graph 扩展口。
- [ ] `design.md` 中的暗色 Mermaid 图通过语法和渲染检查。
- [ ] `implement.md` 包含可验证的旧数据清空、旧文件删除、Admin 改造和回滚边界。
- [ ] Pi Session 使用独立 SQLite 文件，Starter 主库不保存完整 transcript。
- [ ] 默认 runtime 使用 Pi `Agent`/`agentLoop`，不调用未实现的 `AgentHarness` 操作。
- [ ] 仓库不存在运行时使用的 `conversation.service.ts`、`conversation.repository.ts`、Conversation Route 或 `tool-orchestrator.ts`。
- [ ] `/api/ai/conversations`、旧 Conversation contracts、generation DTO 和旧 SSE event 已移除。
- [ ] 旧 Conversation 三张表已删除，新 AgentSession 和 AgentRun 表从空数据开始。
- [ ] Provider、Prompt、Skill、Tool 和用量审计继续可用，已有配置数据不被清空。
- [ ] Admin 不再引用 `AiConversation*` 类型、generation API 或 `/api/ai/conversations`。
- [ ] 设计能说明聊天、群聊和 Agent Graph 如何接入，同时不把产品对象放进 Harness 核心。
- [ ] `implement.jsonl` 与 `check.jsonl` 包含真实规范和研究材料，并通过 `task.py validate`。
- [ ] 用户评审并明确批准最新规划后才能运行 `task.py start`。

## 技术约束

- Node.js 版本不低于 Pi package 要求的 `22.19.0`。
- 三个 Pi package 必须固定为同一版本。
- API 保持 `route → service → repository`，Pi runtime 和 Session backend 通过明确 adapter 注入。
- 自有 JSON 接口继续使用 Starter envelope；Run stream 使用 SSE 和 HarnessEvent schema。
- destructive migration 应用后旧 Conversation 数据不可恢复；回滚只能恢复代码并重新初始化空库。
- 后续代码修改必须依次通过 `pnpm check-types`、`pnpm lint`、`pnpm format:check`，再运行测试、构建和数据库检查。
