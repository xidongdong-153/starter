# AI API 基座：控制面与运行面

## Goal

把 `apps/api` 的 AI 能力整理成可供多个产品后端调用的基座。API 同时提供：

- **控制面**：Provider、模型、Prompt、Skill、Agent Definition、Tool Registry、用量审计等配置和运维接口，主要给 Admin 使用。
- **运行面**：Session、Run、Transcript、HarnessEvent SSE、Run snapshot、Abort、Steer、Follow-up 等 Agent 执行接口，给产品后端使用。

本任务是 API 基座的实施父任务。Admin 移除 Agent 聊天页面、Web Chat 接入都依赖本任务的运行协议和调用身份完成。

## 目标调用边界

首版采用产品后端调用模式：

```text
产品浏览器 -> 产品后端 -> AI API 基座
                         |-> 应用凭据
                         |-> externalUserId
                         |-> 可选 subjectType / subjectId
```

AI API 不要求产品前端使用 React、Next.js、Vite 或 Admin 组件。产品后端可以把 AI API 的 SSE 转发给浏览器，也可以自己消费事件后返回产品协议。

应用凭据首版固定绑定一个 `tenantId + projectId`。AI API 从凭据派生资源范围，不信任请求体中的 tenant/project。请求只能传产品侧的 `externalUserId` 和可选的稳定业务资源引用 `subject`。

## 当前代码基线

已存在并继续复用：

- Provider 与模型：`apps/api/src/infra/ai/`、`apps/api/src/modules/ai/configuration/`。
- Prompt 与 Skill：`apps/api/src/modules/ai/prompt/`、`apps/api/src/modules/ai/skill/`。
- Agent Definition：`apps/api/src/modules/ai/agent/`。
- Session：`apps/api/src/modules/ai/session/`、`apps/api/src/infra/agent/pi-session-store.ts`。
- Run：`apps/api/src/modules/ai/run/`、`apps/api/src/infra/agent/agent-executor.ts`。
- Tool：`apps/api/src/modules/ai/tool/tool-registry.ts`、`apps/api/src/infra/agent/pi-tool-adapter.ts`。
- 公共协议：`packages/contracts/src/ai.ts`。
- Admin 当前通过 Cookie、RPC client、SSE 和自己的 Harness reducer 消费 API。

当前 Starter 绑定必须明确保留在适配层，而不能继续进入公共运行协议：Better Auth、`ownerId`、Starter 权限键、Starter SQLite、Pi Session 文件路径和 `starter.run.v1`。

## Requirements

### 1. 控制面与运行面分类

- 为现有 AI 路由、DTO、权限和 OpenAPI tag 建立明确分类。
- 控制面包含 Provider、模型目录/白名单、全局默认、Prompt、Skill、Agent Definition、Tool 目录和 Usage Audit。
- 运行面包含 Session、Run、Transcript、SSE 事件、Run snapshot、Abort、Steer、Follow-up 和产品调用身份。
- `/api/ai/test` 归入控制面里的模型连通性检查，不得被当成 Agent Run 协议。
- `GET /api/ai/models`、`/api/ai/preferences` 属于 Starter 用户兼容接口，先标记为适配接口，不把 `userId` 偏好写进公共产品协议。
- 管理 DTO、产品运行 DTO、Starter 兼容 DTO 和 API 内部类型分别标记，不能把 Provider secret、Pi 类型、数据库 record 或 Admin view model 放进 contracts。

### 2. 统一身份和资源范围

先建立统一内部上下文，再接入两种认证来源：

```ts
interface PrincipalContext {
  kind: 'starter_user' | 'product_app'
  principalId: string
  tenantId: string
  projectId: string
  externalUserId: string | null
  appId: string | null
}

interface ResourceScope {
  tenantId: string
  projectId: string
  subjectType: string | null
  subjectId: string | null
}
```

- Better Auth adapter：从当前登录用户和 Starter 配置得到 `PrincipalContext`；在兼容期把 `tenantId/projectId` 映射为当前 Starter scope。
- Product app adapter：从应用凭据得到 `appId + tenantId + projectId`，从请求体得到 `externalUserId` 和可选 subject；禁止请求体覆盖凭据 scope。
- 控制面 Admin 请求继续使用 Starter 用户和权限校验，直到控制面应用凭据另建任务。
- 运行面 service、Session repository、Run repository 和 Tool executor 逐步使用 `PrincipalContext + ResourceScope`，不直接接收 `ownerId` 作为公开边界。
- 首版应用凭据只绑定一个 tenant/project；不支持一个凭据跨多个项目、不支持浏览器持有应用凭据、不支持任意用户 impersonation。

### 3. 资源归属

默认归属：

- Provider 和模型：平台级控制面资源。
- Prompt、Skill、Agent Definition、Tool 注册：`tenant/project` 资源；首版可保留 Starter 全局实现，但必须在设计中标记迁移位置。
- Session、Run：`tenant/project + externalUserId` 归属，subject 作为可选业务引用。
- Transcript：跟随 Session 归属，产品不能按裸 session ID 越权读取。
- Run snapshot：跟随 Run，保存 Agent revision 和无 secret 执行配置快照。
- 产品业务表：仍属于产品自身，AI API 只保存 `subjectType/subjectId`，不读取产品数据库。

资源不存在、scope 不匹配、用户不匹配和已归档资源统一返回安全的 `COMMON.NOT_FOUND`，不泄露资源存在性。

### 4. Agent Definition 和执行快照

- Agent Definition 只保存模型引用、Prompt/Skill 引用、Tool allowlist、thinking level、max turns、状态和 revision。
- 创建 Agent 时 `revision=1`。
- 修改模型、Prompt、Skill、Tool、thinking level、max turns 时 revision 加 1；只改名称、描述或状态不加 revision。
- 只有已发布/启用且当前依赖仍可用的 Agent 才能被运行面引用。
- Run 启动时解析 Agent，并把 `agentId + revision + model + prompt/skill/tool 引用 + 执行参数` 写入无 secret snapshot。
- 后续修改 Agent、Provider、模型白名单、Prompt、Skill 或 Tool 不影响已经启动的 Run。
- Agent snapshot 不保存 Provider secret、Prompt/Skill 正文、Tool schema、handler、业务数据或 Pi 类型。

### 5. Harness 运行协议

HarnessEvent 是产品无关的 Agent 运行协议，不是页面渲染协议。稳定 envelope：

```ts
{
  version: 1
  eventId: string
  sequence: number
  sessionId: string
  runId: string
  lane: string
  createdAt: string
  type: string
  data: unknown
}
```

事件范围：

- `run.started`
- `turn.started`
- `message.started`
- `message.delta`
- `thinking.started`
- `thinking.delta`
- `thinking.completed`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `context.compacted`
- `turn.completed`
- `message.completed`
- `run.completed`
- `run.failed`
- `run.aborted`

事件不能包含 React props、React Flow 节点坐标、组件名、页面 tab、Admin reducer 字段或产品数据库实体内容。产品可以把同一事件渲染为 Chat、时间线、节点状态或其他界面。

必须保持：

- sequence 在单个 Run 内从 1 开始单调递增。
- SSE `id=eventId`，`event=type`，`data=完整事件 JSON`。
- heartbeat 是 SSE comment，不属于 HarnessEvent。
- SSE 断开不取消后台 Run。
- 队列超限只关闭当前 transport，不阻塞 Agent loop。
- 终态事件只发布一次，终态后不再发布普通事件。
- 事件流不是持久历史；持久事实来自 Pi transcript、terminal entry 和主库 Run 状态。

### 6. Run、Snapshot、Transcript 的事实边界

- `ai_agent_runs` 是 Run 状态唯一来源。
- Pi Session SQLite 保存消息、Tool result、compaction、lane branch 和 `starter.run.v1` terminal entry。
- `ai_model_calls`、`ai_tool_executions` 只保存审计元数据，不保存 prompt、response、arguments、result、secret。
- `live` snapshot 是活跃 Run 的进程内视图，Run 终态或进程重启后为空。
- Transcript 是从指定 lane branch 投影出的持久视图，分页使用 raw entry cursor，不用投影 item 数量推断下一页。
- 客户端断流后先读 Run `live`，终态后读 Transcript；不能把断流当成 Run failed。
- Run 终态写入顺序保持：Pi terminal entry -> 主库终态条件更新 -> 唯一 terminal event -> release registry/lease。
- API 启动恢复扫描非终态 Run，按 `runId/sessionId/lane/agentId/agentRevision` 校验唯一 terminal entry；缺失、重复、损坏或身份不匹配都标记 interrupted/corrupted，不能猜测恢复。

### 7. Tool contract 和执行位置

第一阶段只做可信 TypeScript Tool package：由 AI 平台部署时安装并注册到 `AiToolRegistry`。Tool contract 固定：

- `name`、`description`、`version`。
- 输入 schema 和输出安全边界。
- tenant/project 范围。
- required permission 或产品授权声明。
- timeout、AbortSignal、并发和取消行为。
- audit 字段、error code、safeSummary。

平台统一执行：Agent allowlist、schema parse、权限、timeout、取消、审计 begin/finalize、model-facing safe result 和 client-facing safe summary。浏览器不能上传 handler；Agent 只引用 Tool 名称和版本。

远程 Tool、签名 endpoint、重试、幂等和跨服务上下文传递只记录为后续扩展，不在本任务实现。

### 8. OpenAPI 和公开文档

- 现有路径先保持兼容，不为了命名重构一次性搬迁所有 URL。
- OpenAPI tag 至少区分 `AI Control`、`AI Runtime`、`AI Compatibility`。
- `/doc` 标题和描述不再只写 Starter 通用 API；文档需注明 Admin 控制面、产品运行面和 Starter 兼容接口。
- 每个运行接口必须记录认证方式、scope 来源、请求字段、SSE 事件、断线恢复、终态和错误码。
- 运行协议文档必须明确当前实现限制：单进程 active registry、SSE 进程内队列、Pi SQLite、Starter scope 适配。
- contracts 只导出 schema、DTO、错误码和 HarnessEvent；不导出 API route 内部类型。

## Out of Scope

- 不实现 React Flow、DAG、Workflow Definition 或工作流执行器。
- 不实现远程 Tool endpoint、Webhook、队列、分布式 active registry 或跨节点 Run 调度。
- 不实现 SDK 包，但要提供足够的 OpenAPI 和 contracts 作为后续 SDK 输入。
- 不在本任务同时做独立数据库拆分、独立部署脚本或完整 OAuth/OIDC 平台。
- 不让浏览器直连并持有 AI 平台应用凭据。
- 不把 Admin Agent 聊天页面迁移到 API；Admin 子任务另行处理。
- 不删除现有 Starter Cookie 兼容入口，直到应用凭据运行路径和 Web 验证完成。

## Acceptance Criteria

### 结构和依赖

- [ ] `apps/api` 不导入 `apps/admin`、`apps/web` 或 Admin 私有 Harness 类型。
- [ ] `packages/contracts` 不导入 Better Auth、Pi 类型、数据库 schema、Admin reducer 或 Web 组件。
- [ ] AI route 明确标注 control/runtime/compatibility 分类。

### 身份和资源

- [ ] 有统一 `PrincipalContext`、`ResourceScope` 和认证 adapter 的设计/实现位置。
- [ ] Better Auth 请求能映射到兼容 scope；应用凭据请求从凭据派生固定 tenant/project，不能信任请求体覆盖。
- [ ] Session、Run、Transcript 的读取和写入都执行 scope/subject 归属检查。
- [ ] 越权、错误 scope、错误 externalUserId 和已归档资源不泄露存在性。

### 控制面

- [ ] Provider secret 只在 credential store/infra 中读取，不能出现在 Agent snapshot、运行 DTO、SSE、日志或 contracts。
- [ ] Agent revision、启用校验和 Run snapshot 规则有代码测试。
- [ ] Tool list 只返回公开 summary，不返回 schema、handler、内部权限细节或 secret。

### 运行面

- [ ] 每个 HarnessEvent 通过 `harnessEventSchema` 校验，sequence 单调递增，terminal event 只发布一次。
- [ ] SSE 断开、队列超限、abort、provider failure、tool failure、Pi storage failure 和启动恢复分别有明确行为和测试。
- [ ] Run live snapshot、Transcript 和主库 Run 状态的事实边界在文档和测试中一致。
- [ ] Pi DB 与 Starter 主库职责不混淆；审计表不含敏感内容。

### 文档和验证

- [ ] `/doc` 在启用时显示 AI Control、AI Runtime、AI Compatibility 标签和准确描述。
- [ ] Admin 子任务和 Web 子任务可以只依据公开 contracts/OpenAPI 接入，不依赖 Admin 私有 reducer。
- [ ] API 相关测试、类型检查、Lint、Format、构建和 migration check 通过。

## 实施阶段依赖

1. **协议盘点与边界冻结**：无代码行为变化，确认现有路由、DTO、事件、DB 和适配层清单。
2. **公开 contracts 与 OpenAPI 分类**：先改 schema 文档/tag/生成契约，再改生产者和消费者。
3. **PrincipalContext/ResourceScope 适配层**：先接 Better Auth 兼容路径，保持现有 Starter 行为。
4. **产品应用凭据与固定 scope**：实现 app principal、credential scope、externalUserId/subject 校验，建立运行面调用入口。
5. **运行资源 scope 改造**：Session、Run、Transcript、Agent/Prompt/Skill/Tool 引用按 scope 检查；保留 Starter owner 适配。
6. **Tool contract 与可信 package**：统一注册元数据和执行安全规则，不做远程执行。
7. **运行协议回归与跨消费者验收**：验证非 Admin 调用样例，之后才启动 Admin/Web 子任务。

每个阶段单独通过本阶段验收后再进入下一阶段；任一阶段发现公共协议需要改变，回到阶段 2，先更新 contracts/OpenAPI/测试，再继续。

## Evidence

- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/modules/ai/configuration/*.ts`
- `apps/api/src/modules/ai/prompt/*.ts`
- `apps/api/src/modules/ai/skill/*.ts`
- `apps/api/src/modules/ai/agent/*.ts`
- `apps/api/src/modules/ai/session/*.ts`
- `apps/api/src/modules/ai/run/*.ts`
- `apps/api/src/modules/ai/tool/tool-registry.ts`
- `apps/api/src/modules/ai/usage-audit/*.ts`
- `apps/api/src/infra/ai/`
- `apps/api/src/infra/agent/`
- `apps/api/src/infra/db/migrations/0011_normal_sentinel.sql`
- `apps/api/src/infra/db/migrations/0012_far_lockjaw.sql`
- `apps/api/src/openapi/api-docs.ts`
- `apps/api/src/middleware/cors.middleware.ts`
- `packages/contracts/src/ai.ts`
- `.trellis/spec/api/backend/ai-system-design.md`
- `.trellis/spec/api/backend/ai-integration-guidelines.md`
- `.trellis/spec/api/backend/authentication-guidelines.md`
- `.trellis/spec/api/backend/authorization-guidelines.md`
