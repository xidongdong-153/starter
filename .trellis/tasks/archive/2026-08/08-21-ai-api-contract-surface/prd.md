# 冻结 AI 公共协议与 API 面划分

## Goal

冻结 AI API 的公共边界，让实施者不会把 Admin 页面模型、Starter 用户字段或 Pi 内部类型直接当成多产品协议。

本任务只处理协议、路由分类、OpenAPI 和兼容说明，不改变身份归属和运行数据库 schema。后续 Principal/Scope、运行资源迁移和 Web 接入必须以本任务产出的契约为准。

## Dependencies

- 前置：无。
- 后置：`08-21-ai-api-principal-scope`、`08-21-ai-api-runtime-resource-scope`、Admin 子任务、Web 子任务。

## Current API Surface

### AI Control

- Provider：`GET /api/ai/admin/providers`、`PUT /api/ai/admin/providers/{providerId}/config`、`DELETE /api/ai/admin/providers/{providerId}/credential`、`POST /api/ai/admin/providers/{providerId}/check`、`PUT /api/ai/admin/providers/{providerId}/state`、`POST /api/ai/admin/providers/{providerId}/refresh`。
- Models：`GET/PUT /api/ai/admin/models`、`PUT /api/ai/admin/default-model`。
- Prompt：`/api/ai/system-prompts`、`/api/ai/settings/system-prompt`、`/api/ai/prompt-templates`。
- Skill：`/api/ai/skills`。
- Agent Definition：`/api/ai/admin/agents`、`/api/ai/admin/tools`。
- Usage：`GET /api/ai/usage/calls`、`GET /api/ai/usage/calls/{callId}`。
- Model test：`POST /api/ai/test`，定义为控制面连通性检查，不是 Agent Run。

### AI Runtime

- Session：`/api/ai/sessions`、`/api/ai/sessions/{sessionId}`、`/api/ai/sessions/{sessionId}/transcript`。
- Run：`POST/GET /api/ai/sessions/{sessionId}/runs`、`POST .../abort`、`POST .../steer`、`POST .../follow-ups`。
- 运行协议：`HarnessEvent`、`AgentRun`、`AgentTranscript`、`AgentRunLiveSnapshot`。

### AI Compatibility

- `GET /api/ai/models` 和 `/api/ai/preferences` 是 Starter 用户模型偏好接口，首版保留但不作为产品应用凭据协议。
- 当前 Cookie Better Auth、`ownerId`、Starter PermissionKeys 和 `{ ok, data, meta }` envelope 属于兼容层事实，必须在文档中标出。

## Requirements

- `packages/contracts/src/ai.ts` 为每个跨端运行 schema 保持单一来源，禁止 Admin/Web 在本地重新声明 HarnessEvent。
- 管理 DTO 与运行 DTO 分开命名；`AdminAi*` 只能被控制面使用，运行面不返回 Provider credential、管理状态和内部配置字段。
- HarnessEvent 保持 `version/eventId/sequence/sessionId/runId/lane/createdAt/type/data` envelope。
- 写清每个事件的生产条件、字段含义、终态关系、是否持久化和消费者断线后的恢复方式。
- 写清 `run.live` 是进程内快照，不是可靠历史；Transcript 是持久投影；主库 Run 是状态真相。
- 写清 SSE `id/event/data` 映射、heartbeat、队列超限、断线不 abort、终态唯一性和 cursor 规则。
- OpenAPI tags 至少增加 `AI Control`、`AI Runtime`、`AI Compatibility`，并更新 `/doc` 的 AI 描述。
- 对每个运行接口补齐 400/401/404/409/500 等实际错误响应和认证/scope 说明，不凭空增加尚未实现的公共接口。
- 为后续 PrincipalContext/ResourceScope 保留版本化扩展位置，不直接把 `tenantId/projectId` 塞入现有 Starter DTO，除非该字段已经由身份任务定义。

## Non-goals

- 不实现应用凭据、租户表、ResourceScope、远程 Tool 或独立部署。
- 不改变当前 HarnessEvent 字段语义，不顺手重写 Admin reducer。
- 不删除旧路径、不改数据库、不实现 SDK。

## Acceptance Criteria

- [ ] 现有 AI route 清单逐项归入 Control/Runtime/Compatibility，并且路径、method、请求和响应与源码一致。
- [ ] OpenAPI 文档显示三类 AI tags；`/doc` 的标题/描述不再把 AI 只描述成 Starter 页面接口。
- [ ] `packages/contracts/src/ai.ts` 中运行 schema 仍是唯一公共定义，敏感字段检查有测试。
- [ ] 文档明确 Run、live snapshot、Transcript、Pi terminal entry 和主库状态的事实边界。
- [ ] 文档明确 SSE 断线恢复、sequence、terminal event、cursor 和错误行为。
- [ ] 现有 API/Admin 测试、类型、Lint、Format 通过；未引入身份或数据迁移。

## Evidence

- `apps/api/src/modules/ai/*/*.openapi.ts`
- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/openapi/api-docs.ts`
- `packages/contracts/src/ai.ts`
- `apps/api/src/test/ai-harness-contracts.test.ts`
- `.trellis/spec/api/backend/ai-system-design.md`
- `.trellis/spec/api/backend/ai-integration-guidelines.md`
