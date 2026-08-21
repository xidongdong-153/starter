# 迁移 AI 运行资源到 Scope 归属

## Goal

让 Session、Run、Transcript、Agent 引用和 AI 审计都按 `PrincipalContext + ResourceScope` 做资源检查，消除运行面只按 Starter `ownerId` 判断归属的问题，同时保留兼容适配。

## Dependencies

- 前置：`08-21-ai-api-contract-surface`、`08-21-ai-api-principal-scope`。
- 后置：跨产品运行验证、Web Chat。

## Requirements

### Session

- 创建 Session 时使用 scope 和 `externalUserId`，不得接受客户端指定 owner/user 外键。
- 列表、详情、更新、归档、Transcript 必须带 scope 条件。
- Session 主库记录保存平台 scope 和产品用户引用；Pi Session metadata 不保存 Provider secret、权限关系或产品业务正文。
- Session create 仍处理双库补偿：Pi create 成功但主库失败必须 delete Pi；主库成功但 Pi 失败不能返回可用 Session。
- 已归档、scope 不匹配和不存在统一 404。

### Run

- Start/get/abort/steer/follow-up 必须检查 Session scope 和 Run scope 一致。
- Run 创建时快照必须包含 scope-safe identity reference（必要时只保存 scope ID/external user reference），不能保存 secret 或完整业务实体。
- `sessionId + lane` 的 active lock 至少在同一 scope 内唯一；当前单进程 registry 限制要在文档中保留。
- Run 终态、Pi terminal entry、recovery scan 的身份匹配规则增加 scope 检查，不能只匹配 runId/sessionId。
- `requestId` 继续作为请求追踪字段，不作为资源归属字段。

### Agent/Prompt/Skill/Tool 引用

- Runtime 解析 Agent 时检查 Agent 可见 scope、启用状态、模型可用性、Prompt/Skill 启用状态和 Tool scope。
- Agent revision snapshot 只保存引用和执行参数，不能把资源正文复制进公共响应。
- 首版如果资源表还没有 tenant/project 列，必须明确使用 Starter compatibility scope，不能在 service 内用空值或默认值假装隔离完成。

### Audit

- `ai_model_calls`、`ai_tool_executions` 增加或映射 scope 查询字段，至少能按 app/tenant/project/externalUser/run 关联审计。
- 用量控制面查询必须按调用方权限和 scope 过滤；管理员跨 scope 查询属于后续控制面授权，不由产品运行 token 获得。
- prompt/response/arguments/result/secret 继续禁止写入审计。

## Out of Scope

- 不做跨节点 active registry、队列、worker、数据库拆分或远程 Tool。
- 不一次性删除 `ownerId`；先增加 scope adapter 和兼容查询，迁移另建任务。
- 不把产品业务数据复制到 AI 数据库。

## Acceptance Criteria

- [ ] 同一 session/run ID 在不同 scope 下不能互相读取、修改、启动或控制。
- [ ] product app 的 externalUserId 只能访问自己 scope 内对应资源。
- [ ] Starter Cookie 兼容路径的现有 Session/Run 测试保持通过。
- [ ] Agent/Prompt/Skill/Tool 引用失效、越权、禁用和 scope 不匹配有明确错误。
- [ ] Recovery 不接受 scope/identity 不匹配的 terminal entry。
- [ ] Usage audit 查询不会跨 scope 泄露记录，敏感字段测试继续通过。
- [ ] 双库 Session 创建补偿、Run 终态顺序、SSE 断线和恢复测试通过。

## Evidence

- `apps/api/src/modules/ai/session/session.service.ts`
- `apps/api/src/modules/ai/session/session.repository.ts`
- `apps/api/src/modules/ai/run/run.service.ts`
- `apps/api/src/modules/ai/run/run.repository.ts`
- `apps/api/src/modules/ai/run/run.presenter.ts`
- `apps/api/src/infra/agent/pi-session-store.ts`
- `apps/api/src/modules/ai/agent/agent.service.ts`
- `apps/api/src/modules/ai/usage-audit/`
- `apps/api/src/modules/ai/ai.schema.ts`
