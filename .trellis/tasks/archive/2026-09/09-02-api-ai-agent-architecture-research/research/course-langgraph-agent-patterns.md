# 课程 LangGraph 与 Agent 编排模式调研

## 调研范围

课程材料：

- `01-ai-companion/articles/05-LangGraph/059-概述.md` 至 `076-运行时上下文.md`
- `01-ai-companion/articles/10-项目实战/Agent 群聊/206-Agent-群聊底座.md` 至 `211-Agent-群聊-@-提及.md`

Starter 对照材料：

- `.trellis/spec/api/backend/ai-system-design.md`
- `.trellis/spec/api/backend/agent-run-guidelines.md`
- `.trellis/spec/api/backend/agent-session-guidelines.md`
- `.trellis/spec/api/backend/pi-agent-execution-guidelines.md`
- `apps/api/src/infra/agent/`
- `apps/api/src/modules/ai/agent/`
- `apps/api/src/modules/ai/run/`

课程里的 LangGraph 示例主要用于讲清节点、状态和控制流。它们不是 Starter 的替代实现。Starter 已经有 Pi Agent loop、Session/lane、持久 RunEvent、Run/Turn/Step、Trace、Tool 权限与审计、启动恢复。适合迁移的是编排契约，不是重新实现这些底层能力。

## 总判断

Starter 可以把当前 Pi Agent executor 视为一种原子 Agent 执行器，在它上面增加显式编排层。编排层负责步骤、路由、并行、暂停和多 Agent 协作；Pi executor 继续负责单个 Agent 内的模型与 Tool loop、消息历史、compaction、steer、follow-up 和 abort。

现阶段不应仅因为“流程看起来像图”就引入 LangGraph。线性且单次请求内完成的流程，用普通 TypeScript 函数和现有 Run/Step 记录更短。出现以下任一需求后，再评估图运行时更合理：

- 分支和回边已经让控制流难以从代码中直接读出。
- 同一工作流包含多个可独立重试、并行或降级的步骤。
- 需要跨请求暂停，等待人工或外部系统输入后继续。
- 需要从持久步骤状态恢复，而不只是把进程中断的 Run 标记为 `interrupted`。
- 一个 Run 要调度多个 Agent，并保留每次选择、交接和汇总的轨迹。

## 一、原子能力

### 可迁移概念

1. **节点只做一个可命名的动作。** 课程把意图识别、Agent 选择、回复生成、质量检查、记忆读取和记忆写回拆成独立节点。Starter 可把每个节点映射为一个有类型输入、类型输出、超时和错误分类的原子步骤。
2. **模型判断与业务执行分开。** Agent 群聊先让模型输出结构化意图、选择或补充回应计划，再由本地代码校验成员是否存在、去重、限制数量和修正模式。模型提出计划，确定性代码决定计划是否可执行。
3. **显式输入输出比共享大对象更重要。** 节点只读取所需字段并返回局部更新。对于 Starter，更适合让步骤返回明确结果，而不是让各模块任意修改一个可变上下文。
4. **运行依赖不进入流程状态。** 课程把 `userId`、`teamId`、`locale` 和 Store 放在 runtime context。Starter 已有 `RunExecutionContext`，其中的 principal、scope、requestId、runId、sessionId 和 lane 应继续由运行时注入，不作为模型可改写的编排数据。
5. **专门 Agent 可作为高层能力。** Supervisor 示例把日程 Agent、邮件 Agent 包成总控可调用的能力。Starter 若采用该模式，应让每个专门 Agent 仍通过现有 AgentDefinition 解析模型、Prompt、Skill 和 Tool allowlist，而不是绕过现有配置与权限层。

### 适用前提

- 每个步骤有稳定名称、输入 schema、输出 schema 和错误类型。
- 步骤能拿到统一的 AbortSignal、Run deadline、principal 和资源 scope。
- LLM 结构化输出经过 Zod 校验，并在业务边界内再次归一化。
- 有副作用的步骤支持幂等键，或能确认不会被恢复机制重复执行。

### 不应照搬

- 不手写课程中的 ReAct `callModel -> callTools -> callModel` 循环。Starter 已由 Pi `Agent` 负责 Tool loop，并在 adapter 中处理 Zod、权限、超时、取消和审计。
- 不直接用 LangChain Tool 替换 Starter Tool Registry。那会绕过版本引用、scope、principal 权限和安全摘要边界。
- 不把 Provider secret、数据库连接、AbortSignal 或完整服务对象塞进可 checkpoint 的 state。
- 不把“拆成节点”理解成每个函数都要成为图节点。只对需要独立路由、重试、观测或恢复的业务步骤建节点。

## 二、运行状态

### 可迁移概念

1. **状态按用途分层。** 课程区分线程状态、跨线程 Store 和运行时 context。映射到 Starter：
   - Session/Pi transcript 保存对话与 lane 历史。
   - Run 保存一次执行的持久状态和配置快照。
   - 编排 state 保存本次工作流的中间产物，例如意图、选择结果、分支状态和汇总结果。
   - `RunExecutionContext` 保存身份、scope、关联 ID 和运行依赖。
   - 长期业务记忆应由独立业务存储负责，不混入 Run checkpoint。
2. **每个字段预先定义更新语义。** 普通结果采用覆盖；并行结果采用追加或按 key 合并；计数器累加；消息按协议合并。课程的 Reducer 概念适合迁移成 Starter 编排状态的字段级合并规则。
3. **并行分支同时保存结果和状态。** 不能只存 `results`，还要记录每个分支是 `running`、`succeeded`、`failed`、`retry`、`deferred` 还是 `overflow`。Starter 现有 Step outcome 已有接近的状态集合。
4. **控制状态与业务结果分开。** `retryCount`、`activeAgent`、`selectedAgentIds`、`replyMode` 和 `lastError` 用于控制流程；回复正文、结构化输出和 Tool 结果属于业务结果。两者都可观测，但生命周期与公开范围不同。
5. **明确状态版本。** Starter 的 Agent Run snapshot 已有 schemaVersion。若增加编排状态，也需要版本字段和解析失败策略，恢复时不能把未知结构当成空状态继续跑。

### 适用前提

- 合并函数是确定性的，重复应用不会产生不可解释结果。
- 并行结果有稳定的 branchId、agentId 或 taskId，不能依赖完成顺序表达业务顺序。
- checkpoint 不保存 secret、完整 Prompt、Tool 参数、原始 Provider 响应或私有长期记忆。
- Session、Run、Step 和编排 checkpoint 的所有权清楚，只有一个服务负责状态迁移。

### 不应照搬

- 不再引入一套 LangGraph Checkpointer 来保存对话消息。Pi Session 已经是 Starter 的 transcript 和 lane 事实源，双写会产生顺序、分支和恢复冲突。
- 不把 LangGraph `thread_id` 直接等同于 Starter Run id。更接近的映射是 `thread_id -> sessionId + lane`，而一次图执行仍应对应独立 runId。
- 不把课程 Store 当成业务数据库替代品。复杂授权、查询、审计和关系数据仍应进入 Starter SQLite 及对应 repository。
- 不使用“最后完成的分支覆盖前面结果”的隐式行为。并行写入必须有明确 reducer 和稳定排序规则。

## 三、编排

### 可迁移概念

1. **普通边表达确定顺序，条件路由表达选择，回边表达重试。** 路由只读取已验证状态，不在路由函数里再次调模型或数据库。
2. **决策与跳转紧密相关时合并处理。** 课程的 `Command` 表达“更新状态并选择下一步”。Starter 不必复刻 API，但可以采用等价返回值，例如 `{ update, next }`，让节点的决策结果与出口保持一致。
3. **动态扇出采用 map-reduce。** 课程的 `Send` 适合“一个任务拆成多份同构输入并行执行”。Starter 可用于多 Agent 独立回答、多个检索源或多份文档处理；汇总前必须等待所有要求的分支进入终态。
4. **串行与并行由数据依赖决定。** Agent 群聊中，后一个 Agent 需要看到前一个 Agent 的回复时用串行；多个 Agent 提供互不依赖的视角时才并行。并行不是默认的性能开关。
5. **先结构化规划，再执行。** 群聊实践先识别意图，再选择 Agent，再决定 `single`、`multi_serial` 或 `multi_parallel`，最后生成与质检。这个顺序适合迁移到需要解释“为什么执行这些步骤”的 Starter 工作流。
6. **用户明确指令优先于模型调度。** `@` 提及在调用 LLM 选择器前直接覆盖选择结果，fallback 路径也保留同一规则。对 Starter 而言，显式 agentId、Tool allowlist、管理员策略和用户确认均应高于模型建议。
7. **子图按业务边界拆。** 一段流程有独立入口、出口、状态或重复使用时再拆子图。父图与子图状态不同时，用显式 adapter 做字段映射。

### 适用前提

- 每个循环同时有业务出口和硬上限，例如最大重试、最大轮数、总时长或预算。
- 并行分支有并发上限、取消策略、部分失败策略和确定性汇总规则。
- 结构化计划经过资源存在性、权限、数量、重复项和引用关系检查。
- 每个节点失败时明确选择：终止、重试、跳过、降级、等待人工，不能统一 catch 后继续。

### 不应照搬

- 不为了可视化把线性四步函数强行改成图。课程的群聊图本身仍是线性流程，收益主要来自步骤命名，不足以单独证明引入框架。
- 不保留普通出边的同时再返回动态跳转，除非确实要两个出口同时执行。课程指出 `Command.goto` 会追加动态边，不会取消普通边。
- 不在一个大 state 中放所有子图内部字段。父图只保留后续步骤真正需要的结果。
- 不让质量检查无限重写。课程采用一次轻量 revision；如需循环，必须限制轮数、成本和内容漂移。

## 四、恢复

### 可迁移概念

1. **恢复分三类。**
   - 传输恢复：SSE 断开后按 sequence 回放或轮询，Starter 已支持。
   - 进程中断定案：启动时根据 Pi `starter.run` 投影终态，否则标记 `interrupted`，Starter 已支持。
   - 工作流断点续跑：从持久步骤边界继续执行，Starter 当前尚未提供通用能力，这是课程 Checkpointer/interrupt 最值得参考的部分。
2. **只在稳定边界保存 checkpoint。** 课程在 super-step 后保存完整状态。Starter 若增加该能力，checkpoint 应对应已提交的 Step 终态，不能在模型 token 流或 Tool handler 执行中间声称可恢复。
3. **暂停是显式终态之外的运行状态。** Human-in-the-Loop 需要保存等待原因、所需输入 schema、当前节点、checkpoint 版本和恢复令牌。恢复请求必须重新校验 principal 与资源 scope。
4. **恢复会重新执行节点时，副作用必须幂等。** 课程明确指出 `interrupt()` 之前的代码会再次执行。Starter 应把写库、发通知、调用外部变更 API 等动作放在确认后，或使用幂等键和已执行记录。
5. **按错误类别决定重试。** 超时、临时上游失败可有限重试；参数、权限和业务前置条件错误直接失败或降级；不确定且风险高的结果转人工处理。
6. **fallback 是已定义路径，不是吞错。** 群聊实践在意图、Agent 选择和补充回应规划失败时使用本地规则，并记录原因。fallback 输出仍要经过正常 schema、权限和审计。

### 适用前提

- 增加 `suspended` 或等价状态，并定义它与 `starting/running/terminal` 的迁移关系。
- checkpoint、Run row、Step row 和副作用记录能在同一事务或可证明的提交顺序下保持一致。
- 恢复命令带 expected checkpoint/version，重复恢复不会执行两次。
- 恢复前重新解析当前 Agent/Tool 配置还是使用 Run snapshot，必须选定一种语义。为了可重放，默认更适合使用启动时 snapshot。

### 不应照搬

- 生产环境不使用 `InMemorySaver` 或 `MemorySaver`。
- 不宣称 checkpoint 能恢复正在进行的 HTTP 请求、模型流或 Tool 进程。只能从最近已提交步骤重新执行。
- 不直接从任意历史 checkpoint 重跑有外部副作用的流程。课程的“时间旅行”适合调试和纯计算；生产分叉需要新的 runId、来源 checkpoint 和幂等策略。
- 不用通用 try/catch 吞掉暂停信号。若框架以特殊异常实现 interrupt，必须让该信号传播到运行时。
- 不把所有失败都自动重试。权限、校验和不可逆业务错误重试不会改善结果。

## 五、观测

### 可迁移概念

1. **观测层级与执行层级一致。** 课程的节点更新、完整状态、模型消息和细粒度事件，可分别映射到 Starter 的 Step、持久 RunEvent、message/thinking delta、model_call/tool_execution。
2. **记录决策输入摘要与归一化结果。** 群聊实践把 intent、selection、speakingContext、crossReplyPlan 和 quality 写入 metadata，能够回答“为什么选择这些 Agent”。Starter 可把安全、有限的决策结果挂到 Step/Trace attributes 或专用结构化输出。
3. **每个分支有稳定关联 ID。** Starter 已有 runId、turnId、stepId、modelCallId、messageId、toolCallId 和 toolExecutionId。多 Agent 编排还需要 branchId/taskId，以及 agentId 和 parentStepId，不能靠时间顺序推断父子关系。
4. **进度流与最终事实分开。** 实时事件用于 UI，Run/Step/Trace 和 transcript 用于恢复与审计。课程的 `updates`、`messages` 和 `streamEvents` 也在表达不同粒度，不能混成一种万能事件。
5. **fallback 和归一化也要留痕。** 应记录模型计划是否被拒绝、实际使用的本地策略、重试次数和最终分支，而不是只记录最终回复。
6. **为运营边界提供指标。** 多 Agent 可观察每轮选择数量、并行度、Agent 发言分布、交接次数、补充回应比例、fallback 比例、质量修订比例、延迟和成本。

### 适用前提

- 先定义公开 RunEvent、管理 Trace 和内部日志各自允许出现的字段。
- Step 名称、kind 和 outcome 是稳定枚举，避免每次实现自由写字符串。
- 决策 metadata 有大小上限和 schema 版本。
- Trace 中的 parentId 能表达 Run -> 编排 Step -> Agent 子 Run/模型调用/Tool 执行的层级。

### 不应照搬

- 不新增一套与现有 RunEvent、Trace 和 OpenTelemetry 平行的 LangGraph 事件协议。应在适配层把图事件投影到现有协议。
- 不把完整 state、Prompt、长期记忆、Tool 参数或模型原始理由写入 metadata。课程示例用于教学，Starter 仍要遵守现有 secret 与内容边界。
- 不把 LLM 的 `reason` 当成事实。可记录它作为模型说明，但实际选择、归一化修改和本地规则命中必须分开记录。
- 不仅靠日志排查。需要持久 Step outcome、attempt、errorCode 和关联 ID，才能在进程重启后还原轨迹。

## 六、多 Agent

### 可迁移概念

1. **先选择协作模式。**
   - Supervisor：总控拆任务、调用专门 Agent、统一汇总。适合需要一个对外入口和统一结果的 Starter 场景。
   - Handoff：把后续多轮控制权交给一个专门 Agent。适合用户明确进入某个领域并希望连续对话。
   - 并行团队：上层拆出互不依赖的任务，各 Agent 并行处理后汇总。
   - Swarm：多个 Agent 可相互交接。灵活度最高，也最难控制，Starter 当前没有优先采用的必要。
2. **专门 Agent 只看完成任务所需上下文。** Supervisor 保留主会话和全局协调信息，专门 Agent 获取缩小后的任务、必要历史、自己的 Tool 与私有记忆。
3. **控制权必须进入持久状态。** Handoff 至少需要 activeAgent、handoffReason、sourceAgent、targetAgent 和生效范围。否则下一轮无法确定由谁接管。
4. **多 Agent 数量与轮数是产品硬限制。** 群聊实践限制每轮最多 3 个首轮 Agent、最多 2 条补充回应、补充回应最多 1 轮。上限由代码和 schema 执行，不由 Prompt 建议。
5. **Agent 间消息保留来源关系。** `replyKind`、`respondToAgentId`、round 和 reason 使补充回应可追踪。Starter 可进一步用 messageId/replyId，而不是仅用 agentId，避免同一 Agent 多条输出时定位不清。
6. **选择器采用“模型计划 + 本地护栏 + 确定 fallback”。** Agent 必须存在、启用、属于允许范围；显式点名优先；重复项去除；最近过度活跃者可降权；结构化输出失败时走可预测规则。
7. **用户始终是协作中心。** Agent 间回应不是无限自治讨论。只有用户任务需要时才触发，且输出应回到用户可理解的结果。

### 适用前提

- 每个 Agent 有独立 AgentDefinition、Tool allowlist、principal/scope 校验和成本预算。
- 子 Agent 的 Run 与父 Run 有稳定父子关联，并能分别 abort、计费和观测。
- 明确会话记忆归属：共享 Session、独立 lane、独立 Session 或仅传任务快照。不能让多个 Agent 隐式共写同一 transcript branch。
- 并行 Agent 的汇总器定义部分失败策略：全失败、部分成功继续、关键分支失败终止。
- Handoff 明确返回条件、持续轮数和用户如何切回，避免永久锁定错误角色。

### 不应照搬

- 不把一个 Agent 包成普通 Tool 后就忽略它的身份、成本、事件和权限。Starter 应把子 Agent 执行保留为可观察的子 Run 或等价实体。
- 不让所有 Agent 共享完整会话、所有 Tool 和所有长期记忆。角色拆分的主要价值之一就是缩小上下文和权限。
- 不默认采用 Swarm。角色间任意交接会放大循环、预算失控、责任不清和恢复困难。
- 不让 Supervisor 同时承担所有具体执行。它应负责分解、选择、汇总和停止条件，具体领域工作交给专门 Agent。
- 不让模型突破用户显式选择、Agent 启用状态、权限、数量、轮数、预算和超时限制。

## 对 Starter 的迁移顺序

### 第一阶段：不引入新运行时，先统一编排契约

- 定义原子步骤的输入、输出、错误分类、attempt 和 outcome。
- 复用现有 Run/Turn/Step、RunEvent、Trace 与 `RunExecutionContext`。
- 对线性流程使用普通 TypeScript 调度器，但要求结构化决策、归一化、fallback 和硬上限。
- 保持 Pi executor 是单 Agent 内部 Tool loop 的唯一实现。

### 第二阶段：补充可组合步骤与并行子任务

- 增加稳定的 workflowStepKind、branchId、parentStepId 和汇总策略。
- 允许一个父 Run 调用多个受限 Agent 子执行，并将子执行关联到父 Step。
- 先支持 Supervisor 和有界 map-reduce，不做通用 Swarm。

### 第三阶段：真实需求出现后再做持久编排恢复

- 增加 suspended/checkpoint/resume 契约、恢复输入 schema 和版本检查。
- checkpoint 只落在已提交 Step 边界，副作用使用幂等键。
- 将图运行时事件适配到现有 RunEvent 和 Trace，不建立第二套公开协议。
- 到这一阶段再比较 LangGraph 与基于现有 Run Service 的小型状态机，选择代码和存储重复更少的一种。

## 最值得保留的设计规则

1. 模型负责提出结构化计划，代码负责验证权限、资源和硬限制。
2. Pi executor 负责单 Agent loop，编排层负责 Agent 之外的步骤与协作。
3. 状态、长期记忆和运行时依赖分开保存。
4. 并行任务必须有 reducer、分支状态、并发上限和汇总规则。
5. 每个循环都有正常出口和硬上限。
6. 暂停恢复只发生在持久步骤边界，恢复可能重跑的副作用必须幂等。
7. 显式用户选择和权限策略始终高于模型调度。
8. 多 Agent 默认采用有总控、有限数量、有限轮数的模式。
9. 图事件适配到现有 RunEvent/Trace，不再建立平行观测系统。
10. 只有控制流、恢复或多 Agent 复杂度达到阈值时才引入图运行时。
