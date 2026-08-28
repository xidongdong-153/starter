# 移除 AI Pipeline 编排

## Goal

删除 pipeline 编排的全部代码、契约、测试和数据库表。AI Runtime 只保留原子能力（completion、Session、Run、事件），多步控制流交给第三方调用方自己组合。

## Requirements

1. 删除 `apps/api/src/modules/ai/pipeline/` 整个目录（11 个文件：definition/run 两个子域的 route、service、repository、presenter、openapi、template、index）。
2. `apps/api/src/modules/ai/ai.route.ts` 移除 pipeline 的 import、service 装配（`pipelineDefinitionService`、`pipelineRunService`）、启动时 `pipelineRunService.recoverInterrupted()` 调用块、两个 route 挂载（`createAiPipelineDefinitionRoute`、`createAiPipelineRunRoute`）。其余装配不动。
3. `packages/contracts/src/ai.ts` 删除 pipeline 全部导出：`PIPELINE_MAX_STEPS`、`pipelineDefinitionStatusSchema`、`pipelineStepDefinitionSchema`、`PipelineStepDefinition`、`pipelineDefinitionSummarySchema`、`PipelineDefinitionSummary`、`pipelineDefinitionDetailSchema`、`PipelineDefinitionDetail`、`createPipelineDefinitionSchema`、`CreatePipelineDefinitionInput`、`updatePipelineDefinitionSchema`、`UpdatePipelineDefinitionInput`、`updatePipelineDefinitionStatusSchema`、`UpdatePipelineDefinitionStatusInput`、`pipelineRunStepStateSchema`、`PipelineRunStepState`、`pipelineRunSchema`、`PipelineRun`、`startPipelineRunSchema`、`StartPipelineRunInput`、`startPipelineRunJsonSchema`、`StartPipelineRunJson`、`pipelineRunAbortSchema`、`PipelineRunAbort`、相关 helper schema（如 `pipelineTextSchema` 之类的模块内私有定义）。
4. `packages/contracts/src/common.ts` 删除错误码 `AI_PIPELINE_NAME_CONFLICT`。先 `rg "AI_PIPELINE_NAME_CONFLICT\|PIPELINE_NAME_CONFLICT"` 全仓库确认无其他消费方（admin/web 前端已验证零引用）。
5. 删除测试：`apps/api/src/test/ai-pipeline.test.ts`、`apps/api/src/test/ai-pipeline-template.test.ts`。
6. `apps/api/src/modules/ai/ai.schema.ts` 删除 `aiPipelineDefinitions`、`aiPipelineRuns` 表定义和 `aiPipelineDefinitionsRelations`、`aiPipelineRunsRelations`。
7. 生成 drop migration（下一个序号 0023）：drop `ai_pipeline_runs`（先，带 FK）和 `ai_pipeline_definitions`。用 `pnpm --filter @starter/api db:generate` 生成，不手写 DDL。生成后检查 SQL 只含两张表的 DROP 和索引清理。
8. 更新 `docs/ai/` 四个文档里的 pipeline 内容：
   - `design.md`：调用方式表格里的 Pipeline 行、模块职责表格里的 `pipeline/` 行、Pipeline 专节（约 320-351 行）。
   - `integration.md`：Pipeline 使用章节（约 289-327 行）、端点表三行（382-384）、`PipelineRun` 字段说明（392）、admin 能力表的 Pipeline 行（645）。
   - `maintenance.md`：两张表的数据表行（120-121）、外键说明句里的 pipeline 部分（123）。
   - `index.md`：如有 pipeline 提及一并删除。
   行号是写文档时的快照，执行时按符号搜索定位。
9. 更新 `.trellis/spec/api/backend/ai-system-design.md`：删除第 1 节第四类调用、3.5 节、5.3 表里两张 pipeline 表的行、第 8 节 pipeline 归属说明、第 11 节 OpenAPI 面里的 Pipeline 条目。此步在 Phase 3.3 完成，与代码同一个提交批。
10. `apps/api/.env.example` 与 `apps/api/src/shared/env.ts` 无 pipeline 相关项，不用动（已核对）。

## Acceptance Criteria

- [ ] `rg -il pipeline apps/api/src packages/contracts/src` 零命中（或仅命中与 pipeline 无关的同形词，预期为零）。
- [ ] `pnpm check` 通过（类型、lint、format）。
- [ ] `pnpm test` 通过（含 openapi.smoke.test.ts 对契约面变更的校验）。
- [ ] `pnpm --filter @starter/api db:check` 通过；新 migration 只 drop 两张表。
- [ ] `docs/ai/` 和 `.trellis/spec/api/backend/ai-system-design.md` 不再描述 pipeline；`rg -i pipeline docs/ai .trellis/spec/api/backend` 零命中。
- [ ] 提交信息：`refactor(api)!: remove pipeline orchestration`，正文带 `BREAKING CHANGE:` 说明删除的端点、契约和表。

## 约束

- 纯删除任务，不顺手改任何 pipeline 之外的代码、注释或格式。
- migration 由 drizzle-kit 生成后人工核对再提交；不修改既有 migration 文件。
- admin 前端零消费已验证，不需要动 apps/admin。
