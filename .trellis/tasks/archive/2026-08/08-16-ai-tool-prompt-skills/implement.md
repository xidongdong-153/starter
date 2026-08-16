# Implement: AI Tool / Prompt / Skills 设计与验证

## 执行顺序

```
08-16-ai-test-tools → 08-16-ai-prompt-config → 08-16-ai-skills
```

无强依赖，按"底层工具链路 → prompt 链路 → skills（依赖工具链路）"排序。每个子任务独立 `task.py start` / `archive`。

## 子任务检查清单

### 1. 08-16-ai-test-tools

- [ ] `test-tools.ts`：7 个测试工具（echo/get_current_time/add_numbers/random_number/fail_tool/slow_tool/admin_secret）
- [ ] `create-runtime.ts`：`AI_TEST_TOOLS_ENABLED` 开关合并注册
- [ ] `.env.example` / `.env.development`：`AI_TEST_TOOLS_ENABLED=true`
- [ ] 单测：注册、参数校验、失败、权限、超时、审计记录（扩展 ai-tools.test.ts 或新增）
- [ ] dev 对话验证：真实模型触发至少一个工具

验证命令：`pnpm test`、`pnpm check`

### 2. 08-16-ai-prompt-config

- [ ] 表：`ai_system_prompts`、`ai_prompt_templates`；`ai_settings.globalSystemPromptId`、`ai_conversations.systemPromptId`
- [ ] migration（db:generate + db:migrate）
- [ ] contracts：system prompt / template schema + 会话请求加 systemPromptId
- [ ] conversation service：resolveSystemPrompt（会话级 → 全局默认）+ systemPrompt 注入 orchestrator/gateway
- [ ] orchestrator input 加 systemPrompt 透传
- [ ] API：system prompts CRUD + 全局默认设置；templates CRUD + 公开列表
- [ ] 单测：解析优先级、注入、CRUD、权限
- [ ] admin：System Prompts 管理页、Templates 管理页、对话页 QuickStarters 替换为 API 拉取

验证命令：`pnpm test`、`pnpm check`、admin 页面手测

### 3. 08-16-ai-skills

- [ ] 表：`ai_skills`；migration
- [ ] contracts：skill schema（列表不含 content）
- [ ] API：skills CRUD（content 仅 manage 权限）
- [ ] system prompt 拼装 skills 描述块（XML，参考 pi formatSkillsForSystemPrompt）
- [ ] `read_skill` 基础工具（闭包注入 repository），始终注册
- [ ] 单测：注入格式、read_skill 成功/未找到/权限、CRUD
- [ ] admin：Skills 管理页
- [ ] dev 对话验证：模型感知技能并调用 read_skill

验证命令：`pnpm test`、`pnpm check`、admin 页面手测

## 风险文件 / 回滚点

- `apps/api/src/modules/ai/ai-conversation.service.ts`（system prompt 解析与注入——最小改动，别动流式主循环）
- `apps/api/src/modules/ai/ai-tool-orchestrator.ts`（加 systemPrompt 透传字段）
- `apps/api/src/bootstrap/create-runtime.ts`（测试工具注册开关）
- 回滚：migration 可安全回退（新增列 nullable），测试工具开关默认关

## 完成门槛（parent 级）

- [x] P-1: `pnpm check` + `pnpm test` 全绿
- [x] P-2: dev 对话触发测试工具成功，ai_tool_executions 有记录（echo/add_numbers/get_current_time succeeded）
- [x] P-3: system prompt 配置生效（行为变化可观察：全局默认 + 会话级覆盖均验证），模板库对话页可选
- [x] P-4: skills 注入 + read_skill 可用（模型自动感知并加载技能）
- [x] P-5: 无 secret/prompt/工具参数泄漏（日志、审计、响应；审计表列结构即无内容字段）
- [x] P-6: 三个管理页 CRUD 可用（API 全链路 + admin 测试 96 个覆盖；浏览器 UI 受 ego-browser 跨端口 fetch 限制未手动过，建议真实浏览器查看）
