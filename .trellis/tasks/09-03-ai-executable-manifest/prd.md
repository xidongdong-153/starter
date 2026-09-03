# D1：可执行能力清单与发现接口

## Goal

让 `starter_user` 和 `product_app` 读取当前 enabled Agent 的稳定执行契约，并允许调用方在启动 Run 时校验期望 Agent revision，避免读取一个版本的 Manifest 后执行另一个版本。

## Confirmed Facts

- Agent `revision` 在执行配置、Prompt 或 Skill 执行输入变化时递增；只改展示名称、描述或状态不递增。
- 当前没有 Agent 配置历史表，不能按旧 revision 重新执行。
- Agent resolve 已提供模型、Prompt/Skill revision 与 hash、精确 Tool、Output Contract 和执行参数。
- Tool 已有稳定 `manifestHash` 和副作用声明；Output Contract 可生成 draft-7 JSON Schema 与稳定 `schemaHash`。
- `/api/ai/agents` 已由 runtime principal middleware 保护，只返回 enabled Agent summary。
- `AiRunResolvedManifest` 是 Run 审计快照，不是发布清单。

## Requirements

### R1：Manifest V1

在 `packages/contracts` 定义 strict `ExecutableManifestV1` 及列表、参数和可调用输入 schema。第一版固定：

- `manifestSchemaVersion: 1`
- `kind: 'agent'`
- `id` 与整数 `version`，其中 `version = agentRevision`
- `name`、`description`
- 不含 `agentId`、版本和内联 config 的调用 `inputSchema`
- Output Contract 引用、完整 JSON Schema 与展示元数据；没有 Output Contract 时为 `null`
- `eventProtocolVersion: 1`
- `controls: ['abort', 'steer', 'follow_up']`
- Agent 所引用 Tool 的最强 `sideEffect`
- `manifestHash`

第一版没有可靠事实源的 `timeoutMs`、`capabilityTags` 和 `deprecatedAt` 不返回。

### R2：版本和 hash

- 只发现当前 enabled revision，不发现或执行历史 revision。
- `manifestHash` 对同一执行事实稳定，覆盖 Agent id/revision、调用输入 schema、Output Contract schema、事件协议、controls、执行参数、Prompt/Skill hash 和 Tool manifest hash。
- `name`、`description` 是可变展示字段，不进入执行字段 hash。
- 同一 Tool `name@version` 的定义跨部署发生漂移时，Manifest hash 必须变化，不能继续声称同一执行契约。

### R3：发现接口

新增：

```text
GET /api/ai/executables
GET /api/ai/executables/{executableId}
```

- 继续使用 runtime principal middleware，支持 cookie `starter_user` 和 Bearer `product_app`。
- 列表分页规则复用 Agent 公共列表。
- draft、disabled Agent 不作为可执行 capability 返回；当前 enabled Agent 的解析失败继续使用现有稳定配置错误，不返回管理配置细节。
- 保留 `/api/ai/agents` 与 `/api/ai/agents/{agentId}`，不改变现有 DTO。

### R4：期望 revision

- `startAgentRunSchema` 增加可选 `expectedAgentRevision`，只允许与显式 `agentId` 同时出现，不能与内联 `config` 或 Session 默认 Agent 单独搭配。
- 提供该字段时，resolve 得到的当前 revision 必须完全相同；不匹配返回新的稳定 409 error code。
- 校验必须发生在附件解析、幂等预检查、lane lease 和 Run row 之前。
- 不提供该字段的旧客户端继续执行当前 Agent revision。

### R5：敏感信息边界

Manifest 不返回：

- Prompt 或 Skill 正文及其内容 hash。
- Provider ID、model ID、凭据或认证来源。
- Tool 名称、参数 schema、scope、权限、handler 或内部 URL。
- Agent 管理 config、Run snapshot 或 resolved manifest 原文。

内部 hash 可以使用这些执行事实的 hash，但公开 DTO 不能暴露它们。

## Acceptance Criteria

- [x] contracts 为 Manifest、列表、查询参数、调用输入和 `expectedAgentRevision` 提供 strict Zod schema 与 TypeScript 类型。
- [x] 两个新 endpoint 有 OpenAPI 定义，cookie 与 Bearer 都能读取 enabled Agent Manifest。
- [x] draft/disabled Agent 不在列表中，按 id 查询保持不泄漏的 404 行为。
- [x] Manifest 的 input/output schema 能由客户端解析，input schema 不包含 `agentId`、`config` 或管理字段。
- [x] 相同 Agent revision 连续读取产生相同 `manifestHash`。
- [x] config、Prompt、Skill 或 Tool manifest 变化会改变 version 或 hash；只改 Agent 名称/描述不改变执行 hash。
- [x] Manifest 不包含 Prompt/Skill 正文、内容 hash、Provider/model、secret、Tool 定义或 handler。
- [x] `agentId + expectedAgentRevision` 相同可以启动 Run；revision 不同返回 409，且不创建 Run、不领取 lease、不消费 idempotency key。
- [x] `expectedAgentRevision` 缺少显式 `agentId`、与 `config` 同时出现或小于 1 时返回 400。
- [x] 旧的 Agent summary、Run JSON/SSE、Timeline、Transcript 和 Structured Output 测试保持通过。
- [x] `packages/contracts` 与 `apps/api` 的 type-check、lint、format、build/test 全部通过。

## Out Of Scope

- `AgentRuntimePort` 与共享 transport，留 D2。
- app credential capability policy、版本强制和事件交付，留 D3。
- Tool/workflow 类型 executable、历史 Agent revision 执行、版本范围和自动升级。
- 任意第三方 Prompt、Tool 或 graph 定义。
- 新数据库表或 migration。
