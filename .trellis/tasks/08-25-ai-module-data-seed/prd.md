# 08-29 AI 模块数据整理与种子配置

## Goal

整理 AI 模块数据库数据：移除现有测试 Agent、系统提示词、快捷模板、技能，重新配置 2 个有真实用途的 Agent、若干有意义的系统提示词、快捷模板和技能；按"中等清理"范围清除会话、审计与模型调用数据。

## Requirements

### 清理范围（用户已确认：中等清理）

- 保留所有用户账号与角色、权限、文件等非 AI 数据。
- 删除测试 Agent「王八一」及其运行记录。
- 删除测试内容：系统提示词 `verify-global`、`verify-override`，快捷模板 `verify-quick`，技能 `test-skill-verify`。
- 清空所有 AI 会话：`ai_agent_sessions`（连带 cascade 删除 `ai_agent_runs`），以及 `agent-sessions.db`（Pi Session Store）中的 sessions/entries 等数据。
- 清空审计与调用数据：`ai_model_calls`、`ai_tool_executions`、`ai_app_credential_audit_events`、`authorization_audit_events`。
- 清空 Better Auth 登录会话表 `session`（所有用户需重新登录）。
- 保留应用凭据「Web」（`ai_app_credentials`）、provider 配置（`ai_provider_configs`、`ai_custom_providers`、`ai_enabled_models`、`ai_model_catalogs`）、`ai_settings` 的全局模型、`user_ai_preferences`。
- `ai_settings.globalSystemPromptId` 从已删除的 `verify-global` 更新为新的默认系统提示词。

### 新配置

- Agent 配置 2 个（用户已确认定位）：
  1. 通用助手：日常问答与项目咨询。
  2. 代码助手：代码审查与调试。
  - 模型统一用 `xdd / LongCat-2.0`（数据库唯一启用的模型）。
  - 工具只引用生产可用工具 `read_skill@1.0.0`（`get_current_time` 是测试工具，不得引用）。
  - Agent 引用新建的对应系统提示词与技能。
- 系统提示词配置 2 条，分别支撑两个 Agent，内容有真实用途、非测试。
- 快捷模板（`ai_prompt_templates`）配置 3-4 条有实际使用场景的模板（如总结对话、中英互译、解释代码），非测试。
- 技能（`ai_skills`）配置 2-3 个有实际使用场景的技能（如写作规范、SQLite 查询规范）。
- 所有文案内容遵守 `xdd-plain-docs` 技能规范：具体事实、无 emoji、无八股词、无翻译腔。

## Acceptance Criteria

- [x] `ai_agent_definitions` 中只有 2 个启用状态的新 Agent，配置可通过 `agentDefinitionConfigSchema` 校验（schemaVersion=2、model 指向 xdd/LongCat-2.0、toolRefs 只含 read_skill@1.0.0、引用的 systemPromptId 和 skillIds 存在且启用）。
- [x] `ai_system_prompts` / `ai_prompt_templates` / `ai_skills` 中不再存在 `verify-*` / `test-*` / `王八一` 等测试数据。
- [x] `ai_agent_sessions`、`ai_agent_runs`、`ai_model_calls`、`ai_tool_executions`、`ai_app_credential_audit_events`、`authorization_audit_events`、`session` 均为 0 行。
- [x] `agent-sessions.db` 的 sessions、entries、branch_entries 均为 0 行。
- [x] `ai_settings` 的 `globalSystemPromptId` 指向新建的通用系统提示词，无悬空引用。
- [x] API 正常响应（/health OK，AI 接口鉴权正常要求重新登录），Agent 配置 schema 与引用校验通过。

## Notes

- 轻量任务，PRD-only，直接操作本地数据库完成，不新增代码、不写 seed 脚本。
- 操作前备份 `apps/api/data/app.db` 和 `apps/api/data/agent-sessions.db`。