# 调研 api-ai Agent 架构优化方向

## Goal

从课程中的 LangGraph、单 Agent、多 Agent、子图、恢复和状态管理概念中，挑选适合当前 Starter 的部分，给出一条不重写 Pi Agent loop、可以逐步提升原子性、运行稳定性和第三方组合能力的架构路线。

目标读者是后续维护 `apps/api` AI 运行面、接入新产品模块和设计外部 Agent API 的开发者。调研结果需要能直接回答先改什么、哪些能力继续复用、何时才值得引入图运行时。

## Confirmed Facts

- 当前 `api-ai` 已经是单 Agent Harness，不是模型转发接口。现有能力包括 Pi Agent Tool loop、持久 Session、Run 幂等、严格 Tool 版本、结构化输出、RunEvent、SSE 回放、Trace、用量审计、第三方 Bearer scope 和终态 Webhook。
- Pi 当前可直接复用 `pi-ai`、`pi-agent-core Agent`、Session API 和 SQLite backend；`AgentHarness` 的执行、恢复、观察、队列和 lane facade 仍会抛 `HarnessNotImplemented`，不能接入生产主流程。
- 当前稳定范围是单进程执行一个 Agent Run。进程重启时可以保留事件与 transcript，并把未完成 Run 标为 `interrupted`，但不能从已完成 Step 继续执行。
- 同一 Session lane 的排他依赖进程内 `ActiveRunRegistry`。Pi SQLite backend 还有单 Session 单写者租约，多实例部署需要明确执行 owner、session affinity 或可跨实例的持久 lease。
- Run snapshot 不能完整还原当时解析后的 Prompt、Skill、Tool 和 Output Contract。Prompt 与 Skill 可原地修改，历史 Run 缺少不可变 resolved manifest。
- AgentDefinition 描述的是一个 Pi Agent loop，不是可独立调度、重试和恢复的步骤集合。第三方产品可以发现并运行管理员配置的 Agent，但拿不到 typed executable manifest，也不能组合受允许的原子能力。
- 课程中最适合迁移的是显式步骤、结构化决策、条件路由、有界并行、状态分层、checkpoint、interrupt/resume 和有总控的多 Agent 模式。课程里的 ReAct loop、LangChain Tool、MemorySaver 和完整状态对象不应照搬。
- LangGraph JS 适合放在 Pi executor 外层，管理节点、条件、并行、子图和 checkpoint。它不能自动恢复 Pi Agent 节点内部正在进行的模型或 Tool 操作；若整个 Pi loop 是一个节点，失败后只能重跑整个节点。
- Vercel AI SDK Core 不是 durable graph runtime；Mastra 与现有 Pi、Tool、Session 和事件体系重叠较多。当前候选顺序是保留 Pi 单 Agent 运行器，真实需要 durable graph 时试点 LangGraph 外层编排。

## Requirements

- 保留 `pi-ai`、`pi-agent-core Agent`、Pi Session backend 和现有产品 `RunEvent` 作为主路径，不另写模型 Tool loop，不把未完成的 Pi `AgentHarness` 接入生产。
- 明确原子执行单元的输入、输出、错误、attempt、timeout、retry、idempotency 和副作用声明。
- 明确 Session transcript、产品 Run、编排 state、runtime context、长期业务记忆和 checkpoint 的状态归属，避免双写同一事实。
- 给出持久执行所有权、启动 readiness、Run attempt/checkpoint、不可变 resolved manifest 的优先顺序。
- 给出第三方 executable manifest、受 policy 限制的组合方式、事件订阅和 Tool adapter 的接口方向。
- 明确何时使用普通 TypeScript 调度器，何时升级为 LangGraph；不为了可视化或线性流程引入图运行时。
- 多 Agent 首先支持 Supervisor 和有界 map-reduce，暂不以 Swarm 作为基础能力。
- 方案必须保持现有 Hono、Drizzle、Better Auth、Zod contracts、SSE 和 Admin 管理边界，不让框架类型成为公开 API。

## Acceptance Criteria

- [x] 形成课程概念到 Starter 能力的取舍表，逐项说明采用、延后或拒绝的原因。
- [x] 形成当前执行链、状态所有权和主要稳定性缺口的源码证据。
- [x] 比较 Pi 复用范围、LangGraph JS、Vercel AI SDK、Mastra 与保持现状的成本。
- [x] 给出目标分层、核心 contracts、状态流、失败与恢复语义，以及第三方接入边界。
- [x] 给出按风险和依赖排序的实施路线，每一阶段有可验证结果和明确非目标。
- [x] 设计文档中的架构、状态或数据流使用暗色 Mermaid 图。
- [x] 不修改产品代码，不安装依赖，不启动实现任务；用户确认后再决定是否拆分后续实现任务。

## Out Of Scope

- 本任务不实现 LangGraph、聊天、群聊、React Flow 编辑器或多 Agent 产品。
- 本任务不替换现有 Pi executor、Provider、Tool registry、Pi Session 或 RunEvent。
- 本任务不设计通用插件市场、任意第三方代码执行、多区域部署或无限自治 Agent。
- 本任务不承诺恢复正在进行的模型流或 Tool 进程，只讨论从已持久化步骤边界继续。

## Key Decision

- 第一阶段先稳固原子契约与执行基础，不交付 durable graph。LangGraph 只作为后续隔离试点，用于验证 checkpoint、interrupt/resume、subgraph 和外层多 Agent 编排。
- 第一阶段继续沿用现有行为：进程中断且没有 Pi terminal entry 的 Run 标为 `interrupted`，不宣称可以续跑。
