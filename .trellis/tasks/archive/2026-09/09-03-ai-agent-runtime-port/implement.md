# D2 实施计划：窄运行端口与共享 Transport

## 前置门槛

- [x] 确认 D1 `09-03-ai-executable-manifest` 已归档，当前任务仍为 `09-03-ai-agent-runtime-port`。
- [x] 用户审阅并明确批准本计划后，运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/09-03-ai-agent-runtime-port`；本阶段不提前启动。
- [x] 启动实现代理时使用 `max` 思考强度；优先尝试 `luna:max`，不可用时使用当前可用模型但保持 `max`。（luna 因 OpenRouter key 缺失不可用，改用喜东东-free/gpt-5.6-luna，最终复核用 AgentRouter-Linux/glm-5.3，均 max）
- [x] 实现前加载 `trellis-before-dev`，并按任务 JSONL、PRD、设计和本实施计划读取 API/contracts 规范。

## 实施顺序

### 1. 定义端口和适配器

- [x] 新建 `apps/api/src/modules/ai/runtime/agent-runtime.port.ts`，声明 `AgentRuntimePort`、启动输入/结果和 `{ afterSequence } | { lastEventId }` 游标。
- [x] 确认 port 文件不 import Hono、repository、Pi 包、service factory 或 service `ReturnType`。
- [x] 新建 adapter，使用结构化 backend 方法集合映射现有 Run/Session service；`sequenceForEvent` 只存在于 adapter 内部。
- [x] 从 AI 模块入口导出 port 类型和构造函数；在 `createAiServices()` 创建并返回 `runtimePort`。

### 2. 修正启动事件 iterable 生命周期

- [x] 让 RunEvent publisher 的成功持久化事件同时进入 `startRun()` 返回的初始 queue 和恢复 subscribers。（publisher sink 同时 push `context.events` 与 subscribers）
- [x] 在所有 `commitTerminal()` 结果路径关闭初始 queue，保证正常终态、存储失败和终态事务未提交都不会悬挂。（`commitTerminal` 加 try/catch，`context.events.end()` 无条件执行）
- [x] 确保 SSE iterator 的提前 return 会结束初始 queue，但不触发 Run abort；保留已有恢复 subscriber 的清理行为。（`AsyncEventQueue` iterator 增加 `return()`；`replayAndSubscribe` 改为可显式关闭的 iterator，`return()` 同步移除 subscriber）
- [x] 不修改 RunEvent schema、sequence 分配、状态机、lease、attempt、retry 或数据库结构。

### 3. 提取共享 transport

- [x] 新建 `apps/api/src/modules/ai/run/run-transport.ts`。
- [x] 实现 `startRunTransport`：统一当前 Accept 矩阵，JSON 使用既有成功 envelope，SSE 直接传递 `start()` 的 events iterable。
- [x] 实现 `resumeRunTransport`：`afterSequence > 0` 优先，只有 query 为 0 时才把 Last-Event-ID 交给 port；不在 route 中调用 `sequenceForEvent`。
- [x] 继续复用 `writeRunEventStream`，不加入 D3 的 `stream.resume_required` frame。

### 4. 迁移三个运行入口

- [x] 修改 `apps/api/src/modules/ai/run/run.route.ts`，把公共运行动作改为 `runtimePort`，管理只读动作保留最小 Run Service 依赖。（timeline/trace/adminStructuredOutputs 保留 `Pick` 只读依赖）
- [x] 修改 `apps/api/src/modules/chat/chat.route.ts`，移除完整 `AiServices` 入参；保留 Agent list、Session CRUD、附件端口，运行和 transcript 改走 `AgentRuntimePort`。
- [x] 修改 `apps/api/src/modules/flow/flow.route.ts`，移除完整 `AiServices` 入参；保留 Agent list、Session create，运行、transcript 和 outputs 改走 `AgentRuntimePort`。
- [x] 修改 `apps/api/src/routes/index.ts`、`apps/api/src/modules/ai/ai.route.ts` 的依赖装配，不改公开 URL、middleware、OpenAPI schema 或 principal 构造。
- [x] 清除三份 route 中重复的 Accept、Last-Event-ID 和 SSE writer 调用。

### 5. 增加针对性测试

- [x] 新建 `apps/api/src/test/agent-runtime-port.test.ts`：验证方法映射、`afterSequence` 透传、`lastEventId` 转换、transcript/outputs 映射，以及端口文件的静态依赖边界。
- [x] 新建 `apps/api/src/test/run-transport.test.ts`：覆盖缺省、`*/*`、仅 SSE、仅 JSON、同时包含两种媒体类型；断言 JSON/SSE envelope 不变。
- [x] 在 transport 测试中断言 start 返回的 iterable 被直接消费，`subscribe(0)` 不被调用；终态后 writer 停止迭代并执行 iterator cleanup。
- [x] 在恢复测试中断言 `afterSequence > 0` 忽略 Last-Event-ID、`afterSequence=0` 使用 Last-Event-ID、未知 eventId 仍返回 400。（既有 AI 路由级 400 断言 + `resolveRunEventCursor` 单测）
- [x] 扩展 `apps/api/src/test/product-modules.smoke.test.ts` 或同范围测试，覆盖 chat/flow 的 start JSON/SSE、chat active/transcript 和 flow outputs 同构。
- [x] 保留并运行已有 `apps/api/src/test/run-event-recovery.test.ts`、`apps/api/src/test/ai-cross-product-runtime.test.ts`，验证断开不 abort、正常 terminal 不丢事件。（并新增三条：恢复流取消清理、终态事务 false、终态事务 throw）

## 验证顺序

每轮代码修改后按项目质量门禁执行，前一项失败先修复再进入下一项：

1. `pnpm --filter @starter/contracts check-types`
2. `pnpm --filter @starter/api check-types`
3. `pnpm --filter @starter/contracts lint`
4. `pnpm --filter @starter/api lint`
5. `pnpm --filter @starter/contracts format:check`
6. `pnpm --filter @starter/api format:check`
7. `pnpm --filter @starter/api test -- agent-runtime-port.test.ts run-transport.test.ts product-modules.smoke.test.ts run-event-recovery.test.ts ai-cross-product-runtime.test.ts`
8. `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-ai-agent-runtime-port`
9. `git diff --check`

代码稳定后：

- [x] 运行 `trellis-check`，检查 spec 合规、跨层数据流、依赖边界、复用和剩余行为风险。（共三轮：第一轮发现恢复流 subscriber 泄漏 P1，修复后第二轮确认修复成立，最终轮无行为级 finding，仅 P3 死代码已删）
- [x] 运行 `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`。（另通过 `pnpm --filter @starter/api db:check`、`git diff --check`）
- [x] 读取 `trellis-update-spec`，把已验证的 AgentRuntimePort、初始事件 queue 生命周期和共享 transport 规则写入 `.trellis/spec/api/backend/`，并更新相关 index；不扩展到 D3 policy 或 Webhook。（`agent-run-guidelines.md`、`product-module-guidelines.md` 已更新并复核补充 subscriber 生命周期条目）
- [x] 更新本任务 PRD/实施清单中的验收状态和验证记录，保留失败尝试及修复原因。（见下方验证记录）
- [ ] 向用户展示提交摘要，获得明确确认后再执行 commit；提交前不得 `git commit`、`git push` 或归档。
- [ ] 提交并归档 D2 后，保持 D3 `09-03-ai-app-capability-policy` 为 planning，不在本任务内启动。

## 验证记录

- 首轮实现后：`pnpm check`（type/lint/format）、D2 专项测试 42 条、`pnpm test`（API 462 / Admin 112 / Web 91）、`pnpm build`、`db:check`、`task.py validate`、`git diff --check` 全部通过。
- 第一轮 trellis-check 发现 P1：恢复 SSE 在挂起的 subscriber `next()` 上断开时，仅等待外层 async generator 的 `return()`（按规范排在挂起的 `next()` 之后），subscriber queue 与 waiter 挂到下一事件或终态。修复：`replayAndSubscribe` 改为可显式关闭的 iterator（`return()` 同步移除 subscriber 并结束 queue）；`AsyncEventQueue` iterator 增加 `return()` 清理；`commitTerminal` 包 try/catch 并无条件 `context.events.end()`。修复中引入一处 TS2554（同步 generator `return` 需传参）与一处 lint `no-unmodified-loop-condition`，均已修正。
- 补充三条回归：恢复流取消立即清理（`AsyncEventQueue.prototype.end` spy 在 gate 未释放时断言）、终态事务返回 false、终态事务抛异常（DROP TABLE）——均验证 start queue 关闭且不伪造 terminal event。
- 修复后全量：`pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`（API 65 文件 465 / Admin 112 / Web 91）、`pnpm build`、`db:check`、`git diff --check` 全部通过。
- 最终 trellis-check（AgentRouter-Linux/glm-5.3，max）：无行为级 finding；确认 P1 修复成立、终态 false/throw 清理序列一致、三个 queue 使用方无回归、静态边界干净、spec 一致。P3 死代码（`run.service.ts` 不可达 return）已删除。
- 残余风险（非本次引入，不阻塞）：`finalizeRun` 中 `listByRun` 抛错时 `runToTerminal` 为 unhandled rejection；JSON 模式幂等命中丢弃 iterable 后 subscriber queue 挂到终态（1024 上界，与旧行为一致）。

## 高风险文件与回滚点

- 高风险文件：`run.service.ts`、`run-sse.ts`、`run-transport.ts`、`agent-runtime.adapter.ts`、三个运行 route、`ai.services.ts`、`routes/index.ts`。
- 事件风险回滚点：若初始 stream 出现丢首事件、永久等待或重复 sequence，先停在 queue/publisher 生命周期修复，不能用二次 `subscribe(0)` 作为补丁。
- 依赖风险回滚点：若 chat/flow 类型推断失败，只缩小 route 入参和显式 `Pick`，不恢复完整 `AiServices` 作为产品模块依赖。
- 兼容风险回滚点：若 Accept 或 Last-Event-ID 行为变化，以既有 AI route 测试和 contracts 为基准修正 helper；不修改 URL、DTO 或 RunEvent。
