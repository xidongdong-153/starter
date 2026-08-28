# 执行计划：一次性无状态 AI 调用端点

按步骤串行执行，每步末尾的验证命令通过后才进下一步。每步一个 commit 粒度，出问题可单步回滚。

## Step 1 contracts 契约

- [ ] `packages/contracts/src/ai.ts` 新增：`completionRequestSchema`、`completionResultSchema`、`completionStreamEventSchema` 及对应 type 导出（结构见 design.md 3.1-3.3）。
- [ ] 确认 `packages/contracts/src/index.ts` 的统一导出覆盖新增项（现有导出方式是逐个列出还是 `export *`，跟随现状）。
- [ ] 验证：`pnpm --filter @starter/contracts check-types`。

## Step 2 scenario CHECK 约束与 migration

- [ ] `apps/api/src/modules/ai/ai.schema.ts` L675-L676：`ai_model_calls_scenario_check` 的 IN 列表加 `'completion'`（放在 `'agent_run'` 之后、`'legacy'` 之前）。
- [ ] `pnpm --filter @starter/api db:generate` 生成 migration（预期 0021）。
- [ ] 人工审查生成 SQL：表重建 + 全列 `INSERT ... SELECT` + rename，对照 `0015_orange_nemesis.sql` 的结构逐段核对。
- [ ] 验证：`pnpm --filter @starter/api db:check`（干净）；临时库跑 `db:migrate` 后用 `db:studio` 或 SQL 抽查 `INSERT scenario='completion'` 能插入、`'bogus'` 被拒。
- [ ] 验证：`pnpm --filter @starter/api exec vitest run src/test/ai-destructive-migration.test.ts --config vitest.config.ts`（migration 回归）。

## Step 3 configurationService 暴露白名单方法

- [ ] `apps/api/src/modules/ai/configuration/configuration.service.ts`：`createAiService` 返回对象新增 `requireAllowedModel(model: AiModelRef): Promise<AiModelRef>`，内部 `await runtime.ensureReady()` 后调用现有 `requireExplicitModel`。
- [ ] 服务返回类型的 interface（若有显式声明）同步补签名。
- [ ] 验证：`pnpm --filter @starter/api check-types`。

## Step 4 completion 模块

- [ ] 新建 `apps/api/src/modules/ai/completion/` 四个文件（布局见 design.md 2）：
  - `completion.service.ts`：`createAiCompletionService`，实现 `complete()`（JSON 聚合）与 `stream()`（SSE 事件源）；消息构造、审计上下文填法按 design.md 4.2。
  - `completion.route.ts`：`createAiCompletionRoute`，Accept 分流逻辑对齐 `run.route.ts` 的判定（含 `application/json` 且不含 `text/event-stream` → JSON）；SSE handler 对齐 `configuration.route.ts` L380-L432 的 abort / heartbeat / 写失败处理。
  - `completion.openapi.ts`：路由定义，tag `AI Runtime`，security `[{ cookieAuth }, { bearerAuth }]`，200 响应同时声明 `application/json` 与 `text/event-stream`。
  - `index.ts`：导出 service 与 route 工厂。
- [ ] `apps/api/src/modules/ai/ai.route.ts`：装配 `createAiCompletionService` 与 `createAiCompletionRoute`（注入点见 design.md 2）。
- [ ] 验证：`pnpm --filter @starter/api check-types && pnpm --filter @starter/api lint`。

## Step 5 smoke tests

- [ ] 新建 `apps/api/src/test/ai-completions.test.ts`，覆盖 design.md 7 的 7 组断言；fake gateway 注入方式实现时从现有配置面 / 运行面测试里选最贴近的一种（模型测试的 fake gateway 优先）。
- [ ] 断言"无 Session / Run / 事件副作用"用表行数前后对比，不依赖实现细节。
- [ ] 验证：`pnpm --filter @starter/api exec vitest run src/test/ai-completions.test.ts --config vitest.config.ts` 全绿。
- [ ] 验证：`pnpm test` 全量回归。

## Step 6 收尾

- [ ] `pnpm check`（类型 / lint / format）+ `pnpm test` 全绿。
- [ ] `pnpm build` 通过。
- [ ] OpenAPI 自查：启动 dev api，`GET /doc` 里 `POST /api/ai/completions` 出现在 `AI Runtime` tag，两种 security 都可选，200 的两种 content-type 都有示例。
- [ ] `.trellis/spec/api/backend/ai-system-design.md`：第 1 节"两类调用"扩为三类（加无状态调用），第 11 节 OpenAPI 面分类的 `AI Runtime` 描述补 `POST /api/ai/completions`；`docs/ai/design.md`、`docs/ai/integration.md` 同步补端点说明（请求 / 响应 / SSE 帧格式 / 错误码 / scenario 说明）。
- [ ] 按 trellis-check 流程跑质量检查，更新任务状态。

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
| --- | --- | --- |
| `ai.schema.ts`（scenario CHECK） | migration 生成异常或遗漏列 | 删 0021 migration，还原 check 行，重跑 db:generate |
| `configuration.service.ts`（新方法） | 触碰既有闭包，可能影响 model_test | 纯新增导出方法，git revert 单 commit 即可 |
| `ai.route.ts`（装配） | 装配顺序或依赖遗漏 | 独立 commit，revert 不影响其他模块 |
| contracts | 下游（web/admin）类型扩散 | 全部是新增导出，无既有类型改动，风险最低 |

## 执行顺序的依据

contracts 先行（消费端类型一次到位）→ migration 其次（独立可验证）→ 白名单方法（service 的硬依赖）→ 模块与装配 → 测试 → 收尾文档。前四步每步都能独立通过类型检查，测试集中在 Step 5（与 08-28-ai-runtime-third-party-gaps 的节奏一致）。
