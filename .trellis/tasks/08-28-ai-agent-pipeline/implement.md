# 执行计划：AI Agent 流水线编排

按步骤串行执行，每步末尾的验证命令通过后才进下一步。每步一个 commit 粒度，出问题可单步回滚。

## Step 1 contracts 契约

- [ ] `packages/contracts/src/ai.ts` 新增 pipeline schema 族（清单见 design.md 6.4）：定义 DTO（summary / detail / create / update / status / step）、运行 DTO（start / stepState / run / abort）。
- [ ] 确认 `packages/contracts/src/index.ts` 导出覆盖新增项。
- [ ] 验证：`pnpm --filter @starter/contracts check-types`。

## Step 2 表与 migration

- [ ] `apps/api/src/modules/ai/ai.schema.ts`：追加 `aiPipelineDefinitions` / `aiPipelineRuns`（列、索引、CHECK 按 design.md 2.1；principal / subject 成对 CHECK 的写法对照 `ai_agent_sessions` L410-L421 两条先例）。
- [ ] 在文件底部的 relations 区补充两张表的 relations（`pipelineRuns` 对 definitions；`pipelineRuns` 对 sessions / credentials 的关系按现有 relations 文件模式）。
- [ ] `pnpm --filter @starter/api db:generate` 生成 migration，人工审查：纯 CREATE TABLE + CREATE INDEX，无既有表变更。
- [ ] 验证：`pnpm --filter @starter/api db:check`；`pnpm --filter @starter/api exec vitest run src/test/ai-destructive-migration.test.ts --config vitest.config.ts`。

## Step 3 模板模块

- [ ] 新建 `apps/api/src/modules/ai/pipeline/template.ts`：
  - `validateStepTemplates(steps)`：静态校验（`steps.N` 的 N < i，错误信息含步骤序号、变量名、允许上限）。
  - `renderTemplate(template, { input, outputs })`：单遍正则替换，不二次展开。
- [ ] 单元测试：`apps/api/src/test/ai-pipeline-template.test.ts` 覆盖：合法引用、越界拒绝、自引用拒绝、字面量原样保留（含 `{{ foo }}`、`{{steps.x.output}}`）、产出含 `{{input}}` 字样不展开、空模板。
- [ ] 验证：`pnpm --filter @starter/api exec vitest run src/test/ai-pipeline-template.test.ts --config vitest.config.ts`。

## Step 4 definition 子域（控制面）

- [ ] `definition.repository.ts`：CRUD + list（status / 分页过滤），模式对齐 `agent.repository.ts`。
- [ ] `definition.service.ts`：
  - create / update / updateStatus / listAdmin / getAdmin。
  - 校验：name 唯一；步骤 1..8；每步 agentId 是合法 UUID 且 AgentDefinition 存在（引用任何状态均可）；inputTemplate 长度边界；`validateStepTemplates`。
  - update 与 status 切换 revision +1（对齐 agent service 的 revision 语义）。
- [ ] `definition.route.ts` + `definition.openapi.ts`：五条 admin 路由（design.md 6.1），tag `AI Control`，鉴权 `requireRead` / `requireManage`。
- [ ] `apps/api/src/modules/ai/ai.route.ts`：装配 definition service 与路由。
- [ ] 验证：`pnpm --filter @starter/api check-types && pnpm --filter @starter/api lint`。
- [ ] 验证：用 curl 或 smoke test 先行覆盖"创建两步定义 + 越界模板 400"（正式测试在 Step 7 统一落地，本步先手测 /doc）。

## Step 5 run 子域（运行面）

- [ ] `run.repository.ts`：create / get / findByStatus / updateTerminal / updateStepState；`accessWhere` 等价判据（列族与 `ai_agent_sessions` 的 `session.repository.ts` accessWhere 同构，写本表自己的版本）。
- [ ] `run.service.ts`：
  - `start(access, pipelineId, input, requestId)`：定义校验（enabled 否则 404）→ `sessionService.create` 专用 session（title `Pipeline: <name>`）→ INSERT running 行 → fire-and-forget `executeLoop`。
  - `executeLoop`：按 design.md 5.1——渲染 → `runService.startRun`（lane `pipeline-<i>`）→ 迭代 events 认 terminal → `runService.get` 兜底读 Run 行终态 → 提取产出（`structuredOutputRepository.listByRun` 优先，`sessionStore.readTranscript` assistant 文本兜底）→ `updateStepState` → 循环或终态。
  - `get(access, id)`：归属校验 + DTO 投影（步骤 output 截断 1000 字符 + 省略标记，`finalOutput` 全量）。
  - `abort(access, id)`：design.md 5.3（含步骤间隙的内存 abort 标记）。
  - `recoverInterrupted()`：扫描 running → failed + `AI.RUN_INTERRUPTED`。
- [ ] `run.route.ts` + `run.openapi.ts`：三条运行面路由（design.md 6.2），tag `AI Runtime`，security 双声明，鉴权 `requireRuntimePrincipal`。
- [ ] `apps/api/src/modules/ai/ai.route.ts`：装配 run service（依赖注入清单见 design.md 3）+ 启动时调用 `recoverInterrupted()`（fire-and-forget + 日志，模式对齐 `runService.recoverInterrupted()` 的装配写法）。
- [ ] 验证：`pnpm --filter @starter/api check-types && pnpm --filter @starter/api lint`。

## Step 6 边界自查（实现后、测试前）

对照 design.md 逐条自查，发现问题当场修：

- [ ] `startRun` 抛 409 `AI.SESSION_BUSY` 时 pipeline 不会卡死（专用 session + 固定 lane 理论上不冲突；若 abort 与下一步启动竞态触发 busy，编排循环把它归入 failed 而不是重试）。
- [ ] 事件队列迭代不中断：循环持续读 events，不因非 terminal 事件提前退出；Run 行终态与事件终态不一致时以 Run 行为准。
- [ ] fire-and-forget 循环里的异常全部被捕获并落 pipeline 终态（不能让未处理 rejection 悬空）。
- [ ] 步骤 agent resolve 失败（disabled / 配置无效）→ 步骤无 Run、pipeline failed、errorCode 透传。
- [ ] `updateStepState` 每步一次写库；崩溃窗口内最多丢当前步骤的明细，已完成步骤不受影响。

## Step 7 smoke tests

- [ ] 新建 `apps/api/src/test/ai-pipeline.test.ts`，覆盖 design.md 8 的 7 组断言；fake executor 假流复用 `ai-agent-runs.test.ts` 的写法，Bearer 客户端复用 `ai-third-party-access.test.ts` 的模式。
- [ ] 验证：`pnpm --filter @starter/api exec vitest run src/test/ai-pipeline.test.ts --config vitest.config.ts` 全绿。
- [ ] 验证：`pnpm test` 全量回归（重点盯 `ai-agent-runs.test.ts` / `ai-agent-sessions.test.ts` 不回归——本次没改 run / session 代码，回归即装配引入）。

## Step 8 收尾

- [ ] `pnpm check` + `pnpm test` + `pnpm build` 全绿。
- [ ] `pnpm --filter @starter/api db:check` 干净。
- [ ] OpenAPI 自查：`GET /doc` 里 admin 五条路由在 `AI Control`、运行面三条在 `AI Runtime`，运行面双 security 可选。
- [ ] `.trellis/spec/api/backend/ai-system-design.md`：第 1 节补第三类调用（pipeline）；第 3 节补 pipeline 子域职责行；第 5.3 节表清单补两张新表；第 8 节补 pipeline 归属判据；第 11 节 tag 分类补路由。`docs/ai/design.md`、`docs/ai/integration.md` 同步（端点、模板语法、轮询 / abort、错误码、专用 session 语义）。
- [ ] 按 trellis-check 流程跑质量检查，更新任务状态。

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
| --- | --- | --- |
| `ai.schema.ts` + migration | 表定义笔误（CHECK / 索引名冲突） | 删 migration，改 schema 重新 generate |
| `ai.route.ts` 装配 | 循环 fire-and-forget 异常悬空、恢复扫描阻塞启动 | Step 6 自查项；装配是纯新增，revert 单 commit |
| `run.service.ts`（pipeline 的，不是 agent run 的） | 终态双源（事件 vs Run 行）判断错误 | Step 7 的 fail fast / abort 用例直接覆盖该分支 |
| contracts | 下游类型扩散 | 纯新增导出 |

## 执行顺序的依据

模板模块（Step 3）独立成步且先于两个子域：它无依赖、可单测，是 definition 校验和 run 渲染的共同地基，先钉死语法语义再铺服务。definition 先于 run：run 启动依赖 definition 的 enabled 校验和 revision 读取。Step 6 的边界自查放在测试前：fire-and-forget 循环的竞态类问题测试难全覆盖，设计条目逐条对照是最便宜的保险。
