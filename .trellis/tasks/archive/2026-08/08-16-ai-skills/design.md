# Design: Skills 能力包设计

## 1. 架构

```
admin 页面 ──→ /api/ai/skills CRUD ──→ ai-skill.repository ──→ ai_skills 表
对话请求 ──→ conversation service
  → systemPrompt = 解析的 system prompt + skills XML 描述块（渐进式披露）
  → read_skill 工具（始终注册，闭包注入 repository）按需返回完整 content
```

参考 pi：system prompt 只注入 name+description 的 XML 列表，完整内容按需加载。本服务模型无文件访问，用 `read_skill` 工具替代 pi 的 read 工具。

## 2. 表设计（ai.schema.ts 追加）

```ts
aiSkills = sqliteTable("ai_skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),       // 1-64 小写数字连字符
  description: text("description").notNull(),  // ≤1024
  content: text("content").notNull(),          // ≤32000
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy/updatedBy/createdAt/updatedAt 同 prompt 表,
})
```

migration 0010。

## 3. 契约（contracts/src/ai.ts）

```ts
aiSkillSummarySchema = { id, name, description, enabled, createdAt, updatedAt }  // 列表不含 content
aiSkillSchema = summary + { content }
createAiSkillSchema = { name, description, content, enabled? }
updateAiSkillSchema = { name?, description?, content?, enabled? }
```

- name 复用 `aiPromptNameSchema`（1-64 小写数字连字符）
- description ≤1024，content ≤32000

## 4. API（复用 ai:config:read / manage）

```
GET    /api/ai/skills             # 登录可读（summary，无 content）
POST   /api/ai/skills             # manage
PUT    /api/ai/skills/:id         # manage
DELETE /api/ai/skills/:id         # manage
```

content 只通过 manage 权限 API 和 read_skill 工具暴露；普通用户列表无 content。

## 5. system prompt 注入

conversation service 增加可选 `skillAccess?: { listDescriptions(): { name: string; description: string }[] }` 参数。

纯函数 `appendSkillDescriptions(systemPrompt, skills)`（模块级，可单测）：

- 无技能 → 返回原 systemPrompt（undefined 时返回 undefined）
- 有技能 → 追加 `\n\n<available_skills>\n  <skill>\n    <name>..</name>\n    <description>..</description>\n  </skill>\n</available_skills>`
- name/description 做 XML 转义（`& < > " '`）

在 `streamGeneration` 里：`systemPrompt = appendSkillDescriptions(prepared.systemPrompt, skillAccess?.listDescriptions())`，再传给 gatewayInput/orchestrator。

## 6. read_skill 工具

`apps/api/src/modules/ai/ai-skill-tools.ts`：

```ts
createReadSkillTool(repository: AiSkillRepository): RegisteredAiTool
```

- name: `read_skill`；description 说明"技能列表见 system prompt 的 available_skills"
- inputSchema: `{ name: string(1..64) }`
- requiredPermission: null（所有对话用户可用）
- execute: 查 `findEnabledSkillByName(name)`；不存在/未启用 → 抛错（orchestrator 转 failed 状态）
- 返回 `{ modelText: skill.content, safeSummary: "技能 <name> 已加载" }`

注册：`ai.route.ts` 创建 orchestrator 时合并：

```ts
const aiTools = createAiToolRegistry([
  ...runtime.aiTools.list(),
  createReadSkillTool(skillRepository),
]);
```

始终注册（不依赖测试工具开关），无技能时工具返回 not_found 错误，不影响对话。

## 7. 前端

- `Skills.tsx` 管理页：列表（summary，无 content 展示但编辑时拉详情？——简化：列表 API 无 content，编辑时 GET 详情？没有 GET /api/ai/skills/:id 接口。

  简化决策：列表接口返回 summary，编辑弹窗需要 content。两个方案：
  a. 加 GET /api/ai/skills/:id（manage 权限，返回完整）
  b. 列表直接返回 content（manage 权限时）
  
  选 a：列表保持轻量（普通用户可读），详情接口 manage 权限（content 敏感）。route + openapi 加 getAiSkillRoute。

- routes.tsx：/ai/skills，permission AI_CONFIG_READ
- i18n：menu.aiSkills + ai.skills.* 文案

## 8. 安全

- content 不入 ai_model_calls 审计、不进日志（工具结果经 orchestrator 只存脱敏 activity，安全摘要不含 content 正文——safeSummary 只含技能名）
- 普通用户列表无 content

## 9. 兼容与回滚

- migration 0010 纯新增表；回滚安全
- 无技能时对话行为与现状一致（systemPrompt 无技能块、read_skill 报错不阻断正常对话）
