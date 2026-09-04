# D3 执行计划

前置：`09-03-ai-executable-manifest`、`09-03-ai-agent-runtime-port` 已归档。设计依据：本目录 `design.md` 与父任务 `research/current-stage-d-surface.md` 第 D3 节。

## 步骤 1：contracts 与错误码

- [x] `packages/contracts/src/common.ts`：`ApiErrorCodes` 增加 `AI_APP_POLICY_FORBIDDEN: 'AI.APP_POLICY_FORBIDDEN'`、`AI_COMPLETION_FORBIDDEN: 'AI.COMPLETION_FORBIDDEN'`。
- [x] `packages/contracts/src/ai.ts`：
  - `aiApplicationPolicySchema`（strictObject + superRefine 拒绝重复 executable id / 重复 control）。
  - `createAiApplicationSchema` 加必填 `policy`；`aiApplicationSchema` 加 `policy: aiApplicationPolicySchema.nullable()`。
  - `updateAiApplicationPolicySchema = z.strictObject({ policy: aiApplicationPolicySchema })`。
  - `webhookRunTerminalPayloadSchema` 加 `eventId: uuidSchema.nullable()`、`sequence: z.number().int().min(1).nullable()`、`eventProtocolVersion: z.literal(1)`。
  - `streamResumeRequiredFrameSchema`（transport frame，独立于 RunEvent）。
- [x] 确认 contracts 构建与既有 schema 测试（`packages/contracts` 如有测试）不受 strict 字段变化影响。

## 步骤 2：数据库 migration

- [x] `apps/api/src/modules/ai/ai.schema.ts`：
  - `aiAppCredentials` 加 `policyJson: text('policy_json')`（nullable）。
  - `aiWebhookDeliveries` 加 `eventId` / `sequence` / `eventProtocolVersion` / `claimedAt` / `claimExpiresAt`（全 nullable）。
- [x] `pnpm --filter @starter/api db:generate` 生成 migration，人工核对：只加列、不加索引、不动既有数据。
- [x] `pnpm --filter @starter/api db:migrate && pnpm --filter @starter/api db:check`。

## 步骤 3：policy CRUD 与 guard

- [x] `application.repository.ts`：`updatePolicy(id, policyJson, actorId, now, requestId)`（事务：active 条件更新 + `policy_updated` 审计行）。
- [x] `application.service.ts`：`create` 写入 policyJson（入参已由 schema 校验）；`updatePolicy`（revoked 409、不存在 404）；`toApplication` parse policyJson，损坏按 null + WARN。
- [x] `application.openapi.ts`：create 请求与响应带 policy；新增 `PATCH /api/ai/admin/applications/{appId}/policy`。
- [x] `application.route.ts`：注册 update policy handler。
- [x] `application.guard.ts`：authenticate 后 parse `policyJson`，成功放 principal.policy，null / 失败 fail closed。
- [x] `principal.ts`：`PrincipalContext` / `RuntimeAccessContext` 加可选 `policy`，`toRuntimeAccessContext` 传递。

## 步骤 4：policy 检查函数与检查点

- [x] 新建 `apps/api/src/modules/ai/runtime/app-policy.ts`：`strongestSideEffect`（从 presenter 移入）、`enforceStartPolicy`、`enforceControlPolicy`、`manifestAllowedByPolicy`。
- [x] `executable-manifest.presenter.ts` 改为 import `strongestSideEffect`。
- [x] `agent.service.ts`：`listExecutableManifests` product_app 全量取 + 过滤 + 内存分页；`getExecutableManifest` 不允许时 404。
- [x] `run.service.ts`：
  - `startRun` 在 expectedAgentRevision 检查后、`resolveInputImages` 前调 `enforceStartPolicy`。
  - `abort` / `steer` / `followUp` 在查到 scoped Run 后、操作 handle 前调 `enforceControlPolicy`。
- [x] `completion.route.ts`：handler 顶部 product_app 抛 403 `AI_COMPLETION_FORBIDDEN`。

## 步骤 5：Webhook identity、复合游标与 claim

- [x] `webhook.repository.ts`：
  - `listTerminalProductAppRunsAfter(cursor: { finishedAt, runId } | null, limit)`：复合游标条件 + `leftJoin ai_run_events` 取 terminal eventId/sequence。
  - `claimDueDeliveries(limit, now, ttlMs)`：查 due + 逐条条件 UPDATE 领取。
  - `markDelivered` / `markRetry` / `markDead` 清 claim 两列。
- [x] `webhook.dispatcher.ts`：
  - `lastSweptCursor` 复合游标；enqueue 写入 `eventId` / `sequence` / `eventProtocolVersion`（interrupted 为 null）。
  - `deliverPhase` 改用 `claimDueDeliveries`；请求头加 `X-Starter-Delivery-Id`；`DELIVERY_CLAIM_TTL_MS = 60_000` 常量。
- [x] 核对 webhook service / openapi 的 delivery 列表响应是否需要补新字段（列表 DTO 按需，最小化）。

## 步骤 6：SSE recovery 与 flow 恢复端点

- [x] `run-sse.ts`：`lastSequence` 跟踪、`aborted` 标志、非终态结束写 `stream.resume_required` frame。
- [x] `flow.openapi.ts` + `flow.route.ts`：新增 `GET /api/flow/sessions/{sessionId}/runs/{runId}/events/stream`，走 `resumeRunTransport`，与 chat 同构。

## 步骤 7：测试

- [x] `ai-app-credentials.test.ts` 扩展：policy CRUD、strict 校验 400、审计、rotate 保留、revoked 409、DTO。
- [x] 新建 `ai-application-policy.test.ts`：discovery 过滤、start 403 矩阵、无副作用断言（无 Run 行 / lease 可用 / 幂等键未消费）、controls 403、completion 403、starter_user 回归、inline config 403 回归。
- [x] `ai-webhook.test.ts` 扩展：payload identity、interrupted null、同时间戳 201+ 条不漏、claim 互斥与重领、`X-Starter-Delivery-Id`。
- [x] `run-event-recovery.test.ts` 扩展：正常终态无 frame、非终态 EOF frame + lastSequence、afterSequence 重连续传。
- [x] `product-modules.smoke.test.ts` 扩展：flow 恢复端点全链路。
- [x] 既有测试断言语义零改动（`/api/ai` 既有用例只允许新增，不允许改断言）。

## 步骤 8：全量验证

- [x] `pnpm --filter @starter/api check-types` 通过
- [x] `pnpm --filter @starter/api lint` 通过
- [x] `pnpm --filter @starter/api format:check` 通过
- [x] `pnpm --filter @starter/api db:check` 通过
- [x] `pnpm --filter @starter/api test`：66 文件 476 测试通过（D2 基线 65 文件 465 测试，新增 `ai-application-policy.test.ts` 与多处扩展）
- [x] `pnpm --filter @starter/admin test`：20 文件 112 测试通过
- [x] 根级 `pnpm format:check` 通过（修正 contracts/ai.ts 一处 prettier 格式）
- [x] `pnpm build`：5 任务成功
- [x] `git diff --check` 通过

## 验证与回滚点

- 步骤 1-2 完成后先跑 `pnpm --filter @starter/api check-types`：contracts 与 schema 变化影响面大，尽早暴露类型断点。
- 步骤 4 完成后跑既有 `pnpm --filter @starter/api test`：确认 starter_user 全链路无回归（policy 对其恒 pass-through）。
- 步骤 5-6 各自独立可回滚：webhook 与 SSE 互不依赖，先做哪块都不阻塞另一块。
- migration 只加 nullable 列，回滚安全；不写任何数据回填。

## 完成标准

prd.md 九条验收全部勾选，附验证证据；spec 更新（`agent-run-guidelines.md` policy 检查点与 webhook 游标 / claim、`ai-system-design.md` webhook 节、`product-module-guidelines.md` flow 恢复端点）完成后再进入提交确认。

## 执行记录

实现分两个 trellis-implement 子代理批次完成（第一段因连接错误中断后由第二段接续）。admin 侧随 create 必填 policy 同步了 `AiApplications.tsx` 表单（executables 多选取当前 revision、controls、maxSideEffect）与 zh/en i18n。

check 阶段（trellis-check 子代理）结论：无 blocker；10 个重点项全部通过，包括 policy 检查点位置（403 无副作用：不建 Run、不占 lease、不消费幂等键）、fail closed、单一检查入口、webhook 复合游标与 claim 原子性、SSE frame 边界、port 依赖边界、既有断言语义、admin 改动一致性。

### 与计划的偏差

- `ai-attachments.smoke.test.ts` 的 product_app 附件引用用例整段重写（原路径经 completion，D3 后非法）：改为经 Agent Run 保留「上传 + 引用 + 跨 principal 拒绝」语义。属行为性重写，不是 setup 入参改动。
- `ai-completions.test.ts` 的 product_app 用例按设计改断言 403 `AI_COMPLETION_FORBIDDEN`（prd 承诺的 Agent-only）。

### 残余风险（既有 + 本次新增，均不阻塞）

- `run-sse.ts` 客户端主动断开分支（onAbort 置 aborted 后 finally 不发 frame）无直接单测；断开时写 frame 必然失败且被静默忽略，风险低。
- `DELIVERY_CLAIM_TTL_MS`（60s）与 `AI_WEBHOOK_TIMEOUT_MS`（默认 10s，env 可调大）无程序化联动；超时配得比 TTL 长时多实例会出现合法重复 POST。已在 dispatcher 常量旁加注释说明，接收方按 `X-Starter-Delivery-Id` 去重。
- D2 遗留：`finalizeRun` 中 `listByRun` 抛错 unhandled rejection；JSON 模式幂等命中丢弃 iterable 后 subscriber queue 挂到终态（1024 上界）。
