# 移除 AI Pipeline 编排 —— 执行清单

前置：`task.py start .trellis/tasks/08-28-remove-ai-pipeline` 已执行。

## 步骤

1. **删除模块目录**
   ```bash
   rm -rf apps/api/src/modules/ai/pipeline
   ```

2. **ai.route.ts 摘除装配**（`apps/api/src/modules/ai/ai.route.ts`）
   - 删 import 块：`./pipeline/index.js` 的 6 个符号。
   - 删 `pipelineDefinitionService`、`pipelineRunService` 两个 const。
   - 删 `void pipelineRunService.recoverInterrupted()...` 整块（约 210-219 行）。
   - 删链式挂载里的 `.route("/", createAiPipelineDefinitionRoute(...))` 和 `.route("/", createAiPipelineRunRoute(...))`。
   - `runService.recoverInterrupted()` 调用块保留。

3. **contracts 清理**
   - `packages/contracts/src/ai.ts`：按 prd 列出的符号逐个删除；模块内私有 helper（`pipelineTextSchema`、`pipelineStepDefinitionsSchema`、`pipelineDefinitionNameSchema` 等）一并删。
   - `packages/contracts/src/common.ts`：删 `AI_PIPELINE_NAME_CONFLICT` 一行。
   - 全仓 `rg "PIPELINE"`（大小写不敏感）确认 apps/api/src、packages/contracts/src、apps/admin/src、apps/web/src 无残留引用。

4. **删测试**：`apps/api/src/test/ai-pipeline.test.ts`、`ai-pipeline-template.test.ts`。

5. **DB schema 清理**（`apps/api/src/modules/ai/ai.schema.ts`）
   - 删 `aiPipelineDefinitions`、`aiPipelineRuns` 表定义（约 727-810 行）。
   - 删 `aiPipelineDefinitionsRelations`、`aiPipelineRunsRelations`（约 961-985 行）。

6. **生成 migration**
   ```bash
   pnpm --filter @starter/api db:generate
   ```
   核对生成的 `0023_*.sql`：只应包含 `DROP TABLE ai_pipeline_runs`、`DROP TABLE ai_pipeline_definitions` 及配套索引删除，语句数应为 2 条（drop table 自动带索引）。多余语句出现时停下检查 schema diff，不要手改 SQL。

7. **文档清理**（按 prd 第 8 条的清单，用符号搜索定位，删整节/整行）

8. **spec 更新**（Phase 3.3，`.trellis/spec/api/backend/ai-system-design.md`，按 prd 第 9 条）

9. **验证**
   ```bash
   pnpm check
   pnpm test
   pnpm --filter @starter/api db:check
   rg -il pipeline apps/api/src packages/contracts/src
   ```

10. **提交**（用户已授权）
    ```
    refactor(api)!: remove pipeline orchestration

    BREAKING CHANGE: remove /api/ai/pipelines/* and /api/ai/pipeline-runs/*
    endpoints, pipeline contracts, AI.PIPELINE_NAME_CONFLICT error code and
    ai_pipeline_* tables. Use agent run start + SSE/polling to compose
    multi-step flows on the caller side.
    ```
    文件范围：pipeline 目录删除、ai.route.ts、contracts 两个文件、两个测试删除、新 migration、ai.schema.ts、docs/ai/*、.trellis/spec/api/backend/ai-system-design.md、任务目录。

11. **归档**：`python3 ./.trellis/scripts/task.py archive .trellis/tasks/08-28-remove-ai-pipeline`（archive 产生的移动单独提交：`chore(task): archive remove-ai-pipeline`）。

## 回滚点

单任务纯删除 + 一个 drop migration；出问题整单 revert 即可，无中间状态需要保留。
