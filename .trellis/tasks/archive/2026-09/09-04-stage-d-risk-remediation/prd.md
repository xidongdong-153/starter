# 阶段 D 审查风险修复

## Goal

修复阶段 D 父任务集成审查与风险盘点发现的可执行问题：一个进程级崩溃隐患、两个行为级遗留、四个协议/配置一致性缺口、两个 admin 功能缺口和两处 spec 维护问题。全部为小改动，不改公开 URL、RunEvent wire format、Run 状态机或 policy 语义。

来源：`.trellis/tasks/archive/2026-09/09-03-api-ai-executable-runtime/implement.md` 的集成审查记录与风险盘点报告。

## Requirements

### API 运行时

- R1（崩溃防护）：`runToTerminal` 与 `finalizeRun` 的函数体最外层兜底 catch，任何收尾路径异常只记 error 日志（含 runId），不再产生 unhandled rejection。当前 7 个 `void` 调用点（`run.service.ts` 6 个 `void finalizeRun` + 1 个 `void runToTerminal`）在 Node 22 默认策略下会崩溃整个进程。
- R2（queue 生命周期）：`startRunTransport` 的 JSON 分支显式结束 start queue（调用 `result.events` iterator 的 `return()`），幂等命中或纯 JSON 启动后 queue 不再挂到 Run 终态积累最多 1024 个事件。`AsyncEventQueue.push` 对已关闭 queue 是 no-op，publisher 不受影响。

### contracts 与协议

- R3（常量源）：`@starter/contracts` 导出 `AI_EVENT_PROTOCOL_VERSION = 1` 常量；`executable-manifest.presenter.ts`、`run-sse.ts`、`webhook.dispatcher.ts`（两处）的字面量与 contracts 内 3 处 `z.literal(1)` 统一引用常量。
- R4（delivery DTO）：`aiWebhookDeliverySchema` 增加 `eventId`（uuid nullable）、`sequence`（int nullable）、`eventProtocolVersion`（literal nullable）三字段；API 投递记录查询投影这三列（数据库列已由 migration 0031 添加）。

### Webhook 配置

- R5（超时上限）：`AI_WEBHOOK_TIMEOUT_MS` 在 `parseEnv` 加上限校验（最大 30000ms），超过时启动失败并给出明确错误信息，防止 claim TTL（60s）被配置击穿后出现大量合法重复投递。

### 测试补盲

- R6：run-sse 客户端主动断开（reader cancel）分支的单测：断开后不发 `stream.resume_required` frame。
- R7：R2 的回归测试：JSON 模式启动（含幂等命中）后 start queue 立即结束，事件不积累。
- R8：R1 的回归测试：终态收尾路径抛错（如 `listByRun` 模拟失败）时进程不产生 unhandled rejection，Run 终态与既有测试行为不变。

### admin 功能缺口

- R9（policy 编辑）：AiApplications 页面增加 policy 编辑入口（行操作 + Modal），复用创建表单的 policy 字段结构（maxSideEffect / controls / executables），提交走 `PATCH /api/ai/admin/applications/{appId}/policy`；zh/en i18n 同步；编辑后列表刷新。revoked 凭据不显示编辑入口。
- R10（Agent 全量）：policy 表单的 Agent 选择器改为循环分页拉取全部启用 Agent（pageSize 上限 100 是 schema 约束，不改协议），替代当前只取第一页 100 条的 `useAgentDefinitionsQuery({ page: 1, pageSize: 100 })`。

### spec 修正

- R11（过时描述）：删除 `ai-system-design.md` §8 中「`GET /api/ai/agents` 当前用的是 `requireAuth`，应用凭据调不通；OpenAPI security 只声明 cookieAuth」的过时段落，替换为现状（`requireRuntimePrincipal` + `runtimeSecurity`，product_app 可读 enabled Agent summary 与 executable manifest）。
- R12（注入超限）：`ai-system-design.md` 当前 40713 字节，超过 `context_injection.max_file_bytes`（32768），子代理注入时尾部约 8000 字节被截断。将 Webhook 节拆分为独立 spec 文件并去除与 `agent-run-guidelines.md` 重复的条目（policy 检查点、SSE frame 细节），使文件降到 32768 字节以下，`index.md` 同步链接。

## Acceptance Criteria

- [x] R1：构造终态收尾异常的测试场景下无 unhandled rejection（`run-event-recovery.test.ts` 的 unhandledRejection 收集断言 + Run 落终态），全部既有 Run 测试不红。注入点为 spy `laneLeaseStore.release` 抛错（`RuntimeDeps` 无 listByRun 注入点，与 design 的已声明偏离）。
- [x] R2：JSON 模式启动后 start queue 立即关闭（`run-transport.test.ts` returnCalls 断言 + `run-event-recovery.test.ts` 幂等命中 endSpy 断言），SSE 模式行为不变。
- [x] R3：contracts 导出 `AI_EVENT_PROTOCOL_VERSION`，生产代码 grep 无裸字面量；zod literal 推导类型不变。
- [x] R4：投递记录响应含三个新字段，与 `ai_webhook_deliveries` 行值一致（`ai-webhook.test.ts` e2e + interrupted null 断言）。
- [x] R5：`AI_WEBHOOK_TIMEOUT_MS=60000` 启动失败且错误信息含上限与 claim TTL 说明；默认值不变（check 子代理实测）。
- [x] R6：`run-event-recovery.test.ts` 新增断开分支单测，断言无 frame 输出。
- [x] R9：admin 可对 active 凭据编辑 policy（提交 payload 断言、错误分支、revoked 无入口、i18n 键对齐均有测试）；不在启用列表的 Agent 保留原 version（有意差异，有注释）。
- [x] R10：分页拉取有终止条件（页不满 / 20 页上限），单页、跨页、上限三场景测试。
- [x] R11：`ai-system-design.md` 不再包含 requireAuth 过时描述。
- [x] R12：`ai-system-design.md` 32732 字节 < 32768；`task.py validate` 无截断 warning；`webhook-guidelines.md` 在 `index.md` 注册。
- [x] 全量验证：API check-types / lint / format:check / test（66 文件 479 用例）、admin test（20 文件 118 用例）、根级 format:check、`pnpm build`、`git diff --check` 全部通过。

## Out Of Scope

- 多实例 dispatcher 真实多进程实测、SSE 心跳集成测试（验证盲区，无代码修复项）。
- Tool / Output Contract 跨部署版本漂移的运行时防护（维持「漂移视为定义错误」约定）。
- rate / concurrency / budget 限额、历史 revision 执行、中间事件订阅（阶段 D Out of Scope 不变）。
- webhook dead delivery 手工重投。
- D 类协议语义对接须知（已记录在案，非代码改动）。
