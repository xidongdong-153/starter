# Implement: Prompt 配置管理设计

## 实施清单

### 后端

1. [x] `ai.schema.ts`：新增 `aiSystemPrompts`、`aiPromptTemplates` 表；`aiSettings.globalSystemPromptId`、`aiConversations.systemPromptId` 列
2. [x] `db:generate` + `db:migrate`（migration 0009）
3. [x] `packages/contracts/src/ai.ts`：prompt 相关 schema（name 校验、CRUD DTO）；conversation 请求加 systemPromptId
4. [x] `ai-prompt.repository.ts`：system prompts CRUD + 全局默认读写 + templates CRUD + 引用检查
5. [x] `ai-prompt.service.ts`：CRUD 逻辑、resolveSystemPrompt（会话级 → 全局默认）
6. [x] `ai-prompt.openapi.ts`：9 个路由定义（含 GET 全局默认）
7. [x] `ai.route.ts`：注册 prompt 路由（read/manage 中间件）
8. [x] `ai-conversation.repository.ts`：create/beginSend 持久化 systemPromptId
9. [x] `ai-conversation.service.ts`：prepare 解析 systemPrompt、streamGeneration 注入
10. [x] `ai-tool-orchestrator.ts`：input 加 systemPrompt 透传
11. [x] 测试：prompt CRUD、权限、resolve 优先级、注入断言、模板列表排序（ai-prompt-config.test.ts 5 用例）

### 前端

12. [x] `SystemPrompts.tsx` 管理页（含设为全局默认）
13. [x] `PromptTemplates.tsx` 管理页
14. [x] `AiConversations.tsx` QuickStarters 改为 API 拉取
15. [x] `routes.tsx` 注册 + prompt.api/prompt.query + i18n

## 验证命令

```bash
pnpm check
pnpm test
```

## 风险文件

- `ai-conversation.service.ts`（流式主循环，最小改动：只加 systemPrompt 字段）
- `ai-tool-orchestrator.ts`（加透传字段）
- `ai.schema.ts` + migration（新表/新列）

## 完成标准

- [x] 全测试绿（209 用例）+ pnpm check 绿
- [x] system prompt 注入生效（测试断言 gatewayInput.systemPrompt）
- [x] 会话覆盖优先级正确（会话级 → 全局默认）
- [x] 模板列表按 enabled/sortOrder 排序
- [x] 无 manage 权限写接口 403
