# Pi Agent Harness 基础重构

## Goal

把 Starter 当前自行维护的 AI Conversation runtime 替换为基于 Pi Agent 和 Pi Session 的通用 Harness。最终产品代码只保留 Agent、Session、Run 和 Event 这组公开对象，不保留旧 Conversation API、旧 generation 状态机或兼容层。

本任务是父任务，只保存共同需求、子任务顺序和跨子任务验收，不直接修改产品代码。

## Background

原计划把依赖、contracts、数据库、Pi adapter、AgentDefinition、执行核心、Session/Run API、Admin 页面和破坏性切换放在一个任务内完成。实施时确认该范围无法稳定执行：共享 contracts 会先于调用方被替换，数据库删除与新 runtime 尚未就绪，Admin 和 API 必须同时完成，任何中间状态都难以通过仓库质量门。

用户已确认改为父子任务，并允许实施期间暂时保留旧 Conversation runtime。前置子任务只增加 Harness 能力，不做双写、不转换数据、不让旧 runtime 读取新 Session。最后一个子任务统一删除旧实现和旧数据。

## Source Requirements

### SR-1 Pi 责任

- 模型、Provider、认证和 stream 继续使用 `@earendil-works/pi-ai`。
- Agent loop、Tool 调用、队列和运行事件使用 `@earendil-works/pi-agent-core` 的 `Agent` 或 `agentLoop`。
- Session history、tree、lane、branch、records 和 compaction 使用 Pi Session API。
- Node.js 持久化使用 `@earendil-works/pi-session-backend-sqlite-node`。
- 不复制 Pi 已有的 loop、Session reducer、writer lease、FTS、token 估算或 compaction 算法。
- 当前发布版 `AgentHarness` 的关键方法未完成，产品代码不得依赖这些方法。

### SR-2 Starter 责任

- Better Auth 继续负责身份。
- Drizzle 主库保存 AgentDefinition、Session 业务索引、Run 索引、权限关系和用量审计。
- Pi 的独立 SQLite 保存 transcript、tree、lane、records 和 compaction。
- API 保持 `route -> service -> repository`；Pi runtime 和 Session backend 通过 adapter 注入。
- `packages/contracts` 只保存跨端 Zod schema、DTO、事件和错误码。

### SR-3 Harness 对象

- `AgentDefinition` 是 Admin 管理的可复用执行配置，引用模型、Prompt、Skill 和 Tool。
- `AgentSession` 是用户拥有的持久上下文，不绑定单个 Agent。
- `AgentRun` 是某个 Agent 在指定 Session 和 lane 上的一次执行。
- `HarnessEvent` 是稳定运行事件；SSE 只是其中一种传输方式。
- 同一 `sessionId + lane` 同时只允许一个写 Run。
- SSE 断开不取消 Run，只有显式 abort 改变运行状态。

### SR-4 权限与数据

- Admin 管理 Provider、模型、Prompt、Skill、Tool allowlist、AgentDefinition 和用量审计。
- 普通已登录用户只能读取已启用 Agent、管理自己的 Session、执行可用 Agent。
- Provider secret 不得进入 AgentDefinition、Run snapshot、Session metadata、SSE 或公开 DTO。
- 不增加组织、租户、复杂 ACL 或用户创建 Agent 的所有权字段。

### SR-5 最终破坏性切换

- 删除 `/api/ai/conversations`、旧 Conversation contracts、generation DTO、旧 SSE event 和旧错误码。
- 删除 Conversation Service、Repository、Presenter、Route、generation 状态机和自有 Tool Orchestrator。
- 删除 `ai_conversations`、`ai_conversation_messages` 和 `ai_generations`。
- 不迁移、不导出、不备份旧 Conversation 数据。
- 保留 Provider、模型、Prompt、Skill、Tool Registry 和用量审计数据。
- `ai_model_calls` 最终删除旧 `conversationId`、`generationId`，保留 nullable `runId`；旧审计记录允许 `runId=null`。

## Task Map

| 顺序 | 子任务 | 交付结果 | 独立验收 |
| --- | --- | --- | --- |
| S1 | `08-18-pi-session-storage-foundation` | Pi 依赖、独立 Session DB、存储 adapter | 临时 Session DB 的创建、读取、隔离和关闭测试通过 |
| S2 | `08-18-agent-harness-contracts-schema` | 新 contracts 与增量主库表 | 新旧契约和表并存，全仓检查通过 |
| S3 | `08-18-agent-definition-management` | AgentDefinition API 与 Admin 管理 | Admin CRUD、普通用户只读、revision 测试通过 |
| S4 | `08-18-pi-agent-execution-core` | Pi Executor、事件映射、Tool 和审计 | 无 HTTP 依赖的执行、Tool、abort 和事件测试通过 |
| S5 | `08-18-agent-session-api` | Session 索引、归属和 transcript API | Session 创建、读取、归档、补偿和隔离测试通过 |
| S6 | `08-18-agent-run-api` | Run、SSE 和运行控制 API | 运行、并发、abort、断线和恢复测试通过 |
| S7 | `08-18-admin-agent-harness-ui` | Admin Harness 调试页面 | 创建 Session、运行 Agent、查看 transcript 和 Tool 活动的前端测试通过 |
| S8 | `08-18-conversation-destructive-cutover` | 删除旧 runtime、旧 UI 和旧数据表 | 静态删除检查、迁移测试和全仓质量门通过 |

## Ordering Rules

- S1 和 S2 是基础任务，均完成后再做 S3 至 S5。
- S3 依赖 S2。
- S4 依赖 S1 和 S2；与 S3 的集成在 S6 完成。
- S5 依赖 S1、S2 和 S3。
- S6 依赖 S3、S4 和 S5。
- S7 依赖 S3、S5 和 S6。
- S8 必须等待 S1 至 S7 全部归档。
- 父子关系不代替依赖声明；每个子任务在自己的 PRD 和实施计划中重复写明前置条件。

## Coexistence Rules

- S1 至 S7 允许旧 Conversation runtime 和新 Harness 同时存在于代码库。
- 新 Harness 使用新 API、新表和独立 Session DB；旧 runtime 继续使用旧 API 和旧表。
- 任何一次模型调用只能属于旧 generation 或新 Run，不同时写两组关联字段。
- 不增加 facade、数据同步、数据转换、fallback read 或 feature flag。
- S1 至 S7 每个子任务结束时，旧功能和已完成的新功能都必须可编译、可测试。
- S8 完成后，产品代码不得再出现旧 Conversation runtime。

## Cross-Child Acceptance Criteria

- [ ] 八个子任务各自完成规划、实施、质量检查和归档。
- [ ] Pi Session 使用独立 SQLite 文件，Starter 主库不保存完整 transcript。
- [ ] 默认 runtime 使用 Pi `Agent` 或 `agentLoop`，不调用未实现的 `AgentHarness` 方法。
- [ ] AgentDefinition、AgentSession、AgentRun 和 HarnessEvent 的公开契约通过 Zod 验证且不包含 secret。
- [ ] S1 至 S7 使用同一份 Harness 字段、事件、terminal entry、错误码和数据库结构定义，不在子任务内增加第二套协议。
- [ ] 同一 Session lane 的并发写入被拒绝，SSE 断开不自动 abort。
- [ ] Provider、Prompt、Skill、Tool Registry、模型策略和用量审计继续可用。
- [ ] Admin 可以管理 AgentDefinition，并完成 Session/Run 调试流程。
- [ ] 旧 Conversation API、runtime、contracts、Admin 页面和三张数据表全部删除。
- [ ] 旧 Conversation 数据不迁移、不导出、不备份；新 Session store 从空库开始。
- [ ] `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build` 和 `pnpm --filter @starter/api db:check` 全部通过。

## Out of Scope

- 旧 Conversation 数据迁移、导出、备份或恢复。
- 好友、群聊、房间、成员、消息已读和通知。
- Web 聊天产品页面。
- React Flow 页面、Graph DSL、LangGraph、checkpoint 和工作流调度器。
- 多进程 Event 总线、分布式队列、跨节点 Run 恢复和水平扩容。
- `pi-coding-agent` 的 cwd、编码工具、CLI resource loader 或 extension 系统。
