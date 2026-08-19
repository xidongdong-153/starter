# Conversation 破坏性切换实施计划

## 前置条件

- S1 至 S7 的 `task.json.status` 全部为 `completed`。
- 新 Agent、Session、Run API 和 Admin 页面通过完整流程测试。
- 开发库尚未执行 destructive migration。
- 启动前核对 S1-S7 的实际代码、migration、导出和验收结果符合父任务共享契约；发现缺口时返回所属子任务，不在 S8 补功能。

## 执行步骤

### 1. 最终基线

- [ ] 运行全仓质量门、测试、构建和 db check。
- [ ] 记录新旧表记录数与开发数据库绝对路径。
- [ ] 确认 Pi Session DB 路径与主库不同。

### 2. 生成并验证 destructive migration

- [ ] 从 Drizzle schema 删除旧三表和旧 relations。
- [ ] 从 `ai_model_calls` 删除 conversationId/generationId。
- [ ] 生成 migration，并手工检查复制列和删除顺序。
- [ ] 准备同时含旧 Conversation、新 Agent/Session/Run、配置和审计记录的临时库。
- [ ] 实跑 migration，检查记录数和 `PRAGMA foreign_key_check`。
- [ ] 确认 Pi Session DB 文件时间和 schema 未变化。

### 3. 删除 API 旧实现

- [ ] 删除 Conversation 目录、Route 装配和 generation 恢复。
- [ ] 删除 Tool Orchestrator，保留 Registry 与 Pi Tool adapter。
- [ ] 更新共享模型配置的 Conversation 命名。
- [ ] 更新 Prompt 引用和用量审计到 Agent/Run。
- [ ] 删除旧 API tests，保留等价 Harness 行为测试。

### 4. 删除 contracts 与 Admin 旧实现

- [ ] 删除 Conversation/generation contracts、event 和错误码。
- [ ] 删除 Admin Conversation API、query、reducer、页面、路由、导航、测试和文案。
- [ ] 更新 OpenAPI 和 RPC type probe。

### 5. 静态删除检查

```bash
rg -n '/api/ai/conversations|AiConversation|ai_conversations|ai_conversation_messages|ai_generations' apps/*/src packages/*/src
rg -n 'conversation\.service|conversation\.repository|tool-orchestrator' apps/api/src
rg -n 'AgentEvent|SessionEntry|SqliteSession' packages/contracts/src
rg -n 'AgentHarness' apps/api/src
```

- [ ] 前两条无匹配。
- [ ] contracts 不含 Pi 内部类型。
- [ ] 产品代码不实例化未完成的 `AgentHarness`。

### 6. 执行开发库 migration

- [ ] 再次输出开发数据库绝对路径。
- [ ] 再次输出 `ai_conversations`、message 和 generation 记录数。
- [ ] 运行 `pnpm --filter @starter/api db:migrate`，不创建备份。
- [ ] 核对旧表不存在、保留表记录数和外键。

### 7. 最终质量门

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

- [ ] 使用 `trellis-check` 核对父任务和 S8 验收条件。
- [ ] 按父任务共享契约复核 `starter.run.v1`、Run terminal 状态和 transcript 过滤规则没有被旧代码引用污染。
- [ ] 更新 `.trellis/spec/api/backend/ai-integration-guidelines.md`：删除 Conversation/generation 专属规则，保留 Provider、Gateway、Tool Registry、审计、secret 和取消规则，并补充 Harness 规则引用。
- [ ] 使用 `trellis-update-spec` 更新已验证的 Harness 规则。
- [ ] 汇总删除数据、文件、migration 和检查结果。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 停止条件

- 任一前置子任务未完成：不启动 S8。
- 临时 migration 丢失保留数据或外键失败：不删除代码、不执行开发库 migration。
- 静态检查仍有产品旧引用：不执行开发库 migration。
- 目标数据库路径或记录数与预期不符：停下来向用户说明。
