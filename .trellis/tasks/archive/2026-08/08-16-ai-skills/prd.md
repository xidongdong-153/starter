# PRD: Skills 能力包设计

## Goal

实现 Skills 能力：数据库存储技能（name + description + content），system prompt 渐进式注入（只注入 name+description 列表），提供 `read_skill` 基础工具让模型按需加载完整内容；admin 管理页 CRUD。

## 背景

- 全代码库无 skill 实现。
- pi 参考：Agent Skills 标准，SKILL.md + frontmatter，渐进式披露（system prompt 只放 name+description+location 的 XML 列表），模型用 read 工具按需加载。
- 本服务模型无本地文件访问，改用数据库存储 + `read_skill` 工具（与 pi 的 read 工具思路一致）。
- parent 决策 D-3：数据库 + 渐进式 + read_skill 工具；D-4：完整前端。

## Requirements

- R-1: 新增表 `ai_skills`（id, name, description, content, enabled, createdBy, updatedBy, createdAt, updatedAt），name 唯一。
- R-2: name 校验 1-64 字符小写数字连字符（无首尾/连续连字符）；description 必填 ≤1024；content 必填 ≤32000。
- R-3: API：`GET /api/ai/skills`（登录用户可读，只含 id+name+description+enabled，不含 content）；`POST/PUT/DELETE /api/ai/skills[/:id]`（manage 权限，含 content）。
- R-4: 对话 system prompt 拼装启用中技能的 XML 描述列表（参考 pi formatSkillsForSystemPrompt 格式），追加在 system prompt 之后。
- R-5: `read_skill` 基础工具：输入 name 或 id，返回启用中技能完整 content；未找到/未启用返回 not_found；始终注册（不依赖测试工具开关）。
- R-6: read_skill 的 execute 通过闭包注入 skills repository（现有 AiToolExecutionContext 无 db 访问）。
- R-7: 自动化测试：注入格式（XML 转义）、read_skill 成功/未找到/未启用、CRUD、权限、content 不泄漏到审计/日志。
- R-8: admin Skills 管理页：列表（不含 content）、新建/编辑（含 content）、启用/停用、删除。
- R-9: 无技能或全部停用时，system prompt 不注入技能块，read_skill 返回 not_found，对话行为与现状一致。

## Acceptance Criteria

- A-1: `pnpm check` + `pnpm test` 全绿。
- A-2: 创建启用技能后，对话请求的 system prompt 含该技能 name+description（测试可断言注入格式）；停用后不再注入。
- A-3: dev 环境真实模型能感知技能列表并调用 read_skill 获取完整内容（至少一次手动验证）。
- A-4: read_skill 对未启用/不存在的技能返回规范化错误，工具审计记录状态正确。
- A-5: 普通用户 API 列表不含 content；写接口无 manage 权限返回 403。
- A-6: 日志与审计表查不到技能 content。

## Out of Scope

- SKILL.md 文件系统扫描（不做目录发现）
- 技能市场 / 跨用户技能共享
- skills 与 prompt 模板的联动

## 依赖

- parent: 08-16-ai-tool-prompt-skills（P-4、P-5、P-6）
- 依赖工具链路：orchestrator 工具执行（已有），建议在 08-16-ai-test-tools 之后实施
