# S8 Conversation 破坏性切换 - 执行进度

## 目标
删除旧 Conversation runtime、contracts、Admin 页面和三张数据表，重建模型调用审计关联，完成最终迁移与全仓验收。

## 预检（已完成）
- S1-S7 全部 completed（archive 中核对）
- 基线质量门：check-types / lint / format:check / test / build / db:check 全部通过
- 开发库：`apps/api/data/app.db`（/Users/wuwanzhu/Code/xdd/starter/apps/api/data/app.db）
- 旧表记录数：ai_conversations=6, ai_conversation_messages=72, ai_generations=36
- 保留数据：ai_model_calls=69, ai_tool_executions=2, ai_agent_definitions=1, ai_agent_sessions=2, ai_agent_runs=6
- Pi Session DB：`apps/api/data/agent-sessions.db`（与主库不同文件）

## 删除/修改清单（全部完成）

### contracts (packages/contracts/src/ai.ts)
- [x] 删除全部 AiConversation*、generation schema、旧 SSE event、conversation title
- [x] aiModelCallAuditSchema：scenario 改为 model_test|agent_run|legacy，删 conversationId/generationId
- [x] common.ts：删除旧错误码（AI_CONTEXT_LIMIT / AI_GENERATION_* / AI_RETRY_NOT_ALLOWED）

### API
- [x] 删除 modules/ai/conversation/ 整个目录（5 个文件）
- [x] 删除 tool/tool-orchestrator.ts
- [x] ai.route.ts：移除 conversation 装配和 toolOrchestrator
- [x] ai.schema.ts：删三表+relations，重建 aiModelCalls（去 conversation/generation 列）
- [x] configuration.service.ts：resolveConversationModel 改名 resolveModel
- [x] prompt.repository.ts：移除 conversation 引用检查
- [x] usage-audit/*：移除 conversationId/generationId，scenario 归一
- [x] middleware/timeout.middleware.ts：移除 conversation stream 路径特判
- [x] 测试：删除 ai-conversations.smoke.test.ts、ai-tools.test.ts、ai-contracts.test.ts；更新 ai.smoke / ai-test-tools / ai-prompt-config / ai-skills / ai-agent-definitions / usage-audit / harness-contracts / openapi / rpc-type.probe

### Admin
- [x] 删除 AiConversations.tsx、ai-conversations.test.tsx
- [x] ai.api.ts / ai.query.ts / index.ts：删 conversation API/query
- [x] routes.tsx：移除 chat 路由，Agent/Session/Run 为最终入口
- [x] i18n（zh/en）：删 conversations 块与 menu.aiChat
- [x] 测试更新

### Migration
- [x] 生成 destructive migration 0012_far_lockjaw.sql（手工重写为事务安全版）
- [x] 临时库 fixture 验证 + ai-destructive-migration.test.ts
- [x] 执行开发库 migration（用户确认后）

## 关键发现：drizzle-kit 事务内 PRAGMA foreign_keys 无效导致 tool 审计误删

- drizzle-kit migrate 在一个事务内执行全部 SQL，事务内 `PRAGMA foreign_keys=OFF` 是 no-op。
- 原始 0012 采用 PRAGMA 关闭外键再 DROP 的老方案，开发库执行时 `DROP TABLE ai_model_calls` 触发 `ai_tool_executions` 的 ON DELETE CASCADE，2 条 tool 审计被级联删除。
- 已修复 0012 为事务安全方案：先 `CREATE TABLE __keep_tool_executions AS SELECT` 复制数据，DROP 子表解除引用，重建 ai_model_calls 后再重建子表并复制恢复。
- ai-destructive-migration.test.ts 采用相同的事务式执行方式（BEGIN/COMMIT + statement-breakpoint 分割）验证通过。
- 受影响：开发库原有 2 条旧 tool 审计无法恢复（日志无参数、无备份，符合 R5 不备份约束）。

## 开发库最终状态（迁移后）
- 旧三表已删除，migration 0012 已记录。
- ai_model_calls = 73：legacy=57（run_id 全 NULL）、agent_run=12（全带 run_id）、model_test=4。
- ai_tool_executions = 7（新 Harness 测试运行写入）。
- agents=1, sessions=3, runs=9, providers=1, settings=1, prompts=1, system_prompts=2, skills=1, enabled_models=1（保留完整）。
- `PRAGMA foreign_key_check` 返回空，外键完整。
- agent-sessions.db 独立存在，未由 Drizzle 修改。

## 静态检查
- `/api/ai/conversations|AiConversation|ai_conversations|ai_conversation_messages|ai_generations` 在产品代码零匹配（仅 migration 历史 SQL/snapshot 与迁移测试 fixture 命中，符合 design 第 4 节）。
- conversation.service/repository/orchestrator、contracts Pi 内部类型、AgentHarness 实例化：零匹配。

## 质量门命令（全部通过）
- [x] pnpm check-types
- [x] pnpm lint
- [x] pnpm format:check
- [x] pnpm test（api 33 files / 228 tests；admin 19 files / 107 tests）
- [x] pnpm build
- [x] pnpm --filter @starter/api db:check
- [x] git diff --check

## spec 更新（全部完成)
- [x] ai-integration-guidelines.md：删除 Conversation/generation 专属规则，保留 Provider/Gateway/Tool Registry/审计/secret/取消，补充 Harness 规则
- [x] database-guidelines.md：增量迁移章节改写为最终主库结构 + 事务安全迁移写法
- [x] directory-structure.md / pi-agent-execution / agent-run / agent-session：移除旧 Conversation 引用

## 状态
- [x] 基线
- [x] 代码删除（contracts/API/Admin/测试）
- [x] destructive migration 生成与临时库验证
- [x] 开发库 migration
- [x] spec 更新与全量验收
- [ ] 用户确认后提交归档
