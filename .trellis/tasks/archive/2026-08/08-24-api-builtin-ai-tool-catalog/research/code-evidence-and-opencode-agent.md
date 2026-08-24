# API 内置 Tool Catalog 代码证据与 Pi 实施 Agent 配置

## 结论

本任务只在 `apps/api` 内管理 Tool，不建立独立 Tool package，不做远程 Tool。执行 runtime 继续由 API 的 Pi adapter 控制；Agent 配置只保存精确 `name + version` 引用；Run 启动时解析 Tool 并把已解析定义直接传给 Executor。

本任务采用破坏性 schema v2：旧的 `schemaVersion: 1`、`toolNames`、缺失版本和版本范围均不再读取或转换。旧 Agent config 和旧 Run snapshot 不做兼容迁移；测试 fixture 直接改成 v2。

## 当前代码证据

### Tool 定义与注册

- `apps/api/src/modules/ai/tool/tool-registry.ts`
  - 当前已有 `defineAiTool`、`RegisteredAiTool`、`AiToolRegistry`。
  - 当前 registry 按 `name@version` 拒绝重复项，但 `find(name)` 仍允许隐式版本选择。
  - `AiToolExecutionContext` 当前包含可选 `principal`、可选 `scope`、`userId` 和可选 `reportProgress`，需要按 PRD 收紧。
- `apps/api/src/modules/ai/skill/skill-tools.ts`
  - `read_skill` 是 API 内置业务 Tool，依赖 `AiSkillRepository`，应继续留在 API 内。
- `apps/api/src/modules/ai/tool/test-tools.ts`
  - 测试 Tool 由环境变量控制，不应进入生产 Catalog。
- `apps/api/src/bootstrap/create-runtime.ts` 与 `apps/api/src/modules/ai/ai.route.ts`
  - 当前 runtime 注入测试 registry，AI route 再和 `read_skill` 合并；需要收敛到单一显式 Catalog 组装入口。

### Agent 配置和 Run

- `packages/contracts/src/ai.ts`
  - 当前 `agentDefinitionConfigSchema` 和 `agentRunSnapshotSchema` 是 `schemaVersion: 1`，字段为 `toolNames`。
  - 当前 `aiToolSummarySchema` 已有 `name`、`version`、`description`、`scope`，Admin 只需改选择值和配置提交结构。
- `apps/api/src/modules/ai/agent/agent.service.ts`
  - 当前 `resolve()` 按 `toolRegistry.find(name)` 解析 Tool；`validateConfig()` 只检查 name 是否存在；需要改为精确 ref 查找和同名版本冲突检查。
- `apps/api/src/modules/ai/run/run.service.ts`
  - 当前 snapshot 保存 `toolNames`，Executor config 也传 `toolNames`；需要保存 `toolRefs`，同时传 `resolved.tools`。
- `apps/api/src/infra/agent/agent-executor.ts`
  - 当前 `ResolvedAgentExecutorConfig` 有 `toolNames`，并通过 `selectTools(this.options.tools, config.toolNames)` 重新查询 registry；需要改成直接接收 `readonly RegisteredAiTool[]`。
- `apps/api/src/infra/agent/pi-tool-adapter.ts`
  - 已有 schema、scope、permission、timeout、AbortSignal、safe result、progress 和 audit 流程。
  - 需要加入 arguments 安全序列化大小限制，并把 Tool version 传给 audit。

### 审计

- `apps/api/src/modules/ai/ai.schema.ts`
  - `ai_tool_executions` 当前有 `toolName`，没有 `toolVersion`。
- `apps/api/src/modules/ai/usage-audit/usage-audit.repository.ts`
  - begin/finalize 使用 repository 条件更新，重复 finalize 不覆盖 running 以外状态；begin input 需要增加 `toolVersion`。
- `apps/api/src/modules/ai/usage-audit/usage-audit.service.ts`
  - `beginToolExecution` 需要透传版本。
- `apps/api/src/modules/ai/usage-audit/usage-audit.presenter.ts` 和 `packages/contracts/src/ai.ts`
  - Tool audit DTO 需要增加 nullable `toolVersion`，新记录填精确版本，历史记录允许 null。

### Admin

- `apps/admin/src/features/ai/pages/Agents.tsx`
  - 当前表单值为 `toolNames: string[]`，Tool option value 也是 name；需要改为可逆的 `name@version` UI key，并提交 `toolRefs`。
- `apps/admin/src/api/ai/agent.api.ts`、`agent.query.ts`
  - 已有 `/api/ai/admin/tools` 查询，不需要新增接口。
- `apps/api/src/modules/ai/agent/agent.openapi.ts`
  - 已使用共享 contracts schema，字段修改后主要验证 RPC/OpenAPI 类型链路。

## 关键风险

1. schema v2 是破坏性变更，必须清理所有测试和 seed 中的 v1 fixture；不能只修改主 schema。
2. registry 可以保留同名多版本，但 Pi tools 不能同时包含同名工具；Agent config 必须拒绝同名不同版本。
3. Run snapshot 只保存 refs，handler 只能驻留内存；进程重启继续按现有 interrupted 规则处理。
4. Tool audit 历史数据没有版本，新增数据库列应允许 null；新执行路径必须写非空版本。
5. Product App 权限不能复用 Starter user id；没有产品权限模型前，带权限 Tool 对 product_app 必须拒绝。
6. 用户所说的 OpenCode 是 Pi 内的 `opencode-go` Provider，不是 OpenCode CLI 平台。本任务不创建 `.opencode/agents` 文件；实施由 Pi 原生 `trellis_subagent` 派发。

## Pi 实施 Agent

实施时使用当前会话提供的原生工具，参数固定为：

```text
agent: trellis-implement
mode: single
model: opencode-go/deepseek-v4-flash
thinking: max
```

派发 prompt 第一行必须是：

```text
Active task: .trellis/tasks/08-24-api-builtin-ai-tool-catalog
```

后续内容明确：子 Agent 已经是 `trellis-implement`，直接读取注入的 `prd.md`、`design.md`、`implement.md`、`implement.jsonl` 上下文并实施，不再派发实现或检查 Agent。

规划阶段验证：

```bash
pi --model opencode-go/deepseek-v4-flash --thinking max --no-tools --no-session -p "只回复 MODEL_READY"
```

命令成功返回 `MODEL_READY`，证明 Pi 能解析该 Provider、模型和思考等级。真正实施派发失败时停止，不替换其他 Provider 或模型。
