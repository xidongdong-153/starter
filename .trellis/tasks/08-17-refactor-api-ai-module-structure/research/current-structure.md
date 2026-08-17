# API AI 模块现状调查

## 规模

`apps/api/src/modules/ai/` 当前包含 25 个 TypeScript 文件，共约 7,314 行。

| 文件 | 行数 | 当前职责 |
| --- | ---: | --- |
| `ai.route.ts` | 781 | 依赖装配、37 个 OpenAPI operation、模型测试 SSE、会话 SSE |
| `ai.service.ts` | 800 | Provider、模型白名单、全局默认、用户偏好、模型测试 |
| `ai.repository.ts` | 447 | Provider 配置、启用模型、默认模型和用户偏好持久化 |
| `ai-conversation.service.ts` | 910 | 会话、generation、上下文、SSE 生成终态 |
| `ai-conversation.repository.ts` | 629 | 会话、消息和 generation 持久化 |
| `ai-tool-orchestrator.ts` | 567 | 模型与工具多轮执行、预算、取消和错误处理 |
| `ai.schema.ts` | 484 | AI 配置、Prompt、Skill、会话、审计表和 relations |

## 已存在的业务子域

- 配置：Provider、模型目录、白名单、默认模型、用户偏好和模型测试。
- 会话：会话、消息、generation、发送、重试和停止。
- Prompt：系统 Prompt、全局系统 Prompt 和 Prompt 模板。
- Skill：Skill 管理、Skill 描述注入和 `read_skill` 工具。
- 工具：Registry、Orchestrator 和本地测试工具。
- 用量审计：模型调用和工具执行记录、查询与 DTO 转换。

这些子域已经分别使用文件名前缀表达归属。目录调整不需要创造新的业务划分。

## 依赖事实

- `apps/api/src/routes/index.ts` 只从 AI 模块根入口调用 `createAiRoute(runtime)`。
- `apps/api/src/rpc.ts` 从 `ReturnType<typeof createRoutes>` 提取 Hono schema，再生成客户端使用的 `AppType`。
- Hono 4.13 的 `route()` 返回类型使用 `MergeSchemaPath<SubSchema, ...> | S` 合并子应用 schema。
- 项目顶层 `createRoutes()` 已经通过显式链式 `.route("/", childApp)` 组合多个模块，说明 AI 根路由可以使用相同方式组合子路由。
- `apps/admin` 通过 `hc<AppType>()` 使用 AI 路由类型，路由组合不能改成无法保留泛型的动态循环。
- `ai.schema.ts` 中审计、会话和 Prompt 表存在跨子域外键，当前集中定义可以避免新的循环 import。
- `apps/api/src/bootstrap/create-runtime.ts`、AI 脚本、infra 和测试直接导入部分 AI 内部文件，文件移动后必须逐项更新。

## 兼容基线

本次调整不应改变：

- 37 个 AI OpenAPI operation 的 path、method 和 schema。
- `createAiRoute(runtime)` 与 `AppType` 的公开入口。
- 中间件顺序和权限要求。
- JSON envelope、SSE header、heartbeat、事件顺序与终态处理。
- 数据库 schema、migration 和 `infra/ai`。

## 参考材料

- `.trellis/spec/api/backend/directory-structure.md`
- `.trellis/spec/api/backend/ai-integration-guidelines.md`
- `.trellis/spec/api/backend/quality-guidelines.md`
- `.trellis/spec/api/frontend/type-safety.md`
- `.trellis/tasks/archive/2026-08/08-13-api-contract-client-architecture/design.md`
- `.trellis/tasks/archive/2026-08/08-14-ai-configuration-foundation/research/architecture-preview.md`
