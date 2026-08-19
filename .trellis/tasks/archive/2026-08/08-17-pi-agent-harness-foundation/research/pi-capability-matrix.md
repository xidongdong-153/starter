# Pi 能力与 Starter 适配矩阵

## 检查范围

- 本地 Pi 源码：`/Users/wuwanzhu/Code/pi`
- 本地 package 版本：`0.84.1`
- npm tarball 复核版本：`0.84.2`
- Starter 当前依赖：`@earendil-works/pi-ai@0.84.1`

## 结论

Pi 已经提供 Agent runtime 和完整 Session 基础设施，但当前 `AgentHarness` 公开类不是可直接投入 Web API 的成品。Starter 应直接组合已完成的底层组件，并在 API 内保留一层很薄的应用适配。

## 能力矩阵

| 能力 | Pi 组件 | 结论 | Starter 动作 |
| --- | --- | --- | --- |
| 模型目录、Provider、统一 stream | `@earendil-works/pi-ai` | 直接使用 | 保留现有 `infra/ai` 配置、凭据和模型策略装配 |
| Agent 多轮循环 | `Agent`、`agentLoop` | 直接使用 | 删除后续新 Harness 中自行维护的工具循环 |
| Tool 参数校验和执行事件 | `AgentTool`、Agent events | 直接使用 | 把现有 Tool Registry 适配为 Pi Tool，不复制 loop |
| Steering、follow-up、abort | `Agent` | 运行期直接使用 | 仅维护 Run handle 和权限检查 |
| Session tree 和 transcript | Pi Session API | 直接使用 | 写 Session store adapter 和 DTO projector |
| lane、fork、branch、records | Pi Session API | 直接使用 | 默认只公开 `main`，后续按产品需要开放操作 |
| compaction 和 branch summary | Pi compaction API | 直接使用 | 通过 runtime policy 调用，不复制算法 |
| SQLite migration、branch cache、FTS | SQLite Session backend | 直接使用 | 使用独立数据库文件，让 Pi 管理 schema |
| writer lease | SQLite Session backend | 直接使用 | 映射为 Session lane busy 错误并记录 Run 失败 |
| 完整 Web Harness | `AgentHarness` | 当前不可用 | 不调用未实现操作；由薄 runtime adapter 拼装完成组件 |
| Web/RPC transport | `pi-server` protocol | 不采用 | 继续使用 Hono、OpenAPI、SSE 和 Starter envelope |
| Coding Agent 产品能力 | `pi-coding-agent` | 不采用 | 不引入 cwd、编码工具、CLI settings 和 TUI 约束 |
| Agent Graph / DAG | 无 | Pi 不提供 | 后续独立 Graph adapter，优先评估 LangGraph |

## `AgentHarness` 当前限制

`packages/agent/src/harness/agent-harness.ts` 已定义较完整的类型，但以下操作在 `0.84.1` 和 `0.84.2` 仍会抛出 `HarnessNotImplemented`：

- `prompt`
- `resume`
- `abort`
- `steer`
- `followUp`
- `watch`
- `createLane`
- hooks 和 events registry

因此 Starter 不能把 `AgentHarness` 实例直接挂到 Hono Route，也不能把这些类型当作已经兑现的运行承诺。

## Session SQLite 事实

- package：`@earendil-works/pi-session-backend-sqlite-node`
- 实现使用 Node.js `node:sqlite`。
- Repository 自己管理 SQLite connection 和 migration。
- 创建 Session 时必须提供 `cwd`，并可传 `id`、`parentSessionId` 和 opaque `metadata`。
- Repository 支持 create、open、list、delete、repair branch cache 和 search service。
- Session entries 和 records 使用 append-only 方式保存。
- 每个 Session 有 writer lease；默认 TTL 为 30 秒，heartbeat 为 10 秒。
- FTS 首次查询时创建并从 canonical entries 重建，之后由 trigger 同步。

## 数据库选择

Pi Session 使用独立 `agent-sessions.db`，不与 Starter 的 Drizzle `app.db` 共库。

原因：

- 两套 migration 由不同库控制，共库会形成 schema 所有权冲突。
- Pi backend 直接管理 connection、transaction、trigger、FTS 和 writer lease。
- Starter 不应通过 Drizzle 查询或修改 Pi 内部表。
- 独立文件便于备份、修复 branch cache、升级验证和故障隔离。

Starter 主库只保存 Session 和 Run 的业务索引。两个数据库之间不建外键，由 Service 使用同一个 UUID 关联，并提供一致性检查与修复命令。

## 版本策略

- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-session-backend-sqlite-node`

三个 package 在 workspace catalog 中固定为同一版本。升级时先检查 changelog、export 和 Session migration，再运行契约、恢复、并发和 SSE 测试。只有 Pi `AgentHarness` 的目标方法有实现和测试后，才评估用它替换 Starter runtime adapter。

## 源码依据

- `packages/agent/README.md`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/harness/agent-harness.ts`
- `packages/agent/src/harness/session/types.ts`
- `packages/session-backends/sqlite-node/README.md`
- `packages/session-backends/sqlite-node/src/sqlite/repo.ts`
- `packages/session-backends/sqlite-node/src/sqlite/migrations.ts`
