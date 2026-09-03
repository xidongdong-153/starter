# 阶段C：logical Run、Attempt、Step 与副作用策略

## Goal

把调用幂等、执行重试、步骤事实和外部副作用分开表达：`ai_agent_runs` 作为 logical Run 关联多个 Attempt，Tool 声明副作用类别并携带稳定幂等 token，retry 只对声明安全的范围生效。

任务来源：`.trellis/tasks/09-02-api-ai-agent-architecture-research/implement.md` 阶段 C。依赖阶段 A（lease/fencing）与阶段 B（resolved manifest），均已归档。

## Requirements

### 范围内

- `ai_agent_runs` 确定为 logical Run，不新增 logical Run 表、不迁移引用。
- 新表 `ai_run_attempts`：序号、owner、fencing token、状态、trigger、retry reason、错误、起止时间。
- 每 Attempt 创建一条顶层 `agent` Step（kind 扩展），现有 turn 内 Step 关联所属 attempt。
- Tool 执行生成稳定 `idempotencyToken` 并持久到 `ai_tool_executions`，经执行上下文传给 handler。
- Tool 定义必填 `sideEffect: read_only | idempotent_write | non_idempotent_write`，进入公开 Tool summary 与 resolved manifest。
- `AgentDefinitionConfig` 增加可选 `retryPolicy`；auto retry 只对模型上游失败/超时生效，且 manifest 含 `non_idempotent_write` Tool 时整体禁用。
- retry 创建新 Attempt，不创建新 Run；idempotency key 绑定 logical Run 不变。
- `runTrace` 暴露 attempts 列表。

### 明确裁剪（留后续阶段）

- `parentStepId` / `branchId` / `inputRef` / `outputRef` / `timeout` 列留阶段 E（编排需要时再加，现在没有写入方）。
- durable resume / checkpoint 续跑不做：中断 Run 仍标 `interrupted`，不自动重试。
- auto retry 只在原始请求内同步链式发生，无后台调度器、无新 Run 状态。
- 非幂等写的不确定结果不引入人工判断状态：用「禁 auto retry + 超时措辞声明结果未知」表达。

## Out Of Scope

- 不做编排、条件路由、并行分支（阶段 E）。
- 不做远程 Tool（阶段 G）。
- 不做跨进程 retry 调度与恢复。

## Acceptance Criteria

- [x] migration：`ai_run_attempts` 新表；`ai_agent_runs.current_attempt_no`、`ai_run_steps.attempt_no`、`ai_run_turns.attempt_no`（回填 1）、`ai_tool_executions.idempotency_token`（存量 NULL）；`db:generate` / `db:migrate` / `db:check` 通过。
- [x] invocation 重放（同 idempotency key）返回同一 logical Run，不创建新 Run 或新 Attempt。
- [x] 模型失败 + `retryPolicy.maxAttempts=2`：创建 Attempt 2（trigger=auto_retry、retry_reason 记录）、Run 不落终态继续执行、Attempt 2 成功后单一 terminal event、两条 Attempt 行与 `agent` Step 均落正确终态。
- [x] 不可重试错误（用户 abort、参数校验失败）不创建新 Attempt。
- [x] manifest 含 `non_idempotent_write` Tool 时模型失败不自动重试（Attempt 1 即终态）。
- [x] 重试上限耗尽：Run 落 failed，全部 Attempt 行落终态。
- [x] lease 在 Attempt 2 执行期间被接管：旧 owner 终态提交落 `interrupted`（阶段 A fencing 对新 Attempt 生效）。
- [x] 每个 Attempt 产生一条 `kind='agent'` 顶层 Step，outcome 与 Attempt 终态一致；turn 内 Step 的 `attempt_no` 正确。
- [x] Tool 执行审计行持久 `idempotencyToken`（SHA-256，输入 `runId + attemptNo + toolExecutionId`）；相同输入重算结果相同；handler 经上下文拿到 token。
- [x] Tool 定义必填 `sideEffect`（类型层面强制）；`AiToolSummary` 与 resolved manifest tools 携带该字段；manifestHash 输入包含 sideEffect。
- [x] `non_idempotent_write` Tool 超时的 modelText 声明外部状态未知，`read_only` / `idempotent_write` 维持现有超时措辞。
- [x] RunEvent 顶层可选字段 `attemptNo`（缺省视为 1），旧客户端 parser 不受影响。
- [x] `runTrace` 返回 attempts 列表（序号、trigger、状态、错误、起止时间）。
- [x] `pnpm --filter @starter/api` 四项质量命令全过；contracts 改动后全仓 `pnpm check` 全过；全量测试回归通过。

## Notes

- 设计决策见 `design.md`；执行清单见 `implement.md`。
- 已知语义（设计确认）：Attempt 边界在 Pi transcript 中表现为重复的用户输入 entry，模型上下文含失败尝试的痕迹；这是同步链式重试的固有行为，不做 transcript 清理。
