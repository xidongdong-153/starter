# 实现计划：startRun 支持内联 Agent 配置

按阶段推进，每阶段末尾跑对应验证命令。阶段之间是回滚点，单阶段失败不污染后续。

## 阶段 1：契约（packages/contracts/src/ai.ts）

- [ ] 1.1 新增 `inlineAgentRunConfigSchema`（design.md 2.1 的定义；`systemPrompt`/`systemPromptId` 二选一 refine）。
- [ ] 1.2 `startAgentRunSchema` 加 `config` 可选字段与互斥 refine（design.md 2.2）。
- [ ] 1.3 `agentRunSnapshotSchema` 升级为读兼容 2+3（design.md 2.3），`agentRunSchema` 的 superRefine 比对改可空等价。
- [ ] 1.4 检查 `startAgentRunJsonSchema` 与流式启动共用同一入参 schema 的路径，确认无需改动。
- [ ] 1.5 若 `ApiErrorCodes` 缺"主体不允许内联配置"错误码，新增（先搜现有授权类错误码，避免重复）。

验证：`pnpm --filter @starter/contracts check-types`（无脚本则 `pnpm check-types` 全仓）。

## 阶段 2：数据库迁移

- [ ] 2.1 `apps/api/src/infra/db/schema/index.ts`：`aiAgentRuns.agentId` / `agentRevision` 去 `notNull()`，加成对 CHECK 约束。
- [ ] 2.2 `pnpm --filter @starter/api db:generate` 生成 0027，人工 review 生成的 SQL（表重建语句、索引、外键保持）。
- [ ] 2.3 `pnpm --filter @starter/api db:migrate` 后 `db:check` 确认无 pending。

验证：`pnpm --filter @starter/api db:check`；`pnpm --filter @starter/api test` 确认存量测试不挂（迁移在测试夹具中同样执行）。

## 阶段 3：API 服务层

- [ ] 3.1 `apps/api/src/modules/ai/agent/agent.service.ts`：
  - `ResolvedAgentDefinition` 的 `id`/`revision` 改可空。
  - 提取 `resolveConfigCore`（模型/systemPrompt 解析/技能/工具 scope/输出契约），`resolve` 与新增 `resolveInline` 共用。
  - `resolveInline`：`product_app` 主体抛 403；返回 `{ id: null, revision: null, ... }`。
- [ ] 3.2 `apps/api/src/modules/ai/run/run.service.ts`：
  - `startRun` 分流（`input.config` → `resolveInline`；否则现有 agentId 回落逻辑）。
  - `buildSnapshot` 改签名、产 v3。
  - `createRunExecutionContext` / `repository.create` 可空参数。
  - telemetry 加 `starter.ai.run.config.source`。
  - `runModelRef` 用读兼容 schema。
- [ ] 3.3 `apps/api/src/modules/ai/run/run.repository.ts` 与 `run.presenter.ts`：`agentId`/`agentRevision` 类型放宽，presenter 的快照解析确认走新 schema。
- [ ] 3.4 编译排错：`ResolvedAgentDefinition` 可空化波及的全部调用点（`grep -rn "resolved.id\|agentService.resolve" apps/api/src`）。

验证：`pnpm check-types`；`pnpm --filter @starter/api test`。

## 阶段 4：API 路由与 OpenAPI

- [ ] 4.1 `apps/api/src/modules/ai/agent/agent.openapi.ts` + `agent.route.ts`：新增 `GET /api/ai/tools`（`requireAuth`），返回 `service.listTools()`。
- [ ] 4.2 确认 `/api/ai/sessions/{sessionId}/runs` 的 SSE 与 JSON 两种启动路由自动获得 `config`（走 `startAgentRunSchema`，flow.openapi.ts 的 `startFlowRunRoute` 同理，理论上零改动，跑一遍确认）。

验证：`pnpm --filter @starter/api test`；手动 `pnpm dev:api` 后 curl 带 config 的启动请求（测试环境有临时库，不打真实 Provider：校验失败路径即可验证）。

## 阶段 5：API 测试

- [ ] 5.1 `apps/api/src/test/ai-agent-runs.test.ts`：新增用例——内联启动成功（事件流与 Agent 启动同构）、agentId+config 同传 400、都不传回落默认 Agent、无默认 400。
- [ ] 5.2 校验失败用例：model 不在 allowlist 403、工具 scope 外 400、技能停用 400、systemPrompt 双空/双传 400、product_app 403。
- [ ] 5.3 `apps/api/src/test/ai-run-data-layer.test.ts`：agentId 为 NULL 的 Run 行读写、快照 v3 解析、存量 v2 快照解析不回归。
- [ ] 5.4 `apps/api/src/test/ai-run-idempotency.test.ts`：内联 Run 的幂等重放。
- [ ] 5.5 `apps/api/src/test/ai-harness-contracts.test.ts`：契约层 v2/v3 快照共解析。

验证：`pnpm test`。

## 阶段 6：Flow 前端

- [ ] 6.1 `apps/web/lib/flow/flow-document.ts`：`FlowAgentNodeData` 加 `config?`（zod schema 同步），文档存取向后兼容自测（旧 JSON 样例 parse 通过）。
- [ ] 6.2 `apps/web/components/ui/model-select.tsx`：新组件，形态对齐 `AgentSelect`，数据 `GET /api/ai/models`。
- [ ] 6.3 `apps/web/app/(site)/_components/flow/flow-inspector.tsx`：双模式切换 + 自定义配置表单（模型/思考强度/系统提示词/maxTurns/工具多选/技能多选）。
- [ ] 6.4 `apps/web/app/(site)/_components/flow/flow-workspace.tsx` + `apps/web/lib/flow/flow-validate.ts`：`FlowChainStep` 二选一结构、运行前校验分支。
- [ ] 6.5 `apps/web/hooks/use-flow-run.ts` + `apps/web/lib/ai/run-event-stream.ts`：`StartRunStreamInput` 支持 `config`。
- [ ] 6.6 `apps/web/lib/api/`：补 tools / skills / models 的请求函数（存在则复用）。

验证：`pnpm check-types`；`pnpm dev:web` 手动走查——旧文档打开、自定义节点配置、运行到终态、模板变量引用上游产出。

## 阶段 7：收尾

- [ ] 7.1 `pnpm check`（类型 → Lint → Format 顺序，AGENTS.md 质量门）。
- [ ] 7.2 `pnpm test`。
- [ ] 7.3 手动验收 PRD 验收标准逐条核对（Flow 11-14 条需浏览器走查）。
- [ ] 7.4 按 Trellis 流程：spec 更新（ai-system-design.md 补内联配置一节）→ 提交前向用户展示改动摘要并获得确认。

## Review gates

- 阶段 2 后：0027 SQL 需要人工 review 再 migrate。
- 阶段 5 后：测试覆盖对照 PRD 1-10 条逐条确认。
- 阶段 6 后：浏览器走查截图或录屏给用户。

## 回滚点

- 每阶段独立成 commit（未获用户确认前不 commit，仅在本地完成）。
- 迁移回滚：drizzle 生成的 down 语句；执行前确认 `SELECT count(*) FROM ai_agent_runs WHERE agent_id IS NULL` 为 0。
- 整体回滚：revert 全部 commit + 迁移 down。

## 明确不做（对照 PRD 非目标，实现时发现越界立即停下确认）

- Agent 的 modelPolicy 治理字段。
- Web Chat 页模型选择。
- user_ai_preferences 写入。
- Flow 服务端化。
- Admin 内联 Run 页面。
