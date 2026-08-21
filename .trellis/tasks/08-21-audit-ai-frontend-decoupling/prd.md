# 审查 AI 模块与前端解耦边界

## Goal

确认 `apps/api` 的 AI 模块是否已经可以脱离 `apps/admin` 和 `apps/web`，作为独立的 AI 基建服务供任意前端和其他产品业务调用；进一步讨论一套适合多产品接入的 AI Agent API 协议与解耦设计。

目标形态分为两类能力：

- **管理控制面**：由管理台使用，负责 Provider、模型、系统提示词、Prompt 模板、Skill、Agent 定义、工具目录和用量审计等配置与运维能力。
- **运行数据面**：由产品应用使用，负责创建会话、启动 Agent Run、接收 Harness SSE 事件、读取 Transcript、查询 Run 状态，以及 Abort、Steer、Follow-up 等运行控制。

产品应用可以是普通对话产品，也可以是 React Flow 等 Agent 工作流产品。AI API 只提供 Agent 运行协议和语义事件，不负责绑定具体 UI、React 组件或工作流画布。

## Background

当前仓库包含 `apps/api`、`apps/admin`、`apps/web` 和 `packages/contracts`。AI 运行时主要位于 `apps/api/src/modules/ai/` 与 `apps/api/src/infra/ai/`、`apps/api/src/infra/agent/`，跨端请求、响应和事件 schema 位于 `packages/contracts/src/ai.ts`。Admin 通过 HTTP API、SSE 和 contracts 消费 AI 能力。

已确认的代码事实：

- API 没有导入 `apps/admin` 或 `apps/web` 的代码；AI 运行时通过 `AiRuntime`、`AiGateway`、`AgentSessionStore`、`AiToolRegistry` 等依赖注入运行。
- API 的 Agent Run、Session、Transcript、Abort、Steer、Follow-up 和模型测试接口均通过 HTTP/SSE 提供，不要求前端使用 React、Vite、Next.js 或 Admin 内部组件。
- `packages/contracts` 只定义 Zod schema、DTO、错误码和 HarnessEvent，不读取数据库、不导入 Pi 类型。
- Agent Session 和 Run 按当前登录用户的 `ownerId` 隔离；Provider 配置和用量审计使用 Starter 的权限键 `ai:config:*`、`ai:usage:read`。
- API 仍然和 Starter 产品运行环境绑定：Better Auth、Starter 用户/角色/权限、Starter SQLite、项目内文件与环境变量，以及 `starter.run.v1` 等项目命名均属于 API 的运行边界。
- AI 工具由 API 进程内 `AiToolRegistry` 注入；生产默认只注册读取 Skill 的工具，业务产品需要在 API runtime 中注册自己的工具，不能由任意外部前端直接提交 handler。
- `apps/admin` 有自己的 API 封装、SSE 解析、时间线 reducer 和页面；API 的 live snapshot 注释明确要求 Admin reducer 与服务端保持同构，说明当前存在一个具体前端消费者的展示约定，但不是 API 对 Admin 源码的编译依赖。
- 当前仓库提供 OpenAPI 文档开关和 API RPC 类型，但没有证据表明 AI API 已经被设计成独立部署、独立身份提供商或跨产品多租户服务。

## Confirmed Direction

第一阶段采用内部 AI 平台模式：各产品后端使用应用凭据调用 AI API，并传递经过产品后端确认的 `tenant/project/user` 上下文；浏览器不直接持有 AI 平台凭据。

这意味着：

- AI 平台认证调用方是产品后端，最终用户身份和业务权限由产品后端负责确认并映射到平台上下文。
- AI 平台需要在运行请求中保留租户、项目、用户和资源归属的明确字段，不能只依赖 Starter 的 `ownerId`。
- 产品后端负责把平台事件转给自己的前端，或按产品协议转换；平台不要求前端直接使用 React、SSE 或 Admin 客户端代码。
- 第一阶段不要求立刻替换当前 Better Auth，但后续设计不能把 Better Auth 的用户表结构当成平台公共协议。
- 第一阶段只把 Agent Run 作为稳定的运行基座；React Flow、DAG、节点布局和工作流编排由各产品自行负责，不纳入本次设计。
- 产品后端未来可以把工作流节点映射为一个或多个 Agent Run；只有多个产品出现共同的编排需求后，才单独评估平台级 Workflow Definition 和执行器。

## Configuration Ownership

- Provider 和模型目录由 AI 平台统一管理，产品不能直接管理 Provider secret 或修改全局模型白名单。
- Prompt、Skill、Agent Definition 默认按 `tenant/project` 隔离；平台可以通过明确授权提供跨项目共享。
- 产品运行接口只引用已经发布且可用的 Agent Definition，不直接接触 Provider secret、内部凭据、管理审计字段或未发布配置草稿。
- Agent Definition 的执行快照必须和 Run 绑定，后续配置修改不能改变已经启动的 Run。

## Requirements

- 输出明确结论，区分源码依赖、接口消费、部署运行、产品身份与数据模型四个层次。
- 以代码路径和现有规范为证据，列出当前已经满足的独立服务特征。
- 列出当前仍绑定 Starter 的边界，并说明这些边界对“任意前端”和“其他产品业务自行拓展”的实际影响。
- 判断当前设计更准确的定位：Starter 内部可复用的 AI API 模块，还是通用 AI 基建服务。
- 基于“管理控制面 + 运行数据面”讨论 API 边界：管理台专用接口与产品运行接口应如何分组，哪些数据可以共享，哪些不应进入产品接口。
- 讨论 Harness 协议的职责边界：API 返回 Agent 运行语义和可重放事件，产品前端自行决定对话、时间线、React Flow 或其他 UI 渲染方式。
- 讨论 Agent 工作流接入方式：工作流节点、业务资源和产品 Tool 不应依赖具体前端组件；服务端必须有受控的业务扩展和 Tool 注册边界。
- 讨论从当前 Starter 内部模块演进为多产品 AI 基座的最小路径，至少覆盖身份与租户、资源归属、工具扩展、公开契约、部署与数据隔离。
- 只做架构讨论和审查，不在本任务中实现多租户、认证替换、SDK、Webhook、队列或数据库拆分。
- 明确 Admin 当前是管理控制面消费者，不应成为运行数据面或 AI API 的产品业务依赖。
- 第一阶段采用两阶段 Tool 扩展：先以 TypeScript Tool package 作为平台部署时安装的可信插件，验证统一 Tool contract；后续再以同一 contract 增加远程 Tool 执行适配器。
- Tool contract 至少固定名称、描述、schema、版本、tenant/project 范围、权限声明、timeout、取消行为、审计字段和安全结果格式。
- Agent Definition 只保存已注册 Tool 的引用和 allowlist，不保存任意 handler，也不允许浏览器提交 handler。
- 无论使用进程内插件还是远程执行器，平台都统一执行 schema 校验、权限、超时、AbortSignal 和审计。

## Acceptance Criteria

- [ ] 能用一句话回答当前是否完全解耦，不能把“没有导入前端源码”误判为“已经是通用独立基建服务”。
- [ ] 设计明确区分管理控制面、Agent 运行数据面和产品应用层，并列出各自负责与不负责的内容。
- [ ] 设计明确产品后端使用应用凭据调用平台，浏览器不持有平台凭据；运行上下文包含 tenant、project、user 和可选业务资源引用。
- [ ] 设计明确 Provider/模型由平台统一管理，Prompt、Skill、Agent Definition 默认按 tenant/project 隔离并可显式共享。
- [ ] 设计明确 HarnessEvent 是可重放运行协议，不包含 React、React Flow、Admin 页面或节点布局状态。
- [ ] 设计明确第一阶段只稳定 Agent Run；React Flow、DAG 和工作流编排不在本次范围内。
- [ ] 设计明确产品 Tool 由可信产品后端注册，平台负责 schema、权限、超时、取消和审计，浏览器不能提交 handler。
- [ ] 设计列出当前代码可保留的边界、仍绑定 Starter 的部分和后续最小演进顺序。

## Out of Scope

- 不修改 API、Admin、Web 或 contracts 产品代码。
- 不在本任务中实现多租户、应用凭据、认证替换、SDK、Webhook、队列、独立数据库或远程 Tool 协议。
- 不实现 React Flow、DAG、Workflow Definition 或工作流执行器。
- 不重构现有认证、权限、Session、Run、Tool 或 Provider 实现。
- 不把当前 Admin 页面改造成通用前端组件。

## Technical Notes

相关证据文件：

- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/modules/ai/run/run.route.ts`
- `apps/api/src/modules/ai/session/session.route.ts`
- `apps/api/src/modules/ai/agent/agent.route.ts`
- `apps/api/src/infra/agent/agent-executor.ts`
- `apps/api/src/bootstrap/create-runtime.ts`
- `apps/api/src/modules/auth/auth.config.ts`
- `apps/api/src/middleware/cors.middleware.ts`
- `packages/contracts/src/ai.ts`
- `.trellis/spec/api/backend/ai-system-design.md`
- `.trellis/spec/api/backend/ai-integration-guidelines.md`
