# 执行计划：修复 AI 运行面第三方接入缺口

按修复顺序执行，每步完成后跑该步的验证命令；全部完成后跑仓库级质量门与收尾步骤。

## Step 1 G1：心跳转义修复

- [x] `apps/api/src/modules/ai/run/run.route.ts` L126：`": heartbeat\\n\\n"` → `": heartbeat\n\n"`。
- [x] 验证：`grep -n 'heartbeat' apps/api/src/modules/ai/run/run.route.ts` 确认两处写法一致（都输出真实换行）。
- [x] 验证：`pnpm --filter @starter/api test -- run` 跑 run 相关测试回归。

## Step 2 G2：CORS 头白名单

- [x] `apps/api/src/middleware/cors.middleware.ts`：`allowHeaders` 增补 `authorization`、`last-event-id`、`x-ai-external-user-id`、`x-ai-subject-type`、`x-ai-subject-id`。
- [x] `apps/api/.env.example`：`CORS_ORIGINS` 注释补「第三方前端 origin 需追加到此处」。
- [x] 验证：Step 7 的 CORS 预检测试断言（先实现代码，测试统一在 Step 7 落地；本步先跑 `pnpm --filter @starter/api check-types`）。

## Step 3 G3：Agent 公共发现开放给 product_app

- [x] `apps/api/src/modules/ai/agent/agent.route.ts`：deps 增加 `requireRuntime`；`listPublicAgentDefinitionsRoute` / `getPublicAgentDefinitionRoute` 换用 `requireRuntime`；admin 路由不动。
- [x] `apps/api/src/modules/ai/ai.route.ts`：`createAiAgentDefinitionRoute` 传 `requireRuntime: requireRuntimePrincipal`。
- [x] `apps/api/src/modules/ai/application/application.openapi.ts`：注册 `bearerAuth` security scheme（http/bearer）。
- [x] `agent.openapi.ts` / `session.openapi.ts` / `run.openapi.ts`：公共路由与运行面路由 `security` 改为 `[{ cookieAuth: [] }, { bearerAuth: [] }]`。
- [x] 实现时确认：`getPublic` 对 draft/disabled agent 的现状返回（404 或其他），保持现状不新增语义。
- [x] 验证：`pnpm --filter @starter/api check-types && pnpm --filter @starter/api test -- ai-cross-product`（既有 product_app 测试回归）。

## Step 4 G4：结构化输出读取路由

- [x] `packages/contracts/src/ai.ts`：新增 `structuredOutputItemSchema` / `structuredOutputListSchema` / `startAgentRunJsonSchema`（后者供 Step 6 用，一并加）。
- [x] `packages/contracts/src/index.ts`：确认导出（若 ai.ts 经 index 统一导出则确认即可）。
- [x] `apps/api/src/modules/ai/run/run.service.ts`：input 增加 `outputContractRegistry`；实现 `structuredOutputs(access, sessionId, runId)` 与 `adminStructuredOutputs(runId)`；interface 同步。
- [x] `apps/api/src/modules/ai/run/run.openapi.ts`：新增运行面与 admin 两个 route 定义（错误响应沿用 notFoundResponse / unauthorizedResponse / invalidRequestResponse / forbiddenResponse 组合，对齐 usage-audit 的 admin 权限路由写法）。
- [x] `apps/api/src/modules/ai/run/run.route.ts`：注册两个 handler；admin 路由需要 `requireRead` 权限中间件（`ai.route.ts` 已有 `requireRead`，传给 run route 的 deps）。
- [x] `apps/api/src/modules/ai/ai.route.ts`：`createAiAgentRunRoute` 传 `requireRead` 与 `outputContractRegistry`。
- [x] 验证：`pnpm --filter @starter/api check-types`；测试在 Step 7 统一落地。

## Step 5 G5：Transcript 结构化输出回放

- [x] `packages/contracts/src/ai.ts`：`agentTranscriptToolActivitySchema` 增加可选 `structuredOutput` 字段（contract + value nullable + referenceId）。
- [x] `apps/api/src/modules/ai/output/structured-output.repository.ts`：新增 `findByIds(ids)`。
- [x] `apps/api/src/modules/ai/session/session.presenter.ts`：`readToolDetails` 读出 `structuredOutputId`；新增导出 `collectStructuredOutputIds(entries)`；`projectTranscript` 增加可选 Map 参数并注入 `structuredOutput`。
- [x] `apps/api/src/modules/ai/session/session.service.ts`：input 增加 `structuredOutputRepository` + `outputContractRegistry`；`transcript()` 按 design.md 2.5 流程批量取回并打码。
- [x] `apps/api/src/modules/ai/ai.route.ts`：`createAiAgentSessionService` 传新依赖（`createAiStructuredOutputRepository` 实例与 run 模块共用同一个）。
- [x] 验证：`pnpm --filter @starter/api check-types && pnpm --filter @starter/api test -- agent-sessions`。

## Step 6 G6：Run JSON 启动模式

- [x] `apps/api/src/modules/ai/run/run.route.ts`：startRun handler 按 Accept 分流（`application/json` 且不含 `text/event-stream` → JSON 响应 `{ runId }`）。
- [x] `apps/api/src/modules/ai/run/run.openapi.ts`：`startAgentRunRoute` 200 响应增加 `application/json` 内容；description 写清分流规则。
- [x] 验证：`pnpm --filter @starter/api check-types`；行为测试在 Step 7。

## Step 7 测试落地：`apps/api/src/test/ai-third-party-access.test.ts`

按 design.md 第 4 节实现六组断言：

- [x] CORS 预检（OPTIONS + Access-Control-Request-Headers 断言）。
- [x] product_app Agent 发现（enabled 过滤 + 伪造 Bearer 401）。
- [x] JSON 启动 + 轮询到 completed。
- [x] 结构化输出读取（product/admin 可见性、admin 路由、跨 scope 404；executor 用 tool-calling 假流 + 注入两个可见性的 output contract）。
- [x] Transcript 回放（tool_activity 携带 structuredOutput、普通 tool 不带）。
- [x] 文件内注释说明心跳修复无测试的原因。
- [x] 验证：`pnpm --filter @starter/api test`（全量）。

## Step 8 收尾：全量质量门 + 规范更新 + 提交

- [x] `pnpm check`（类型 / lint / format 仓库级全绿）。
- [x] `pnpm test` 全绿。
- [x] `pnpm --filter @starter/api db:check` 确认无 pending migration（本任务不应产生）。
- [x] 更新 `.trellis/spec/api/backend/agent-run-guidelines.md`：Route 清单补 3 个新端点；错误矩阵补结构化输出与 JSON 启动条目；SSE/JSON 分流规则。
- [x] 更新 `.trellis/spec/api/backend/agent-session-guidelines.md`：transcript 投影新增 structuredOutput 注入规则与可见性打码。
- [ ] 按 AGENTS.md 提交规范分 6 个 commit（每个修复一个，测试随对应功能或并入 Step 7 一个 `test(api)` commit）：
  - `fix(api): write real newlines in run stream heartbeat`
  - `fix(api): allow ai runtime headers in cors preflight`
  - `feat(api): open public agent listing to product apps`
  - `feat(api): add structured output read routes`
  - `feat(api): replay structured outputs in session transcript`
  - `feat(api): support json run start with accept negotiation`（含 `test(api): cover third-party runtime access`）
- [ ] 提交前把改动摘要展示给用户确认，确认后才执行 commit。

## 回滚点

- 每个 Step 独立 commit，单步回滚命令：`git revert <commit>`。
- contracts 变更集中在 Step 4/5/6 的 schema 增量，回滚任一 API commit 不影响 contracts 包其他导出。

## 当前状态

- 2026-08-28：Step 1-7 全部完成（trellis-implement 三批派发 + trellis-check 全量复核通过：pnpm check 全绿、366 测试全绿、无 pending migration）。spec 文档已更新（agent-run / agent-session guidelines）。剩余：按 6 个 commit 分批提交（待用户确认）。
