# Design: AI Tool / Prompt / Skills 设计与验证

## 1. 架构总览

三个能力层挂在现有 AI 模块上，复用已有基础设施：

```
                    ┌──────────────────────────────────────────────┐
                    │              create-runtime.ts                │
                    │  aiTools = registry(基础工具 + 测试工具? )    │
                    └──────────────────┬───────────────────────────┘
                                       │
   ai-tool-orchestrator ── registry.list() ──→ 模型 tool_use 循环
          │
          ├─ systemPrompt（新增：全局默认 → 会话级覆盖 → skills 描述注入）
          │
          └─ read_skill 工具（查 ai_skills 表返回内容，基础工具）
```

- **测试工具**：`AI_TEST_TOOLS_ENABLED=true` 时把测试工具集并入 registry（dev 默认开，生产不配即关）。
- **Prompt 配置**：`ai_system_prompts` 表 + `ai_settings.globalSystemPromptId` + `ai_conversations.systemPromptId`；`ai_prompt_templates` 表给前端模板库。
- **Skills**：`ai_skills` 表，system prompt 注入 name+description 列表（渐进式），`read_skill` 基础工具按需返回完整内容。

## 2. 数据流

### 2.1 对话请求（system prompt 解析）

```
POST /api/ai/conversations/:id/messages { text, systemPromptId? }
  → conversation service
    → resolveSystemPrompt(conversation, input)
        = 会话级 systemPromptId 的 content
        ?: ai_settings.globalSystemPromptId 的 content
        ?: undefined
    → 拼装 skills 描述块（启用中的 ai_skills → XML 列表）追加到 systemPrompt
    → streamGeneration 把 systemPrompt 传给 orchestrator/gateway
```

- `AiGatewayInput.systemPrompt` 已有透传能力，本次激活它。
- `AiToolOrchestratorInput` 需新增 `systemPrompt?: string` 并透传给 invocationRunner/gateway。

### 2.2 测试工具调用

```
模型 tool_use → orchestrator → registry.find(name)
  → 权限检查（requiredPermission）
  → tool.execute({ userId, requestId, signal }, input)
  → audit.beginToolExecution / finalizeToolExecution（ai_tool_executions）
  → 结果回填 tool_result 消息，继续下一轮
```

测试工具与业务工具无差别，走同一链路，只是注册时机受 env 控制。

### 2.3 Skills 加载

```
对话请求 → system prompt 注入：
  <available_skills>
    <skill><name>..</name><description>..</description></skill>
  </available_skills>
模型决定使用 → 调用 read_skill 工具 { name } → 查 ai_skills 表返回 content
```

## 3. 表设计（新增，均在 apps/api/src/modules/ai/ai.schema.ts）

| 表 | 字段 | 说明 |
|---|---|---|
| `ai_system_prompts` | id, name, content, enabled, createdBy, updatedBy, createdAt, updatedAt | admin 管理的 system prompt 项 |
| `ai_prompt_templates` | id, name, description, content, enabled, sortOrder, createdBy, updatedBy, createdAt, updatedAt | 前端模板库 |
| `ai_skills` | id, name, description, content, enabled, createdBy, updatedBy, createdAt, updatedAt | 技能库；name 唯一 |

改动既有表：

- `ai_settings` 加 `globalSystemPromptId`（nullable，引用 ai_system_prompts）。
- `ai_conversations` 加 `systemPromptId`（nullable，引用 ai_system_prompts；会话级覆盖）。

name 校验复用 pi 规则：1-64 字符，小写字母/数字/连字符，无首尾连字符、无连续连字符（skills、system prompts、templates 的 name 统一校验）。

## 4. 契约与 API

统一复用权限 `ai:config:manage`（写）/ `ai:config:read`（读）。全部走自有 JSON envelope `{ ok, data, meta }`。

### system prompts

```
GET    /api/ai/system-prompts            # 列表（read）
POST   /api/ai/system-prompts            # 创建（manage）
PUT    /api/ai/system-prompts/:id        # 更新（manage）
DELETE /api/ai/system-prompts/:id        # 删除（manage）
PUT    /api/ai/settings/system-prompt    # 设置全局默认（manage）
```

### prompt templates

```
GET    /api/ai/prompt-templates          # 列表（登录用户可读，对话页用）
POST   /api/ai/prompt-templates          # 创建（manage）
PUT    /api/ai/prompt-templates/:id      # 更新（manage）
DELETE /api/ai/prompt-templates/:id      # 删除（manage）
```

### skills

```
GET    /api/ai/skills                    # 列表（登录用户可读，只含 name+description+id）
POST   /api/ai/skills                    # 创建（manage）
PUT    /api/ai/skills/:id                # 更新（manage）
DELETE /api/ai/skills/:id                # 删除（manage）
```

`read_skill` 工具由 orchestrator 注册（基础工具），通过闭包注入 skills repository；不开放 HTTP 直接读 content 的接口给普通用户（content 只经工具进入模型上下文，避免在客户端响应中暴露；admin 管理页经 manage 权限读写）。

会话请求契约：`POST /api/ai/conversations/:id/messages` 与创建会话请求增加可选 `systemPromptId`（uuid 或 null）。

## 5. 测试工具集（ai-test-tools 子任务）

放 `apps/api/src/modules/ai/test-tools/`（或单文件 `test-tools.ts`），每个工具 `defineAiTool` 定义：

| 工具 | 用途 | 验证点 |
|---|---|---|
| `echo` | 回显 text 参数 | 参数解析、结果回传 |
| `get_current_time` | 返回当前 ISO 时间 | 无参数工具 |
| `add_numbers` | 两个数字相加 | 数值参数、zod 校验 |
| `random_number` | 指定范围随机数 | 范围参数、边界 |
| `fail_tool` | 固定抛错 | 失败路径、审计 failed 状态 |
| `slow_tool` | 延迟 seconds 参数 | 超时/取消路径 |
| `admin_secret` | 需要 `ai:config:manage` 权限 | 权限检查 forbidden 路径 |

注册：`create-runtime.ts` 中

```ts
const testTools = env.AI_TEST_TOOLS_ENABLED ? createTestAiTools() : [];
const aiTools = deps.aiTools ?? createAiToolRegistry([...baseTools, ...testTools]);
```

dev 默认开：`apps/api/.env.example` 与 `.env.development` 加 `AI_TEST_TOOLS_ENABLED=true`。

## 6. 前端（admin）

- 路由 `apps/admin/src/features/ai/routes.tsx` 新增：
  - System Prompts 管理页（列表 + 编辑 + 设为全局默认）
  - Prompt Templates 管理页（列表 + 编辑 + 排序/启用）
  - Skills 管理页（列表 + 编辑 + 启用）
- 对话页 `AiConversations.tsx`：QuickStarters 改为从 `GET /api/ai/prompt-templates` 拉取。
- 组件与样式复用现有 AiSettings 的表格/表单模式。

## 7. 兼容性与回滚

- 全部新增表通过 Drizzle migration（`db:generate` + `db:migrate`），旧库无破坏。
- `ai_settings`、`ai_conversations` 仅加 nullable 列，向后兼容。
- 测试工具开关默认关：不配置 env 的生产环境行为与现在完全一致（空工具表 + 无 systemPrompt）。
- read_skill 工具始终注册（与测试开关无关），`ai_skills` 无启用记录时工具返回 not_found，不影响对话。

## 8. 权衡

- **数据库 vs 文件系统（skills）**：数据库让 admin CRUD 和管理页顺理成章；牺牲了 pi 那种"直接放 SKILL.md 目录"的开放生态。已定数据库（D-3）。
- **渐进式 vs 全量注入**：渐进式省 token、贴近 pi，代价是模型必须先读描述再决定调 read_skill（多一轮工具调用）。已定渐进式（D-3）。
- **systemPrompt 会话级覆盖用引用（systemPromptId）而非自由文本**：引用保证 prompt 内容可管理、可审计变更；自由文本更灵活但难管理。当前用引用（全局默认 + 会话覆盖）。
