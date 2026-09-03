# Pi 复用能力评估

## 调研基线

- 源码目录：`/Users/wuwanzhu/Code/pi`
- 当前 HEAD：`a470b121bf683b4c2b9fc0b3a7c807de7e0cfe9c`
- Git 描述：`v0.84.2-101-ga470b121b`
- package manifest 版本：`0.84.2`
- starter 当前固定版本：`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-session-backend-sqlite-node`、`@earendil-works/pi-telemetry` 均为 `0.84.1`

本结论描述当前检出的 `pi` 源码。它比 `v0.84.2` tag 多 101 个提交，不能把未发布源码中的行为直接当成 starter 当前 `0.84.1` 依赖已有的行为。

## 结论

之前关于 `HarnessNotImplemented` 的结论仍然成立，而且范围不是个别边角方法：当前 `AgentHarness` 不能执行一次 Agent Run。

可直接复用的是以下三层：

1. `pi-ai` 的 provider、模型目录、认证、流式模型调用、tool schema 和跨 provider 消息协议。
2. `pi-agent-core` 的 `Agent`、低层 agent loop、tool 执行、运行事件、compaction helper 和 session context helper。
3. v4 `Session` 抽象及 SQLite session backend 的持久会话树、lane、entry、record、fork、统计和写者租约。

当前不应把 `AgentHarness` 接到生产 Run 主流程。starter 已采用的组合是正确的：API 自己管理 Run、权限和产品事件，内部用 `Agent` 执行，用 `Session`/SQLite backend 保存 transcript。继续沿这条路径比等待或补写 Harness 风险更低。

## 复用矩阵

| 能力 | 当前状态 | 是否直接复用 | 说明 |
| --- | --- | --- | --- |
| `pi-ai Models` | 已实现 | 是 | provider 注册、模型查询、认证、stream/complete、deferred API 均有实际实现 |
| `pi-agent-core Agent` | 已实现 | 是 | prompt、continue、tool、steer、follow-up、abort、事件和内存状态可用 |
| 低层 `agentLoop` | 已实现 | 有条件 | 适合需要自管状态的执行器；事件处理不是 barrier |
| compaction/branch summary helper | 已实现 | 是 | helper 独立导出，调用方负责触发、持久化和失败状态 |
| v4 `Session`/`SessionRepo` | 已实现 | 是 | 可脱离 Harness 单独使用 |
| In-memory backend | 已实现 | 测试或短生命周期 | 进程退出即丢失 |
| JSONL backend | 已实现 | 有条件 | 适合本地文件会话；服务端多实例写入要另评估 |
| SQLite backend | 已实现 | 是 | starter 当前已经接入；需遵守单 session 单写者租约 |
| `AgentHarness` 配置 getters/setters | 已实现 | 不建议单独采用 | 只改 Harness 内存字段，不形成可运行 Harness，也不持久化配置 entry |
| `AgentHarness` Run/恢复/事件 | 未实现 | 否 | 当前统一抛 `HarnessNotImplemented` |
| Harness reducer/event bus | 内部 helper 已实现 | 否 | 没有接入 `AgentHarness`，也不是当前根导出的运行路径 |

## `pi-ai` 可复用范围

`@earendil-works/pi-ai` 可以作为 API 的模型接入层，边界清楚：

- `Models` 根据 `model.provider` 找到 provider，再处理认证并调用 provider 的 stream 实现。
- `createModels()` 只创建容器；应用按需调用 provider factory 注册 provider。
- `providers/all` 会加载全部内置 provider 目录。只需要少量 provider 时可用 `providers/<provider>`，避免把完整目录和 SDK 可达路径带进 bundle。
- `CredentialStore` 是应用注入点。持久凭据、加密和租户归属仍由 API 管理。
- `ModelsStore` 可保存动态模型目录；它不负责产品侧 provider 配置记录。
- `stream()`/`streamSimple()` 返回 `AssistantMessageEventStream`，提供 text、thinking、tool call、done 和 error 事件。
- tool 参数使用 TypeBox schema；自行执行 tool 时可调用 `validateToolCall()`。
- `streamSimple()`/`completeSimple()` 提供跨 provider 的统一 reasoning 参数。
- `fetchDeferred()`/`cancelDeferred()` 已在 `Models` 实现，但只有 provider 支持时才可调用。

需要保留的错误语义：普通模型请求、认证失败和 abort 通常不会从 stream 抛出，而是以 `error` 事件和 `AssistantMessage.stopReason = "error" | "aborted"` 返回。`getAuth()`、登录、持久存储等管理 API 仍可能 reject。API adapter 必须同时处理这两种失败通道。

主要依据：

- `packages/ai/README.md`
- `packages/ai/src/models.ts:156`
- `packages/ai/src/models.ts:678`
- `packages/ai/src/types.ts:314`
- `packages/ai/src/types.ts:405`
- `packages/ai/src/index.ts`

## `pi-agent-core` 可复用范围

### `Agent`

`Agent` 是当前可运行的主路径，具备：

- 内存 transcript、system prompt、model、thinking level 和 tools 状态。
- `prompt()`、`continue()`、`abort()`、`waitForIdle()`。
- steering 和 follow-up 队列及 `one-at-a-time`/`all` 模式。
- tool 参数校验、串行或并行执行、进度事件、`beforeToolCall`/`afterToolCall`。
- `shouldStopAfterTurn` 和 `prepareNextTurnWithContext`，可实现最大轮数和下一轮上下文调整。
- `agent_start`、turn、message、tool execution、`agent_end` 等运行事件。

`Agent.subscribe()` 的 listener 按注册顺序等待，`agent_end` listener 完成后 Run 才 settled。因此把 transcript 持久化放在 `Agent.subscribe()` 里，可以让“事件已处理”成为执行完成的一部分。starter 当前 `agent-executor.ts` 和 `pi-event-mapper.ts` 已按这个模式工作。

`Agent` 本身不保存 durable operation，也不会在进程重启后恢复正在执行的 tool。它的 queue、active run、partial message 和 pending tool call 都是内存状态。进程崩溃后的 Run 判定、补写终态或重试策略必须由 API 管理。

### 低层 loop

`agentLoop()`/`agentLoopContinue()` 可单独复用，但它们的事件是 observational stream，不等待异步事件处理完成。需要“assistant message 已持久化后才能开始 tool”的场景，应继续使用 `Agent`，不要改成裸 loop 后假设相同 barrier 语义。

### helper

根入口还直接导出了：

- compaction 和 branch summary helper；
- `buildSessionContext()`，用于从 branch entry 生成当前模型上下文；
- skill、prompt template、system prompt helper；
- read/write/edit/bash 等 harness tool helper；
- telemetry schema 和 helper。

这些 helper 可独立使用，不要求创建 `AgentHarness`。starter 已直接使用 `prepareCompaction()`、`compact()`、`buildSessionContext()`，这属于当前支持的组合方式。

主要依据：

- `packages/agent/README.md`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/harness/session/context.ts`
- `packages/agent/src/index.ts`
- `apps/api/src/infra/agent/agent-executor.ts`
- `apps/api/src/infra/agent/pi-event-mapper.ts`

## `AgentHarness` 核对结果

### 明确未实现的方法

`packages/agent/src/harness/agent-harness.ts` 当前把以下方法全部转到 `unavailable()`：

- Run：`prompt`、`skill`、`promptFromTemplate`。
- 结构操作：`compact`、`navigateTree`、`resume`。
- 控制和队列：`abort`、`steer`、`followUp`、`nextRun`、`cancelQueued`。
- 运行管理：`waitForIdle`、`runWhenIdle`、`peekAction`、`executeAction`、`runToCompletion`。
- 观察：`watch`、`watchSession`、`events.on`、`hooks.on`。
- lane：`lane`、`createLane`、`lanes`。
- usage：`recordUsage`。

`unavailable()` 在 Harness 未关闭时 reject `HarnessNotImplemented`，关闭后 reject `HarnessClosed`。

### `create()` 也没有恢复能力

`AgentHarness.create()` 只检查 session 是否存在任何 record：

- 没有 record 时，返回新 Harness 和空 `suspended` 数组。
- 只要已有一条 record，就抛 `HarnessNotImplemented("create.restore")`。

所以 `suspended`、durable operation record、resume 类型和 reducer 类型虽然已定义，当前 facade 不能恢复它们。

### 已实现部分不足以运行

当前实际可用的 Harness 方法只有：

- `getLeafId()` 委托给 session；
- model、thinking level、active tools、tools、resources、stream options、retry、compaction settings、queue mode 的内存 getter/setter；
- `close()` 设置 closed 标记。

这些 setter 没有向 session 写入 `model_change`、`thinking_level_change` 或 `active_tools_change` entry。把它们当作 durable configuration 会丢状态。

`packages/agent/src/harness/reducer.ts` 已能校验 record log 并推导 lane recovery state，`packages/agent/src/harness/events.ts` 也有 event bus，但源码搜索显示它们没有被 `AgentHarness` 调用。根入口没有导出 reducer 和 event bus。它们只能说明设计和底层算法已有进展，不能说明 Harness facade 可运行。

`packages/coding-agent/src/server/create-harness.ts` 也不能改变这个结论。它负责组装默认 tool、system prompt 和环境变量，然后调用同一个 `AgentHarness.create()`。对应测试只验证构造、getter 和 tool wrapper，没有调用 `harness.prompt()`。

最直接的证据：

- `packages/agent/src/harness/agent-harness.ts:74`
- `packages/agent/src/harness/agent-harness.ts:348`
- `packages/agent/src/harness/agent-harness.ts:355`
- `packages/agent/test/harness/agent-harness-scaffold.test.ts:56`
- `packages/agent/test/harness/agent-harness-scaffold.test.ts:136`
- `packages/agent/CHANGELOG.md` 的 `0.84.0` 明确称其为 compile-complete scaffold

因此，`HarnessNotImplemented` 仍是当前架构决策的硬条件。不能因为类、类型、coding-agent factory 或 recovery reducer 已存在，就把 Harness 标记为可复用执行层。

## Session backend 与状态管理

### v4 Session 抽象

`Session`/`SessionTree`/`SessionRepo` 可脱离 Harness 使用，提供：

- session metadata、name、label 和统计；
- entry/record 共享递增 `seq`；
- message、model change、thinking change、active tools、compaction、branch summary、custom entry；
- operation、abort、step attempt、tool start、queue、deferred write、usage record；
- lane 创建、移动、branch 查询；
- branch 或整棵 tree fork；
- open operation 查询和顺序 log。

`buildSessionContext()` 会从当前 branch 生成模型上下文：最新 compaction 以前的 entry 被替换为 compaction summary 和 retained tail；deferred assistant message不会直接进入上下文；custom entry 需要应用提供 projector。

### SQLite backend

`@earendil-works/pi-session-backend-sqlite-node` 当前可直接复用。它使用 Node 内置 `node:sqlite`，package 要求 Node `>=22.19.0`，并提供：

- migration 和 materialized branch cache；
- 有界 branch、entry、record 和 log 查询；
- session metadata、fork、stats；
- 独立 FTS5 search service；
- `BEGIN IMMEDIATE` 同步事务；
- 每个 session 的 fenced writer lease、heartbeat 和失主 fencing；
- repository 级串行队列和 `AsyncDisposable`/`close()`。

同一个 repository 内重复 open 同一 session 会共享 storage 和写队列。不同 repository 或不同进程同时 open 同一 session 时，第二个写者会被拒绝，直到第一个释放 lease 或 lease 过期。starter 当前 repository 会长期保存已打开 session 的 storage，通常到整个 repository `close()` 才释放。因此多实例 API 不能让任意实例同时写同一 session，必须做 session affinity、单写者路由或更换后端。

SQLite v4 在 `0.84.0` 替换了旧 schema，changelog 明确写明旧 work-in-progress database 不迁移。升级前必须保留针对真实 session 数据库的迁移或重建检查。

starter 的 `pi-session-store.ts` 已证明这层可以独立适配：它包装 `SqliteSessionRepository`，只向业务层导出 create/open/read/append/lane/close，不让业务模块直接依赖底层 storage。

主要依据：

- `packages/agent/src/harness/session/session.ts`
- `packages/agent/src/harness/session/types.ts`
- `packages/agent/src/harness/session/state.ts`
- `packages/session-backends/sqlite-node/README.md`
- `packages/session-backends/sqlite-node/src/sqlite/repo.ts`
- `packages/session-backends/sqlite-node/test/writer-leases.test.ts`
- `packages/session-backends/sqlite-node/CHANGELOG.md`
- `apps/api/src/infra/agent/pi-session-store.ts`

## 依赖边界

建议保持以下方向：

```text
apps/api product services
  -> AgentExecutor adapter
     -> @earendil-works/pi-agent-core Agent + helpers
        -> @earendil-works/pi-ai Models
  -> AgentSessionStore adapter
     -> @earendil-works/pi-session-backend-sqlite-node
        -> @earendil-works/pi-agent-core Session contracts
  -> product database / event store / auth / tenant scope
```

各层职责：

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| `pi-ai` | provider 协议、认证调用、模型目录、流事件、消息/tool schema | 用户权限、Run 状态、业务事件、session 持久化 |
| `Agent` | 单进程内一次 Run 的 loop、tool、queue、abort、运行事件 | 崩溃恢复、幂等、跨进程锁、产品终态 |
| `Session` backend | transcript tree、lane、entry/record、fork、存储一致性 | 谁能访问 session、产品 Run 表、HTTP/SSE 协议 |
| API adapter | Pi 类型与产品 contract 的转换、持久化顺序、错误码映射 | provider wire protocol、Session 内部 SQL |
| API product service | principal/tenant/project scope、幂等、Run 生命周期、订阅、webhook | Pi 内部 partial message 结构 |

不要让 Pi session entry 替代产品 Run 表，也不要让产品事件表替代 Pi transcript。前者记录可回放的对话树，后者记录对外可查询的业务生命周期。两边关联时使用稳定的 `sessionId`、`runId`、entry id，并明确哪个写入失败会让 Run 失败。

## 主要风险

1. **误用 Harness**：公开类型很完整，但主方法全部未实现。接入后会在第一条 prompt 直接失败。
2. **版本来源混淆**：本次源码是 `0.84.2` tag 后 101 个提交，starter 仍是 `0.84.1`。评审和升级必须针对实际 npm 包或确定 commit，不可只看当前源码目录。
3. **0.x breaking change**：`0.84.0` 已整体替换 Session API 和 SQLite schema。继续固定精确版本，并在升级时跑 adapter 和真实数据库检查。
4. **单 session 单写者**：SQLite writer lease 会阻止第二个进程 open 同一 session。水平扩容前必须设计路由，不能把它当成普通多写数据库连接池。
5. **同步 SQLite**：`node:sqlite` 的 statement 和事务是同步调用；高并发、大 transcript 或 FTS 查询可能占用 Node event loop。需要用负载测试决定是否拆 worker 或换 backend。
6. **Run 无 durable resume**：`Agent` 崩溃后不能恢复半完成 tool；当前 API 只能根据自己的 Run 记录和 terminal entry 判定失败、补写终态或重新执行。
7. **双状态源**：产品数据库、Pi transcript 和内存 `Agent.state` 同时存在。必须规定 transcript、Run status、SSE event 各自唯一写入口，避免重放时互相覆盖。
8. **usage 统计不自动产生**：`SessionStats` 只有写入 `usage` record 才累计 token/cost。只 append message 和 compaction 不会自动得到完整费用统计。
9. **事件语义不同**：`Agent.subscribe()` 会等待 listener，裸 `agentLoop()` 不会；`pi-ai` 事件按 content index 关联且不同 block 可交错；Harness events 当前不可用。
10. **权限不是 Pi 能力**：Pi README 明确没有内置文件、进程、网络或凭据权限系统。API tool adapter 和部署环境必须继续承担限制与审计。
11. **deferred 生命周期不完整**：`pi-ai` 能 fetch/cancel deferred response，但 `AgentHarness.resume()` 未实现，`Agent` 也不提供 durable deferred operation 恢复。启用前需由 API 定义持久状态和轮询/取消流程。

## 当前建议

近期保持 starter 现有结构：

- 继续复用 `pi-ai Models` 和 provider factory。
- 继续用 `Agent` 作为执行 loop，不切换 `AgentHarness`。
- 继续用 `Agent.subscribe()` 把 Pi 事件映射并持久化为产品事件。
- 继续通过 `AgentSessionStore` 适配 SQLite backend，不让 service 直接操作 Pi repository。
- compaction、branch context 和 tool helper 按需独立复用。
- 产品数据库继续负责权限、幂等、Run 状态、事件订阅和恢复扫描。

只有以下条件同时满足后，才重新评估 Harness 替换：

- `agent-harness-scaffold.test.ts` 不再断言 `HarnessNotImplemented`；
- `prompt`、tool、abort、queue、compact、navigate、watch 均有实现级测试；
- `create.restore` 能从已有 record 返回 suspended operation；
- Harness event/hook registry 接入 facade；
- SQLite/JSONL backend 通过同一套 Harness crash recovery 测试；
- starter 能删除现有执行和恢复代码，而不是保留两套状态机。

## 验证记录

源码检查确认：

- `AgentHarness` 所有执行方法仍调用 `unavailable()`。
- scaffold test 明确枚举并断言上述方法抛 `HarnessNotImplemented`。
- reducer 和 event bus 没有被 `AgentHarness` 引用。
- starter 当前确实使用 `new Agent()` 和独立 `SqliteSessionRepository` adapter。
- `/Users/wuwanzhu/Code/pi` 工作区检查时无未提交改动。

定向测试未能在当前本地依赖状态运行：

- Harness test：`test/harness/agent-harness-scaffold.test.ts` 在收集阶段失败，缺少生成文件 `packages/ai/src/providers/data/amazon-bedrock.json`，没有执行测试。
- SQLite test：`test/conformance.test.ts`、`test/writer-leases.test.ts` 启动失败，`packages/session-backends/sqlite-node` 当前无法解析 `vitest/config`，没有执行测试。

这两个失败是当前 `pi` checkout 的依赖/生成数据未完整 hydrate，不是被测断言失败。本结论以当前源码、README、changelog 和仓库内测试断言为依据。
