# 重构 API AI 模块目录结构

## Goal

把 `apps/api/src/modules/ai/` 从单层平铺调整为按业务子域组织的内部结构，让维护者能直接定位配置、会话、Prompt、Skill、工具和用量审计代码，同时保持现有 API 行为和一级模块边界不变。

## Background

- `apps/api/src/modules/ai/` 当前有 25 个 TypeScript 文件，约 7,314 行代码。
- `ai.route.ts` 同时注册 Provider、模型、用户偏好、模型测试、会话、Prompt、Skill 和用量审计接口。
- 会话、Prompt、Skill 和用量审计已经分别形成 `openapi`、`service`、`repository`、`presenter` 文件组，业务边界已经存在，但仍依靠文件名前缀区分。
- 项目一级 API 模块使用 `apps/api/src/modules/<module>/`，模块内部遵守 `route → service → repository`，presenter 负责把数据库记录转换成响应 DTO。
- `apps/api/src/infra/ai/` 负责 Gateway、Provider runtime、凭据和模型目录存储，不属于本次业务模块目录调整范围。
- Hono RPC 类型来自实际路由链，目录和路由调整不能改变 `ApiRpcType` 推导结果。

## Requirements

### R-1 一级模块边界

- `ai` 继续作为 `apps/api/src/modules/` 下的一级模块。
- `apps/api/src/routes/index.ts` 继续通过 `createAiRoute(runtime)` 挂载 AI 接口。
- 不把 Conversation、Prompt、Skill 等提升为独立一级模块。

### R-2 按业务子域组织

- AI 模块内部按配置、会话、Prompt、Skill、工具和用量审计划分目录。
- 子目录使用单数业务名称；文件采用 `<subdomain>.<layer>.ts`，例如 `conversation/conversation.service.ts` 和 `usage-audit/usage-audit.repository.ts`。
- 把 `ai.route.ts` 中各子域的 handler 拆到对应子路由，根路由只保留公共依赖装配和子路由组合。
- 现有 Service、Repository、Presenter 和工具编排内部逻辑只做必要的移动与 import 更新，不在本任务中继续拆分。
- 每个包含数据访问的子域继续遵守 `route → service → repository`，需要 DTO 转换时保留 presenter。
- 不建立统一的 `services/`、`repositories/`、`presenters/` 横向目录。

### R-3 兼容性

- 不改变现有 HTTP path、method、请求参数、响应 envelope、状态码、SSE 事件和权限中间件。
- 不改变 `packages/contracts` 的公开协议。
- 不改变数据库表、migration 和已有持久数据。
- 不改变 `apps/api/src/infra/ai/` 的基础设施职责。
- 保持 Admin 和 Web 对 `@starter/api/rpc` 的类型调用可用。

### R-4 设计和执行计划

- `design.md` 写明目标目录、模块边界、依赖方向、路由组合方式、兼容策略和回滚方式。
- `implement.md` 按可验证步骤列出文件移动、import 更新、路由调整、测试和质量检查命令。
- 设计中的架构和路由组合流程使用暗色 Mermaid 图表达。

## Acceptance Criteria

- [ ] `apps/api/src/modules/ai/` 的目录能直接反映各业务子域。
- [ ] AI 模块内不存在仅靠 `ai-conversation-*`、`ai-prompt-*` 等长前缀才能识别归属的平铺文件组。
- [ ] `createAiRoute(runtime)` 和 `ApiRpcType` 的公开入口保持不变。
- [ ] 现有 AI API、OpenAPI、SSE、权限和数据库行为没有变化。
- [ ] AI 相关测试、API 全量测试和仓库质量检查全部通过。
- [ ] 设计与执行计划包含明确的分步回滚点。

## Out of Scope

- 新增 AI 业务功能、接口或数据库字段。
- 修改 Provider SDK、Gateway、凭据加密或模型目录实现。
- 修改 Admin 或 Web 页面结构。
- 重构其他 API 模块。

## Technical Constraints

- Provider、模型白名单、全局默认模型、用户偏好和模型测试继续由同一组现有 Service 与 Repository 负责，移动到 `configuration/`，本任务不拆其内部职责。
- `ai.schema.ts` 保留在模块根目录，避免会话、Prompt、用量审计之间的外键和 relation 形成新的循环 import。
- `apps/api/src/test/` 保持当前集中测试目录，只更新受文件移动影响的 import。
