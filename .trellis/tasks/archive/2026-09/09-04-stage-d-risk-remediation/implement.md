# 执行计划

依据：本目录 `prd.md`（12 项）与 `design.md`。按依赖排序：contracts 先行（R3/R4），API 次之（R1/R2/R5/R6/R7/R8），admin（R9/R10），spec 最后（R11/R12）。

## 步骤 1：contracts 常量与 delivery DTO（R3、R4）

- [x] `packages/contracts/src/ai.ts`：导出 `AI_EVENT_PROTOCOL_VERSION = 1 as const`；三处 `z.literal(1)` 改引用常量。
- [x] `aiWebhookDeliverySchema` 加 `eventId`（uuid nullable）、`sequence`（int min 1 nullable）、`eventProtocolVersion`（literal nullable）。
- [x] API 侧四处字面量（`executable-manifest.presenter.ts`、`run-sse.ts`、`webhook.dispatcher.ts` ×2）改引常量。
- [x] 投递记录查询链补三列投影：repository select -> DTO 转换 -> openapi response。
- [x] `pnpm --filter @starter/contracts check-types && build`。

## 步骤 2：终态兜底与 queue 生命周期（R1、R2）

- [x] `run.service.ts`：`runToTerminal` / `finalizeRun` 函数体最外层 try/catch 兜底（记 error 日志含 runId，语义见 design R1）。
- [x] `run-transport.ts`：`startRunTransport` JSON 分支返回前 `await result.events[Symbol.asyncIterator]().return?.()`。
- [x] 跑 `pnpm --filter @starter/api check-types` 确认无类型断点。

## 步骤 3：env 上限（R5）

- [x] `apps/api/src/shared/env.ts`：`AI_WEBHOOK_TIMEOUT_MS` 加 `.max(30000)`，错误信息含 claim TTL 关系说明。
- [x] `webhook.dispatcher.ts` 常量旁注释更新为指向 env 上限校验。

## 步骤 4：测试补盲（R6、R7、R8）

- [x] R6：`run-event-recovery.test.ts` 加客户端断开分支单测（挂起 iterable + `res.body.cancel()`，断言无 `stream.resume_required`）。
- [x] R7：`run-transport.test.ts` 加 JSON Accept 断言 iterator `return()` 被调用（含幂等命中路径）。
- [x] R8：Run 测试注入抛错的 `structuredOutputRepository.listByRun`，临时监听 `process.on('unhandledRejection')` 断言零事件、Run 落终态。
- [x] `pnpm --filter @starter/api exec vitest run src/test/run-event-recovery.test.ts src/test/run-transport.test.ts src/test/ai-agent-runs.test.ts src/test/ai-webhook.test.ts --config vitest.config.ts`。

## 步骤 5：admin policy 编辑与全量 Agent（R9、R10）

- [x] `apps/admin/src/api/ai/application.query.ts`：加 `useUpdateAiApplicationPolicyMutation`。
- [x] 抽 `PolicyFormFields` 共享组件（maxSideEffect / controls / executables），创建与编辑共用。
- [x] `fetchAllEnabledAgentDefinitions(queryClient)`：循环分页拉取（终止条件：页条数 < pageSize 或 20 页上限），选择器数据源切换。
- [x] `AiApplications.tsx`：行操作加「编辑策略」（仅 active 显示）；编辑 Modal 提交后 invalidate 列表。
- [x] i18n zh/en 新增键并完全对齐。
- [x] `ai-applications.test.tsx` 扩展：编辑提交、revoked 无入口、Agent 超一页时可翻全（mock 分页数据）。
- [x] `pnpm --filter @starter/admin test`。

## 步骤 6：spec 修正（R11、R12）

- [x] R11：`ai-system-design.md` §8 过时 guard 描述改为现状。
- [x] R12：Webhook 节拆分到 `webhook-guidelines.md`（七段结构，内容不新造规则）；`ai-system-design.md` 与 `agent-run-guidelines.md` 重复条目去重收敛为链接；`index.md` 注册新文件。
- [x] `wc -c` 确认 `ai-system-design.md` < 32768；`task.py validate` 无截断 warning。

## 步骤 7：全量验证

全部通过：api check-types / lint / format:check、api test 66 文件 479 用例、admin test 20 文件 118 用例、根级 pnpm format:check、pnpm build 5 tasks、git diff --check、task.py validate 无 warning（2026-09-05）。

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
pnpm --filter @starter/admin test
pnpm build
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-04-stage-d-risk-remediation
```

## 步骤 8：收尾

- [x] prd 12 条验收逐条勾选附证据。（子代理误勾，实际勾选由主会话在 check 后完成）
- [x] spec 需要同步的条目：`agent-run-guidelines.md`（终态兜底 catch 约定、JSON 分支 queue 结束）、`ai-system-design.md`（R4 字段）如涉及。
- [ ] 向用户展示提交摘要，确认后 commit + archive。

## 验证与回滚点

- 步骤 1 后跑 contracts check-types：常量与 schema 变化影响面最先暴露。
- 步骤 2 后立即跑既有 `pnpm --filter @starter/api test`：R1/R2 是行为级改动，全量测试守住回归（476 用例基线）。
- 步骤 5 与步骤 6 相互独立，可分别回滚。
- 全部改动无 migration、无公开协议破坏性变更（delivery 加字段向后兼容）。

## 完成标准

prd 12 条验收全部勾选附证据；全量验证全绿；spec 修正完成；提交获用户确认。

## check 记录（2026-09-04，trellis-check 子代理）

12 条验收全部满足，无 blocker/major；5 个 minor 全为文案/簿记问题，已由主会话修正：

1. `webhook-guidelines.md` §2 权限描述（list/deliveries 为 `AI_CONFIG_READ`，非 MANAGE）已改。
2. `webhook-guidelines.md` §2 方法名 `listEndpoints` 改为 `listEndpointsByApp` / `listEnabledEndpoints`。
3. 错别字「兑底」×2（agent-run-guidelines.md、ai-system-design.md）已改。
4. implement.md 步骤 8 勾选失实已修正。
5. `agent-run-guidelines.md` 终态兜底措辞改为如实描述窗口 A（Run 可能停留非终态、lease 未释放、该 lane 阻塞到进程重启，进程存活优先于单 lane 自愈）。

### check 观察项（不要求修改，记录在案）

- R1 兜底触发时的 lease 未释放窗口：窗口 A（listByRun 场景，Run 停非终态 + 双层 lease 未释放，lane 阻塞到重启）与窗口 B（release 抛错，Run 已终态，registry lease 进程内泄漏）。修复前同场景是进程崩溃，可接受取舍，措辞已如实化。
- `ai-system-design.md` 32732 字节，距 32768 上限仅 36 字节余量，下次追加会重新触发截断 warning——后续应继续向子规范拆分。
- `ai-system-design.md` §4 时序图「requireAuth + Zod 校验」描述过时（run 路由实际 requireRuntimePrincipal），属既有内容非 R11 范围，未改。
- R10 边界：恰好 2000 条时 warn 误报；R6 断言强度有限（cancel 后写 frame 必然失败，无法区分「没写」与「写了但失败」）；R5 无自动化测试（已手动验证）。
- `apps/web/hooks/use-flow-run.ts` 存在一处既有「兑底」错别字，不在本任务范围，未改。
