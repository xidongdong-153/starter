# Implement: Skills 能力包设计

## 实施清单

1. [x] `ai.schema.ts`：新增 `aiSkills` 表
2. [x] `db:generate` + `db:migrate`（migration 0010）
3. [x] `packages/contracts/src/ai.ts`：skill summary/detail schema + CRUD 请求 schema
4. [x] `ai-skill.repository.ts`：CRUD + findEnabledSkillByName + listEnabledDescriptions
5. [x] `ai-skill.service.ts`：CRUD（content 仅 manage）
6. [x] `ai-skill.openapi.ts`：5 个路由（list/create/update/delete/get 详情）
7. [x] `ai.route.ts`：注册 skill 路由 + 创建 orchestrator 时合并 read_skill 工具
8. [x] `ai-skill-tools.ts`：createReadSkillTool（闭包注入 repository）
9. [x] `ai-conversation.service.ts`：skillAccess 参数 + appendSkillDescriptions 注入
10. [x] 测试：CRUD/权限/列表无 content/注入格式（XML 转义）/read_skill 成功与未找到/安全断言
11. [x] 前端 `Skills.tsx` 管理页 + routes + i18n

## 验证命令

```bash
pnpm check
pnpm test
```

## 风险文件

- `ai-conversation.service.ts`（加 skillAccess 参数与注入，改动集中在 streamGeneration 的 systemPrompt 拼装）
- `ai.route.ts`（orchestrator registry 合并 read_skill）

## 完成标准

- [x] 全测试绿（API 214 + admin 96）+ pnpm check 绿
- [x] 技能列表 API 不含 content；详情/写接口需 manage
- [x] system prompt 注入 XML 技能块（测试断言转义）
- [x] read_skill 返回 content、未找到走 failed 状态
- [x] content 不进日志/审计
