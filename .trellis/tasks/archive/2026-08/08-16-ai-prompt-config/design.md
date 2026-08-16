# Design: Prompt 配置管理设计

## 1. 架构

```
admin 页面 ──→ /api/ai/system-prompts ──→ ai-prompt.service ──→ ai-prompt.repository ──→ ai_system_prompts
admin 页面 ──→ /api/ai/prompt-templates ──→ 同上 ──→ ai_prompt_templates
对话页 QuickStarters ──→ GET /api/ai/prompt-templates（登录可读）

对话请求 ──→ conversation service
  → resolveSystemPrompt(conversation.systemPromptId ?? settings.globalSystemPromptId)
  → streamGeneration 注入 systemPrompt → orchestrator/gateway（激活现有透传参数）
```

- 管理权限：写操作 `ai:config:manage`，读操作 `ai:config:read`（复用现有权限）；模板列表登录即可读（对话页用）。
- 会话级覆盖持久化在 `ai_conversations.systemPromptId`，创建会话或发消息时设置/清除。

## 2. 表设计（ai.schema.ts 追加 + 既有表加列）

```ts
aiSystemPrompts = sqliteTable("ai_system_prompts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),          // 1-64 小写数字连字符
  content: text("content").notNull(),             // 1-8000
  enabled: integer("enabled").notNull().default(1),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
})

aiPromptTemplates = sqliteTable("ai_prompt_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  content: text("content").notNull(),             // 1-8000
  enabled: integer("enabled").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy/updatedBy/createdAt/updatedAt 同上,
})
```

既有表加列（nullable，向后兼容）：

- `aiSettings.globalSystemPromptId`（text nullable，ref ai_system_prompts）
- `aiConversations.systemPromptId`（text nullable，ref ai_system_prompts）

删除 system prompt 时：若被全局默认或会话引用，直接删会破坏引用。策略：删除前检查引用，被引用则返回 409（简单可靠，不做级联置空）。

## 3. 契约（packages/contracts/src/ai.ts）

```ts
aiPromptNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64)

systemPromptSchema = { id, name, content, enabled, createdAt, updatedAt }
createSystemPromptSchema = { name, content, enabled? }
updateSystemPromptSchema = { name?, content?, enabled? }

promptTemplateSchema = { id, name, description, content, enabled, sortOrder, createdAt, updatedAt }
createPromptTemplateSchema = { name, description?, content, enabled?, sortOrder? }
updatePromptTemplateSchema = { name?, description?, content?, enabled?, sortOrder? }

createAiConversationSchema 加 systemPromptId: uuidSchema.optional()
sendAiConversationMessageSchema 加 systemPromptId: uuidSchema.optional().nullable()  // null = 清除覆盖
```

content 长度：system prompt 与模板 content 均 1-8000 字符（与模型测试 prompt 上限一致）。

## 4. API

```
GET    /api/ai/system-prompts             # read 权限，列表（含 content，管理面）
POST   /api/ai/system-prompts             # manage
PUT    /api/ai/system-prompts/:id         # manage
DELETE /api/ai/system-prompts/:id         # manage；被全局默认或会话引用时 409
PUT    /api/ai/settings/system-prompt     # manage，body { systemPromptId: uuid|null }
GET    /api/ai/prompt-templates           # 登录可读（对话页），按 enabled 优先 + sortOrder + createdAt
POST   /api/ai/prompt-templates           # manage
PUT    /api/ai/prompt-templates/:id       # manage
DELETE /api/ai/prompt-templates/:id       # manage
```

错误码：复用现有 ApiErrorCodes（AI_MODEL_NOT_ALLOWED 等不合适）——检查 contracts 的 apiErrorCodes；新增 `AI_SYSTEM_PROMPT_REFERENCED` 与 `AI_PROMPT_NAME_CONFLICT`（或复用通用 RESOURCE_CONFLICT / VALIDATION）。实现时按现有错误码枚举补充。

## 5. conversation service 注入

- `prepareSend` / `prepareCreate` / `prepareRetry` 增加 `systemPrompt` 解析：
  - 请求带 `systemPromptId`：持久化到会话（send 时可改），内容 = 该 prompt 的 content（未找到 → 404 错误码）
  - 不带：用会话已有 `systemPromptId`，没有再读全局默认
- `PreparedGenerationInternal` 加 `systemPrompt: string | undefined`
- `streamGeneration` 的 `gatewayInput` 加 `systemPrompt`；orchestrator input 加 `systemPrompt`
- `AiToolOrchestratorInput` 加 `systemPrompt?: string`，透传给 `invocationRunner.stream` / `gateway.stream`
- `AiInvocationRunner` 签名需确认是否透传 systemPrompt（它在 ai-usage-audit.service.ts，只包 gateway 调用，透传 input 对象即可）

## 6. 前端

- `apps/admin/src/features/ai/pages/SystemPrompts.tsx`：列表 + 新建/编辑弹窗 + 启用开关 + 设为全局默认（PUT /api/ai/settings/system-prompt）
- `apps/admin/src/features/ai/pages/PromptTemplates.tsx`：列表 + 新建/编辑 + 启用/排序
- `AiConversations.tsx`：QuickStarters 改为 GET /api/ai/prompt-templates 拉取（enabled 按 sortOrder），点击填充；空列表隐藏区域
- `routes.tsx` 注册新页面
- api client 新增对应请求函数（看现有 client 模式）

## 7. 安全

- system prompt / template content 是管理数据，可正常入库；但**不进入 ai_model_calls 审计、不写日志**（沿用现有约定：审计表只存安全字段）
- 普通用户 API 只读模板列表（name/description/content 都返回——模板是用户侧填充用，content 需要给前端；system prompts 的 content 只给 manage 权限）

## 8. 兼容与回滚

- migration 0009：新增两表 + 两列（nullable），无破坏
- 回滚：`db:migrate` 前备份；列可安全置空；代码回退后旧库仍可用
- 无 system prompt 配置时行为与现状一致（systemPrompt undefined）
