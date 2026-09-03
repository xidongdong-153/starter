# api-ai Agent 架构实施路线

本文件是后续实现任务的拆分依据。本次调研任务不修改产品代码，不执行以下清单。

## 总体顺序

```text
A. 执行所有权
  -> B. 不可变执行事实
  -> C. Run / Attempt / Step
  -> D. 可发现、可组合的运行接口
  -> E. 有界编排
  -> F. LangGraph 隔离试点
  -> G. 远程 Tool 与事件订阅
```

A、B、C 应各自创建 Trellis 子任务并独立 migration、测试和提交。D 依赖 B、C。E 依赖 C、D。F 依赖 C、E 和 Tool 副作用策略。G 依赖 D，远程写 Tool 还依赖 C。

## 进度勾选规则

- 每个阶段完成后，先跑完该阶段的验证命令，再回到本文件勾选对应阶段的已完成项；没有验证过的条目不勾选。
- 阶段拆成子任务实施时，子任务归档前要同步勾选本文件中的对应条目；子任务自己的 prd 和 implement 记录实施细节，本文件只跟踪阶段条目的完成状态。

## 阶段 A：持久执行所有权与启动门禁

目标：多实例或进程重启时，不让两个 owner 同时执行同一 Session lane。

- [X] 明确部署模型：单 API 实例、session affinity，或独立 worker owner。（09-02-ai-run-durable-lease：单实例部署 + 多实例规格 lease）
- [X] 为 logical Run 或 Session lane 增加持久 lease：`ownerId`、`leaseUntil`、`heartbeatAt`、fencing token。（ai_agent_lane_leases 表）
- [X] lease 领取、续租、释放使用条件更新，过期 owner 不能继续提交状态。（run/lane-lease.ts + 终态事务 fencing）
- [X] 把影响执行所有权的恢复扫描放入 AI runtime readiness，路由接收新 Run 前必须完成。（AiServices.readiness）
- [X] 进程内 `ActiveRunRegistry` 只保存 controls 与 subscriber，不再承担唯一排他语义。
- [X] 验证两个独立 runtime 对共享数据库启动同 lane 时只有一个成功。（ai-lane-lease.test.ts）
- [X] 验证 owner 失效、lease 过期、旧 owner 晚到提交和新 owner 接管。（ai-lane-lease.test.ts）

验证命令：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
```

回滚点：删除 lease 相关 migration 与 service 逻辑，恢复“只支持单实例”的文档限制。不要保留数据库 lease 和内存 lease 两套都能决定执行权的路径。

：不可变资源版本与 resolved manifest

目标：历史 Run 能证明当时实际使用了哪些模型、Prompt、Skill、Tool 和 Output Contract。

- [x] 给 Prompt 与 Skill 增加不可变 revision；编辑操作创建新 revision，不原地覆盖已发布内容。
- [x] Agent Revision 固定引用资源 revision，不只引用可变 ID。
- [x] 为 Tool manifest 和 Output Contract schema 生成稳定 hash。
- [x] Run 启动时生成 `ResolvedRunManifest`，在进入 executor 前持久化。
- [x] 明确敏感 Prompt 的保存方式：加密内容、受控历史表或可找回的 revision；不能只保存无法还原的 hash。
- [x] 历史结构化输出读取不再依赖当前进程仍注册同名 contract。
- [x] 增加只读 manifest presenter，去除 secret、完整 Prompt 与内部 handler 信息。
- [x] 验证资源后续修改不会改变旧 Run 的 manifest 与读取结果。

验证重点：

- 相同 Agent revision 在不同时间解析出相同 manifest hash。
- 内联 system prompt 有明确保存与审计语义。
- 删除当前 registry item 后，历史 output contract 仍可按旧版本读取。

回滚点：保留新增 revision 数据，不把历史记录重新压回可变资源表。

## 阶段 C：logical Run、Attempt、Step 与副作用策略

目标：把调用幂等、执行重试、步骤事实和外部副作用分开表达。

- [x] 明确现有 `ai_agent_runs` 是 logical Run，或新增 logical Run 表并迁移引用。
- [x] 增加 Attempt：序号、owner、开始/结束、错误、来源 checkpoint 和 retry reason。
- [x] 扩展 Step：稳定 kind、parentStepId、branchId、attempt、输入/输出引用、timeout、outcome、errorCode。
- [x] 为每次 Step/Tool execution 生成稳定 `idempotencyToken`。
- [x] Tool manifest 声明 `read_only`、`idempotent_write` 或 `non_idempotent_write`。
- [x] retry policy 只对明确错误与副作用类别生效；logical Run 的原 idempotency key 不变。
- [x] 不确定的非幂等写进入人工判断状态或明确失败，不自动 retry。
- [x] 现有 Pi Agent loop 先作为一个 `agent` Step，内部 turn/tool 继续走原有 Trace 与 RunEvent。
- [x] 验证失败后新 Attempt 与原 logical Run、Step 和事件关联正确。

验证重点：

- invocation 重放不创建新 logical Run。
- retry 创建新 Attempt，不创建无关联 Run。
- 外部写成功但本地提交前中断时，稳定 token 能阻止重复写。
- 旧 owner 不能提交新 Attempt 的结果。

回滚点：先停止自动 retry，再回滚 Attempt 调度；保留已经产生的历史 Attempt/Step 数据。

## 阶段 D：Executable Manifest 与窄运行端口

目标：项目内产品和第三方能发现、校验并调用已发布 capability，不依赖整个 `AiServices`。

- [ ] 在 `packages/contracts` 定义 `ExecutableManifest`、typed input/output、controls、event version 和弃用状态。
- [ ] 定义 `AgentRuntimePort`：start、get、subscribe、abort、steer、follow-up、transcript、outputs。
- [ ] chat、flow 等产品模块通过窄 port 调用，共享 JSON/SSE transport adapter，不复制 Accept 分流与订阅代码。
- [ ] 增加第三方只读 manifest 接口，保留跨 scope 404 与 Bearer policy。
- [ ] app credential policy 指定可调用 capability、版本范围、controls 和调用限额。
- [ ] 第一版只允许调用管理员发布的 Agent capability，不开放任意内联 Prompt 或任意 Tool 组合。
- [ ] Webhook 增加结果引用、event sequence 与受限 correlation metadata，或增加持久事件订阅接口。
- [ ] 明确 SSE 无 terminal EOF、subscriber overflow 和重连提示。

验证重点：

- 第三方无需管理端配置详情即可判断 input/output 和支持的 controls。
- manifest 不包含 secret、Prompt 正文、Tool handler 或内部网络地址。
- 项目内产品不导入 Pi 类型、repository 或 concrete `AiServices`。
- JSON、SSE、Timeline 与 Webhook 仍使用同一 RunEvent 事实。

回滚点：撤回 manifest 与组合 policy 接口不影响已有 Session、Run 和 Timeline 读取。

## 阶段 E：有界 TypeScript 编排

目标：在不引入图框架的情况下，支持少量已审核的顺序、条件和并行流程。

- [ ] 定义 `WorkflowRuntimePort` 与 `StepExecutor`，不包含 LangGraph 类型。
- [ ] 只支持代码内注册 workflow，不接收第三方任意 graph JSON。
- [ ] 每个 Step 使用 Zod 输入输出、Run deadline、AbortSignal、budget 和 retry policy。
- [ ] 条件路由只读取已持久、已校验的 Step output。
- [ ] 并行分支有 branchId、并发上限、稳定 reducer、取消策略和部分失败策略。
- [ ] 首个多 Agent 模式只做 Supervisor 或固定 map-reduce。
- [ ] 子 Agent 使用 child Run/Step，并记录 parentRunId、parentStepId 与 branchId。
- [ ] 把选择、归一化、fallback 与汇总结果写入安全 Trace attributes。
- [ ] 明确循环最大次数、最大 Agent 数、总时长和总费用。

候选验收流程：

```text
classify -> parallel(agent A, agent B) -> deterministic merge -> final agent
```

该流程必须一次请求内完成；进程中断后仍按第一阶段规则标记 `interrupted`。

回滚点：删除 workflow registry 和 orchestrator 后，单 Agent Runtime 继续工作。

## 阶段 F：LangGraph JS 隔离试点

启动条件：出现已经确认的 durable checkpoint、HITL、subgraph 或复杂多 Agent 需求，并且阶段 A 至 E 已完成相关基础。

- [ ] 新建独立 Trellis 试点任务，不直接替换生产 Pi 主路径。
- [ ] 选择 3 至 5 个节点：确定性节点、Pi Agent 节点、interrupt 节点、finalize 节点。
- [ ] 使用持久 checkpointer；SQLite 只用于本地/单实例验证，生产存储另行评估。
- [ ] `thread_id`、runId、checkpointId 和 Pi `sessionId + lane` 使用显式映射，不互相等同。
- [ ] LangGraph state 不保存 Pi transcript、secret、完整 Prompt 或数据库连接。
- [ ] 把 graph event 转换为现有 Step、RunEvent 和 Trace，不建立第二套公开 SSE。
- [ ] 重启 API 后从 interrupt 恢复，并用 expected checkpoint/version 防止重复 resume。
- [ ] 验证 Pi Agent 节点失败后整节点重跑；带副作用 Tool 通过稳定 token 去重。
- [ ] 验证 subgraph namespace、并行 pending write 与父子事件关联。
- [ ] 记录试点后能删除的自建代码；如果只是增加第二套状态机且没有减少实现，停止采用。

通过门槛：

- checkpoint 与 Run/Step 终态顺序可证明。
- 恢复不会重复不可逆副作用。
- 公开 API 与现有客户端不依赖 LangGraph。
- 单 Agent 延迟、写放大和错误可诊断性可接受。

回滚点：关闭 adapter 注册并删除试点 checkpointer；现有 TypeScript orchestrator 与 Pi executor 保持可用。

## 阶段 G：远程 Tool 与更丰富第三方组合

目标：在执行和权限基础稳定后，允许受控外部能力接入。

- [ ] 定义统一 Tool execution port，本地 Tool 先迁移到该 port。
- [ ] 按真实需求选择 MCP 或 OpenAPI/HTTP adapter，不同时实现全部协议。
- [ ] 远程 Tool manifest 包含 schema、认证引用、网络 policy、timeout、side effect、幂等与审计规则。
- [ ] URL guard、private network 限制、响应大小、内容类型和 secret 读取由 API adapter 处理。
- [ ] 中间 RunEvent 订阅按 event type、sequence、签名和 delivery retry 投递。
- [ ] 第三方 workflow template 只能引用 policy 允许的 capability 与版本。
- [ ] 对弃用 manifest、版本删除、运行中升级和历史结果读取建立测试。

回滚点：禁用远程 adapter 不影响本地 Tool 与历史 Run；认证引用不写入 manifest 或事件。

## 全程检查

每个实现任务都要执行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
```

涉及 migration 时额外执行：

```bash
pnpm --filter @starter/api db:generate
pnpm --filter @starter/api db:check
pnpm --filter @starter/api db:migrate
```

每个阶段完成前检查：

- 公开 schema、OpenAPI、route、service、repository、presenter 与测试一致。
- product app 与 Starter user 的 scope 行为一致，跨 scope 仍返回 404。
- 事件先持久化再广播，终态最多一个。
- secret、Prompt 正文、Tool 参数与原始模型内容没有进入公开 manifest、日志或 Webhook。
- 新状态只有一个写入 service，不能由 route、executor 和恢复器分别自由修改。
- 新依赖确实删除或替代了现有代码，不保留两套主路径。

## 本次调研完成标准

- [ ] 课程概念取舍已记录。
- [ ] 当前实现与缺口已有源码证据。
- [ ] Pi、LangGraph、Vercel AI SDK、Mastra 与保持现状已比较。
- [ ] 目标分层、状态归属、失败语义和第三方边界已设计。
- [ ] 后续阶段、依赖、验证和回滚点已列出。
- [ ] 用户审阅并确认本路线。
- [ ] 确认后为阶段 A、B、C 分别创建实现任务，不在当前调研任务直接修改产品代码。
