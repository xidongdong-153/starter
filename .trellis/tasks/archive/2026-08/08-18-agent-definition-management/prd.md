# AgentDefinition 管理

## Goal

实现 AgentDefinition 的持久化、配置校验、资源引用解析、公开只读 API、Admin CRUD 和管理页面。完成后可以定义一个可执行 Agent，但本任务不启动 AgentRun。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S3，前置任务是 S2 `08-18-agent-harness-contracts-schema`。

本任务直接使用父任务共享契约和 S2 导出，不新增 Agent config 或 DTO 字段：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。

AgentDefinition 是新 Harness 的配置入口。它引用现有模型策略、System Prompt、Skill 和 Tool Registry，不复制这些资源，也不保存 Provider secret。

## Requirements

### R1. AgentDefinition 子域

- 在 `modules/ai/agent/` 增加 openapi、presenter、repository、route 和 service。
- 状态为 `draft | enabled | disabled`。
- 创建时 revision 为 1；执行配置变化时 revision 加 1。
- 仅名称或描述变化不增加 revision；执行配置变化精确增加 1。
- Presenter 不返回内部数据库字段、secret 或不可用资源详情。

### R2. 资源解析

- 模型引用复用现有 Provider、enabled model 和用户无关的系统模型策略。
- System Prompt 必须存在且已启用。
- Skill id 必须存在且已启用。
- Tool name 必须存在于 Registry。
- 解析结果只供后续 Run 使用；数据库继续保存引用和版本化配置。
- Prompt 删除检查同时考虑旧 Conversation 引用和 AgentDefinition 引用。

### R3. API 与权限

- `GET /api/ai/agents` 和 `GET /api/ai/agents/{agentId}`：已登录用户读取 enabled Agent 的公开信息。
- `GET /api/ai/admin/agents` 和 `GET /api/ai/admin/agents/{agentId}`：要求 `ai:config:read`。
- `POST /api/ai/admin/agents`、`PATCH /api/ai/admin/agents/{agentId}` 和 `PATCH /api/ai/admin/agents/{agentId}/status`：要求 `ai:config:manage`。
- 普通用户不能读取 draft、disabled 或内部 config snapshot。

### R4. Admin 页面

- 新增 AgentDefinition 管理入口，沿用现有 AI 设置页面的布局、表格、Drawer/Form 和权限 guard。
- 支持列表、创建、编辑、启用、停用和 draft 状态。
- 模型、Prompt、Skill 和 Tool 使用现有查询结果生成选项，不允许输入 secret。
- 旧 Conversation 页面和请求函数保持不变。

## Acceptance Criteria

- [ ] Admin 可以创建 draft Agent、编辑配置、启用和停用。
- [ ] 公开与 Admin 列表按共享契约分页，公开 items 不含 config，Admin items 包含严格 config。
- [ ] 执行配置变化使 revision 精确加 1；纯展示字段按设计规则处理。
- [ ] 无效或停用的模型、Prompt、Skill、Tool 引用返回稳定错误。
- [ ] 普通用户只看到 enabled Agent，且 DTO 不含 secret 和内部 config JSON。
- [ ] `ai:config:read` 与 `ai:config:manage` 的 401、403、2xx 分支有 smoke test。
- [ ] 删除被 AgentDefinition 引用的 System Prompt 被拒绝，旧 Conversation 引用检查保持有效。
- [ ] Admin 管理页的加载、提交、权限和失败状态有测试。
- [ ] 旧 Conversation API 和 Admin 页面保持通过。
- [ ] 全仓质量门、测试和构建全部通过。

## Out of Scope

- Pi Agent executor、Session、Run、SSE 和 transcript。
- 用户创建 Agent、Agent 所有权、组织和租户 ACL。
- 从 Conversation 自动生成 AgentDefinition。
- 删除旧 Conversation 页面或 contracts。
