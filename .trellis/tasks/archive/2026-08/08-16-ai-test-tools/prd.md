# PRD: 测试用 AI 工具注册

## Goal

注册一批仅用于测试/验证的 AI 工具，激活现有 tool 注册、编排、权限、审计全链路，让 dev 环境可以真实对话触发工具调用，并用测试验证失败、超时、权限拒绝等路径。

## 背景

- `create-runtime.ts` 默认 `createAiToolRegistry([])`，生产无任何工具。
- 已有完整基础设施：registry（Zod schema、Permission、timeout、校验）、orchestrator（多轮循环、上下文限制、审计）、gateway（tool_use 处理）。
- 测试已有 `createTestApp` 注入 `deps.aiTools` 的框架（ai-tools.test.ts）。
- parent 决策 D-1：env 开关 `AI_TEST_TOOLS_ENABLED`，dev 默认开，生产不配即关。

## Requirements

- R-1: 新增测试工具集文件（`apps/api/src/modules/ai/test-tools.ts`），含 7 个工具：
  - `echo`：回显 text 参数
  - `get_current_time`：返回当前 ISO 时间（无参数）
  - `add_numbers`：两数相加（数值参数）
  - `random_number`：指定范围随机数
  - `fail_tool`：固定抛错（失败路径）
  - `slow_tool`：延迟 seconds 参数（超时/取消路径）
  - `admin_secret`：需要 `ai:config:manage` 权限（权限拒绝路径）
- R-2: `create-runtime.ts` 读 `AI_TEST_TOOLS_ENABLED`，为 true 时把测试工具并入 registry；默认不配置 = 不注册。
- R-3: `.env.example` 与 `.env.development` 增加 `AI_TEST_TOOLS_ENABLED=true`，注释说明仅测试用。
- R-4: 自动化测试覆盖：工具注册成功、参数校验失败、执行失败、超时、权限拒绝、审计记录（ai_tool_executions 状态正确）。
- R-5: 测试工具的 safeSummary/结果遵循现有安全约定（不泄漏到审计/日志）。

## Acceptance Criteria

- A-1: `pnpm test` 全绿，新增测试覆盖 R-4 全部路径。
- A-2: dev 环境（配置了 AI_TEST_TOOLS_ENABLED=true 且有可用模型）真实对话能触发至少一个测试工具并返回结果。
- A-3: 工具失败/超时/权限拒绝时对话 SSE 流有对应 tool_activity 事件（错误码），不中断会话。
- A-4: `ai_tool_executions` 表记录测试工具执行，状态与结果一致。
- A-5: 不配置 `AI_TEST_TOOLS_ENABLED` 时注册表仍为空，行为与现状一致。

## Out of Scope

- 生产级业务工具
- 工具管理 UI（本次只注册 + 验证）
- 动态启停工具

## 依赖

- parent: 08-16-ai-tool-prompt-skills（P-2、P-5 依赖本任务验证）
