# PRD: Prompt 配置管理设计

## Goal

实现 Prompt 配置两个层面：系统提示词管理（全局默认 + 会话级覆盖，对话时注入，激活 gateway 的 systemPrompt 透传能力）和用户 prompt 模板库（管理模板，对话页展开填充，替换硬编码 QuickStarters）。

## 背景

- `AiGatewayInput.systemPrompt` 是可选透传参数，但 conversation 服务与 orchestrator 均未传，实际请求中始终为 undefined。
- 对话页 `AiConversations.tsx` 的 QuickStarters 是硬编码 4 条快捷文案。
- 权限系统有 `ai:config:manage` / `ai:config:read` 可复用。
- parent 决策 D-2：两个层面都做；D-4：完整前端。

## Requirements

### 系统提示词管理

- R-1: 新增表 `ai_system_prompts`（id, name, content, enabled, createdBy, updatedBy, createdAt, updatedAt）。
- R-2: `ai_settings` 加 `globalSystemPromptId`（nullable，引用 ai_system_prompts）作为全局默认。
- R-3: `ai_conversations` 加 `systemPromptId`（nullable，引用 ai_system_prompts）作为会话级覆盖。
- R-4: API：`GET/POST /api/ai/system-prompts`、`PUT/DELETE /api/ai/system-prompts/:id`（manage 写 / read 读）、`PUT /api/ai/settings/system-prompt`（设全局默认）。
- R-5: 会话请求（创建会话、发消息）可选携带 `systemPromptId`。
- R-6: conversation service 解析优先级：会话级 systemPromptId → 全局默认 → undefined，注入 orchestrator/gateway。
- R-7: `AiToolOrchestratorInput` 加 `systemPrompt?: string` 并透传。

### Prompt 模板库

- R-8: 新增表 `ai_prompt_templates`（id, name, description, content, enabled, sortOrder, createdBy, updatedBy, createdAt, updatedAt）。
- R-9: API：`GET /api/ai/prompt-templates`（登录用户可读，enabled 优先排序）、admin CRUD（manage 权限）。
- R-10: 对话页 QuickStarters 改为从模板库 API 拉取（enabled 且排序），点击填充输入框；无模板时隐藏该区域。

### 通用

- R-11: name 校验（1-64 字符小写数字连字符），content 长度上限（如 8000 字符）。
- R-12: 自动化测试覆盖解析优先级、注入、CRUD、权限。
- R-13: admin 管理页：System Prompts 页（CRUD + 设为全局默认）、Templates 页（CRUD + 启用/排序）。
- R-14: 安全约定不变：prompt content 不入审计、不入日志、不进模型调用审计表。

## Acceptance Criteria

- A-1: `pnpm check` + `pnpm test` 全绿。
- A-2: 设置全局默认 system prompt 后，新对话/无会话覆盖的对话注入该 prompt；模型行为变化可观察（如"用中文回答"生效）。
- A-3: 会话指定 systemPromptId 时覆盖全局默认；置 null 回退全局默认。
- A-4: 模板库 API 返回 enabled 模板；对话页 QuickStarters 显示 API 数据并可点击填充。
- A-5: 无 manage 权限的用户对写接口返回 403。
- A-6: 日志与审计表查不到 prompt content。

## Out of Scope

- 模板变量展开（$1/$@ 等 pi 风格参数）——本次模板是静态文本
- system prompt 自由文本（会话只能引用管理项，不能自定义任意文本）
- skills 相关（见 08-16-ai-skills）

## 依赖

- parent: 08-16-ai-tool-prompt-skills（P-3、P-5、P-6）
- 前置子任务: 08-16-ai-test-tools（建议先完成，无硬依赖）
