# TypeScript Agent / Graph 编排方案比较

- 检索日期：2026-09-02
- 调研范围：LangGraph JS、Vercel AI SDK、Mastra、保留现有 Pi Agent 运行器
- 资料口径：框架能力只依据官方文档；Starter 适配成本依据当前仓库源码
- 目标读者：后续负责 `apps/api` Agent 架构设计与技术选型的人

## 结论

Starter 当前不适合直接用 Vercel AI SDK 或 Mastra 替换现有 Pi runtime。现有实现已经拥有 Provider 适配、Pi transcript、Tool 审计、Run/Turn/Step 生命周期、结构化输出、顺序事件日志、SSE 回放和租户权限边界。整体替换会先重做这些已完成的能力，之后才开始获得图编排能力。

如果下一阶段已经确定要支持以下任一能力，优先验证 **LangGraph JS 作为现有 Pi runtime 外层的编排器**：

- 人工审批后跨请求继续执行；
- API 进程重启后从已完成节点继续；
- 可检查的条件分支、并行节点和嵌套子图；
- 多 Agent 之间需要独立状态、命名空间和流事件。

LangGraph JS 是四个选择中唯一把 checkpoint、interrupt/resume、subgraph 和 graph stream 都作为同一运行时核心概念提供的方案。试点时应保留 Starter 的 `RunEvent` 和 `ai_run_events` 作为产品事件协议，只把 LangGraph 事件翻译成现有事件，不能让框架协议直接成为公开 API。

但外层接入有一个硬限制：如果把一次完整的 `PiAgentExecutor` 调用包装成一个 LangGraph 节点，checkpoint 只能发生在 Pi 调用前后。Pi 内部的模型调用和 Tool 轮次仍是不可恢复的黑盒。要获得 Turn / Tool 级 durable execution，必须拆分当前 Pi agent loop，或者接受失败后重跑整个 Pi 节点。

如果近期仍是单 Agent、单请求内完成、允许进程重启后把 Run 标为 `interrupted`，则应继续保留现有实现。不要为了可能出现的图需求预先引入第二套状态库和事件系统。

## 评价口径

本文把几个容易混淆的概念分开：

- **对话持久化**：保存 message / transcript，下一轮重新组装上下文。
- **事件持久化**：保存已经发生的输出，客户端可以断线后回放。
- **checkpoint**：保存执行状态、下一执行点和已完成节点结果。
- **interrupt/resume**：主动暂停执行，之后用外部数据继续同一个执行实例。
- **durable execution**：进程或 worker 失败后，不从头开始，而是从持久化执行点继续；副作用需要幂等或由运行时记忆化。

Starter 当前已经有前两项，但没有后面三项。数据库里的 `interrupted` 是重启后的终态，不是可恢复的暂停状态。

适配成本按以下范围评价：

- **低**：只新增依赖和薄适配层，不改变现有 API、存储和构建方式。
- **中**：新增运行时存储或事件翻译层，但可保留现有 Pi、Hono 和公开契约。
- **高**：需要替换 agent loop、模型 / Tool 接口、构建系统、公开流协议或现有数据所有权。

## Starter 当前基线

本地源码显示现有运行路径是：

`Hono route -> RunService -> PiAgentExecutor -> Pi Agent / Tool -> PiEventMapper -> RunEventPublisher -> SQLite + SSE`

已有能力：

- `apps/api/src/infra/agent/agent-executor.ts` 使用 `@earendil-works/pi-agent-core` 执行多轮模型 / Tool loop，支持 abort、steer、follow-up、上下文压缩和并行 Tool。
- `apps/api/src/infra/agent/pi-session-store.ts` 用独立 SQLite 保存 Pi transcript、lane、compaction 和 Run terminal entry。
- `apps/api/src/modules/ai/run/run.service.ts` 管理 Run 状态、lane 互斥、幂等键、终态事务、结构化输出、订阅和启动恢复。
- `apps/api/src/modules/ai/run/run-event.publisher.ts` 先持久化事件，再更新实时投影并广播；事件有单调 `sequence`，增量事件会合并。
- `apps/api/src/infra/agent/pi-event-mapper.ts` 已把 Pi 事件转换为稳定的产品事件，包括 Run、Turn、Step、message、thinking、model call、Tool、compaction 和 source。
- `apps/api/src/modules/flow/flow.route.ts` 已把现有运行服务挂到 Hono，并支持 JSON 启动和 SSE 两种响应。

缺失能力：

- `RunExecutionContext` 的 Turn / Step / Model Call / Tool 状态只在内存中。
- 进程重启时，`recoverInterrupted()` 只能从 terminal entry 修复已经结束但未提交的 Run；没有 terminal entry 的 Run 会被标成 `interrupted`。
- 没有保存“下一节点”或待继续 Tool 的 checkpoint。
- abort、steer、follow-up 依赖进程内 `ActiveRunRegistry`，不能跨进程继续。
- 没有 subgraph 或多 Agent 的状态命名空间。

因此，现有方案的事件回放能力很强，但不等于执行恢复。

## 能力矩阵

| 能力 | LangGraph JS | Vercel AI SDK | Mastra | 现有 Pi 运行器 |
| --- | --- | --- | --- | --- |
| checkpoint | 强。每个 super-step 保存完整图状态；节点级 pending write 可避免重跑同一并行步中已成功节点 | AI SDK Core 无。`ToolLoopAgent` 全在内存；组合 `WorkflowAgent` 后按 workflow step 持久化 | Workflow snapshot 可保存完整执行状态并跨重启恢复；普通 snapshot 重点服务 suspend/resume。Durable Agent 为 Beta | 弱。保存 transcript、Run 配置快照和事件，不保存执行游标 |
| interrupt / resume | 强。`interrupt()` + 同一 `thread_id` + `Command({ resume })`；支持并行 interrupt | Core 有 Tool approval，但不是通用图暂停；subagent 不支持 Tool approval。Workflow SDK hook / WorkflowAgent 可跨长时间恢复 | 强。Workflow `suspend()` / `resume()`、Agent Tool approval 和 Tool runtime suspension 均有正式 API | 无。`interrupted` 是终态；abort 后不能 resume |
| subgraph | 强。Compiled graph 可作为节点；有独立 checkpoint namespace、状态查看和嵌套 stream | 无 graph / subgraph 原语。以普通函数和“Agent 作为 Tool”组合 | 中强。Workflow 可作为父 workflow 的 step；支持嵌套 workflow、并行、分支和循环 | 无。只能自行把另一个 Agent 包成 Tool |
| 多 Agent | 强。官方提供 subagent、handoff、router、custom workflow 等模式；原始 LangGraph 可自定义 | 中。官方 subagent 是父 Agent Tool 调子 Agent；状态、路由和持久化由应用自行设计 | 强。`agents` 属性直接注册 subagent；支持 delegation hook、消息过滤、内存隔离和审批向上传播 | 弱。没有一等多 Agent 调度与命名空间 |
| stream event | 强。typed projection 覆盖 message、state、subgraph、interrupt；原始协议有 Run 内递增 `seq` | 强。UI SSE 协议覆盖文本、reasoning、Tool、step、approval、自定义 data；Core 不自动保存流 | 强。Agent 有文本和完整事件流；Workflow 有结构化生命周期事件；Durable Agent 可用 PubSub/cache 重连 | 强。产品事件最贴合现有 UI / 审计，已持久化并支持按 sequence 回放 |
| durable execution | 强。持久 checkpointer 可从最后成功 super-step 恢复；节点副作用必须可重放或幂等 | Core 无。需额外采用当前仍要求 `workflow@beta` 的 Workflow SDK / WorkflowAgent | Workflow 可跨部署 suspend/resume；Durable Agent 为 Beta，生产常需持久 cache/PubSub 或 Inngest，恢复可能重发 LLM / Tool | 无。进程失败后结束为 `interrupted` |
| Hono 适配 | 中。可在 route 内直接调用 graph；没有官方 Hono adapter；Agent Server 是另一套服务边界 | Core 低；Web API 原语可直接返回 Response。Workflow SDK 官方 Hono 方案要求 Nitro 和编译转换，整体为高 | 低到中。有官方 `@mastra/hono` adapter，可挂到已有 Hono；但自动路由、middleware 和 auth 需要与 Starter 现有边界协调 | 最低。已经完成 |
| 现有 Pi runtime 适配 | 中到高。可把 Pi 调用放入 node 并用 custom stream 转事件；Pi 内部不会自动获得细粒度 checkpoint | 高。直接换 `ToolLoopAgent` 会重做 Pi 层；实验性的 Pi Harness 面向 `pi-coding-agent`，不是当前嵌入式 runtime，且不支持 structured output | 高。没有现成 Pi adapter；把 Pi 包成 workflow step 只能得到外层持久化，替换 Agent 会重做模型和 Tool 层 | 最低。已经完成 |

## 方案分析

### LangGraph JS

#### 直接能力

LangGraph checkpointer 在每个 super-step 保存 `StateSnapshot`，内容包括状态值、下一节点、任务、checkpoint ID 和父 checkpoint。并行 super-step 中单个节点完成后还会写 pending write；同一批次其他节点失败时，恢复不需要重跑已成功节点。

`interrupt()` 会持久化图状态并返回 JSON 可序列化 payload。恢复时使用原 `thread_id` 和 `Command({ resume })`。官方文档同时说明：恢复不是从 JavaScript 函数中的那一行继续，而是从发生 interrupt 的节点开头重跑，因此 interrupt 前的副作用必须幂等，或拆到独立节点。

Subgraph 是正式图原语，可以直接作为父图节点，也可以在节点内调用。父子图状态可共享或显式转换；checkpoint 使用独立 namespace。事件流可以同时读取 messages、values、subgraphs、interrupts 和最终 output。

#### 对 Starter 的接入方式

最小试点应把 LangGraph 放在业务编排层，不替换以下现有模块：

- Pi Provider / Model 调用；
- Tool registry、权限检查和 Tool 审计；
- Pi session transcript；
- `RunEvent` 对外契约和 `ai_run_events`；
- Hono route、principal / scope 和结构化输出。

可先定义一个只含 3 到 5 个节点的外层图，例如 `classify -> pi-agent -> approval -> finalize`。LangGraph `thread_id` 映射 Starter `sessionId` 或单独的 orchestration thread ID；checkpoint ID 与 Starter `runId` 建立关联。节点产生的 LangGraph stream 只作为内部信号，必须转换成现有 `RunEventDraft`。

#### 主要成本与风险

- **双状态源**：LangGraph checkpoint 保存流程状态，Pi session 保存对话，Starter DB 保存 Run / 事件。必须明确各表所有权，不能互相推导终态。
- **粒度限制**：把完整 Pi loop 放进一个节点时，该节点崩溃会整体重跑；现有 Tool 副作用需要幂等键。
- **存储选择**：官方文档把 SQLite saver 定位为本地开发，生产建议持久数据库（例如 Postgres）。这与 Starter 当前本地 SQLite 的部署假设可能不一致。
- **事件翻译**：LangGraph 的 graph/task/checkpoint 事件不能直接替代现有 model call / Tool 审计事件。
- **类型边界**：LangGraph message/state 类型与 Pi `AgentMessage`、Starter Zod contracts 之间需要显式转换。

综合判断：**图能力最匹配，适合作为外层增量引入；不适合一次性替换 Pi executor。**

### Vercel AI SDK

#### AI SDK Core

`ToolLoopAgent` 管理模型、Tool 和 stopping condition，但官方文档明确它在内存中运行。AI SDK 的 workflow pattern 主要是普通 TypeScript 控制流，包括顺序、路由、并行、orchestrator-worker 和 evaluator-optimizer；它们不是带 checkpoint 的 graph runtime。

Subagent 的官方实现是把另一个 `ToolLoopAgent` 包成 Tool。它适合隔离 context 和并行任务，但每次 subagent 调用默认是新上下文，并且官方注明 subagent Tool 不能使用 approval flow。

AI SDK UI stream 协议很完整，适合前端消费；但 resumable stream 指南要求应用自行提供 message 存储、active stream 记录、Redis 和 `resumable-stream`。它解决客户端断线，不会自动让 agent loop 在进程崩溃后从 Tool 边界继续。

#### 组合 Workflow SDK 后

`WorkflowAgent` 把 agent loop 放入 Workflow SDK。Tool 标记为 `use step` 后可以持久化结果、自动重试；hook 支持长时间等待外部输入；Workflow SDK 用 event sourcing 保存 Run、Step、Hook 和 Wait。官方还有 Hono 指南，但要求加入 Nitro、`workflow/nitro` 编译模块并改变 dev/build 入口。

当前官方文档要求 `@ai-sdk/workflow` 搭配 `workflow@beta`。因此，“Vercel AI SDK 支持 durable execution”应写成“AI SDK + Workflow SDK 的组合支持”，不能算作 AI SDK Core 的直接能力。

#### 与 Pi 的关系

AI SDK 已提供实验性的 Pi Harness adapter，但它连接的是 `@earendil-works/pi-coding-agent`，通过 sandbox 运行 coding harness。Starter 当前直接嵌入 `@earendil-works/pi-agent-core`，拥有自己的 Provider、Tool、session 和结构化输出链路。官方还注明 Pi Harness 不支持 structured output。因此它不是现有 executor 的替换件。

`@ai-sdk/workflow-harness` 可以按 Agent step 或时间片保存 harness 状态，但文档要求应用自行持久化多轮 session 的 `resumeFrom`，同时引入 Workflow runtime。这条路比保留现有 Pi executor 再加外层 LangGraph 更改更多。

#### 对 Starter 的判断

- 只采用 AI SDK Core：Hono 接入容易，UI stream 很好，但没有解决本次最关心的 graph checkpoint。
- 采用 Workflow SDK：能解决 durable 和 HITL，但会引入第二套 event sourcing、stream 和 Run 生命周期，还要改变当前 tsx/tsup 构建路径。
- 替换 Pi：需要重做 Provider 兼容、Pi transcript、审计和结构化输出。

综合判断：**适合新建 AI SDK UI / Agent 项目，不适合作为 Starter 当前图编排的首选。**

### Mastra

#### 直接能力

Mastra workflow 提供 schema 化 step、顺序、并行、branch、loop、workflow-as-step、stream、suspend/resume 和 time travel。Snapshot 包含步骤状态、已完成输出、执行路径、暂停节点和重试信息，存入配置的 storage；同一 `runId` 可以跨部署和进程重启恢复。

多 Agent 是一等能力：父 Agent 通过 `agents` 注册 subagent，支持 delegation start/complete hook、消息过滤、独立 memory thread 和 Tool approval 向父级 stream 传播。Workflow-as-step 可以承担 LangGraph subgraph 的大部分组合用途，但它不是共享 channel / checkpoint namespace 模型，状态接口更偏显式 schema 数据流。

Agent 和 workflow 都有结构化事件流。Mastra 还提供 AI SDK stream 转换器，方便接 `useChat`。

#### Durable Agent 的成熟度

Mastra 官方把 Durable Agent 标记为 Beta。它把普通 Agent loop 放进 workflow，并用 PubSub + event cache 支持断线重连。默认 cache 是进程内存；跨进程重连需要 Redis 等持久 backend。生产执行可接 Inngest，以获得 step memoization、retry 和监控。

进程异常退出后，运行记录会先停留在 `running`，不会自动重试。配置 `recovery.durableAgents: 'auto'` 后，启动时可从最近 snapshot 重新驱动，但官方警告这会重新发起 LLM 调用并重新执行 Tool，所以 Tool 必须幂等。

这意味着 Mastra 的普通 workflow suspend/resume 已经清晰可用，但“任意 Agent loop 崩溃后无重复副作用地继续”仍需要应用设计和外部运行器支持。

#### 对 Starter 的接入方式与成本

Mastra 有官方 `@mastra/hono` adapter，可以把自动路由注册到现有 Hono app，也允许自定义 prefix、middleware 和 auth。HTTP 层适配成本是三种框架中最低的。

真正成本在运行层：

- Mastra Agent 使用自己的 model、Tool、memory、storage 和 event 定义，没有现成的嵌入式 Pi adapter。
- 把 `PiAgentExecutor` 包成 Mastra workflow step，只能在 step 边界恢复，和 LangGraph 外层包装有同样的黑盒问题。
- 使用 Mastra Agent 替换 Pi 会重复实现 Starter 已有 Provider、Tool 权限、Pi transcript、模型调用审计和结构化输出。
- Mastra storage 会管理 workflow snapshot、memory 和 observability domain；需要决定是否使用单独的 libSQL/Postgres，还是实现与现有 Drizzle schema 对接的 storage adapter。
- `MastraServer.init()` 会自动注册 context、auth、middleware 和 routes；Starter 已有同类边界，直接挂载前要避免路由和权限重复。

综合判断：**如果未来希望采用一体化 Agent 平台、Studio、内存和工作流，Mastra 值得单独试点；若只补 graph durability，它比 LangGraph 引入的重叠能力更多。**

### 保留现有 Pi 运行器

#### 优点

- 对 Hono、Better Auth、Drizzle、SQLite、Zod contracts 和现有 Admin / Web 消费方式完全匹配。
- 产品事件已经比通用框架事件更贴合当前审计和 UI。
- Provider、Tool、结构化输出、附件、telemetry、幂等和多租户边界只维护一套。
- 当前单 Agent 请求不承担额外 checkpoint 写放大和框架状态转换。

#### 缺点

- 要新增 graph、checkpoint、HITL、subgraph 和多 Agent，需要自行设计状态 schema、执行游标、重放语义、版本迁移、并行写冲突和副作用幂等。
- 现有 `RunEvent` 日志只能说明“发生了什么”，不能直接推导“下一步执行什么”。
- 现有恢复只处理终态提交不完整，不能继续活跃执行。
- 一旦自行实现持久化 graph runtime，维护范围会接近 LangGraph / Workflow SDK 的核心部分。

综合判断：**适合保持当前功能；不适合自行扩建成通用 durable graph engine。**

## 推荐顺序

### 1. 先确认是否真的需要 durable graph

只有出现以下可验收需求时才引入框架：

- 一个 Run 必须等待人工输入数小时或数天后继续；
- API 进程重启后必须从已完成节点继续；
- 用户能看到并操作父子 Agent 的执行树；
- 编排定义包含可复用子图、并行分支或条件路由；
- Tool 副作用有稳定幂等键，可以安全重放。

如果这些需求不存在，继续使用现有 Pi 运行器。

### 2. 首选做 LangGraph 外层试点

试点只验证以下内容：

1. 两个普通节点、一个 Pi Agent 节点和一个 interrupt 节点。
2. 使用持久 checkpointer，重启 API 后恢复 interrupt。
3. LangGraph stream 转成现有 `RunEventDraft`，公开 SSE 契约不变。
4. Pi 节点失败后整节点重跑，验证 Tool 幂等键能阻止重复副作用。
5. 父图和一个 subgraph 的事件能映射到现有 Run / Step 关联字段。

试点不应同时替换 Provider、Tool registry、Pi session 或 Run API。

### 3. Mastra 作为平台化备选

当需求同时包含 Hono 自动 API、Studio、Agent memory、workflow、subagent、持久化和可观测平台，并且团队接受逐步迁移现有运行层时，再比较 Mastra。正式采用 Durable Agent 前应先验证 Beta API、跨进程 PubSub/cache、启动恢复重复调用和现有权限 middleware 的组合行为。

### 4. 不把 Vercel AI SDK 当作 graph engine

AI SDK 可以作为 UI stream 或新模型调用层候选；需要 durable execution 时必须把 Workflow SDK 一并纳入架构与成本。当前 Pi Harness 是实验性 coding harness adapter，不能作为 Starter 嵌入式 Pi runtime 的迁移依据。

## 决策摘要

| 当前目标 | 选择 |
| --- | --- |
| 保持现有单 Agent 能力，减少改动 | 保留现有 Pi 运行器 |
| 在保留 Pi 和产品事件的前提下增加 graph / HITL / checkpoint | LangGraph JS 外层编排 |
| 接受更大运行层迁移，想统一 Agent、workflow、memory、Studio 和 Hono adapter | Mastra |
| 新项目优先 AI SDK UI，且愿意同时采用 Workflow SDK / Nitro | Vercel AI SDK + Workflow SDK |
| 只想把现有事件日志改名为 checkpoint | 不成立；事件日志缺少执行游标和下一节点 |

## 官方来源

以下链接均于 2026-09-02 检索。

### LangGraph JS / LangChain

- [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)
- [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [Subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)
- [Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- [Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [Multi-agent systems](https://docs.langchain.com/oss/javascript/langchain/multi-agent)

### Vercel AI SDK / Workflow SDK

- [Agents overview](https://ai-sdk.dev/docs/agents/overview)
- [Workflow patterns](https://ai-sdk.dev/docs/agents/workflows)
- [Subagents](https://ai-sdk.dev/docs/agents/subagents)
- [WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent)
- [UI stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [Chat message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)
- [Resumable streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- [AI SDK Harnesses](https://ai-sdk.dev/docs/ai-sdk-harnesses)
- [HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)
- [Pi Harness](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi)
- [Harness workflow utilities](https://ai-sdk.dev/docs/ai-sdk-harnesses/workflow-utilities)
- [Workflow SDK AI Agents](https://workflow-sdk.dev/docs/ai)
- [Workflow SDK Human-in-the-loop](https://workflow-sdk.dev/docs/ai/human-in-the-loop)
- [Workflow SDK Hono](https://workflow-sdk.dev/docs/getting-started/hono)
- [Workflow SDK event sourcing](https://workflow-sdk.dev/docs/how-it-works/event-sourcing)

### Mastra

- [Workflow overview](https://mastra.ai/docs/workflows/overview)
- [Workflow control flow](https://mastra.ai/docs/workflows/control-flow)
- [Snapshots](https://mastra.ai/docs/workflows/snapshots)
- [Suspend and resume](https://mastra.ai/docs/workflows/suspend-and-resume)
- [Subagents](https://mastra.ai/docs/subagents)
- [Agent human-in-the-loop](https://mastra.ai/docs/agents/human-in-the-loop)
- [Streaming](https://mastra.ai/docs/guides/streaming)
- [Durable agents](https://mastra.ai/docs/harness/durable-agents)
- [Storage](https://mastra.ai/docs/storage)
- [Workflow runners](https://mastra.ai/docs/deployment/workflow-runners)
- [Server adapters](https://mastra.ai/docs/server/server-adapters)
- [Hono adapter](https://mastra.ai/reference/server/hono-adapter)

## 本地源码依据

- `apps/api/package.json`
- `pnpm-workspace.yaml`
- `apps/api/src/bootstrap/create-runtime.ts`
- `apps/api/src/infra/agent/agent-executor.ts`
- `apps/api/src/infra/agent/run-execution-context.ts`
- `apps/api/src/infra/agent/pi-event-mapper.ts`
- `apps/api/src/infra/agent/pi-session-store.ts`
- `apps/api/src/modules/ai/run/run.service.ts`
- `apps/api/src/modules/ai/run/run-event.publisher.ts`
- `apps/api/src/modules/ai/ai.schema.ts`
- `apps/api/src/modules/flow/flow.route.ts`
- `packages/contracts/src/ai.ts`
