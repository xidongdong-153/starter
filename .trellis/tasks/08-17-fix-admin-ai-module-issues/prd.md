# 修复 Admin AI 模块验证问题

## Goal

修复 `verify-admin-ai-module` 验证报告中的 F-1 至 F-6，使 Admin AI 页面文案、键盘发送、页面语言属性和详情操作符合现有交互及无障碍规范，并用自动化测试和 ego-browser 快速验证防止回归。

## 已确认事实

- 问题来源是 `.trellis/tasks/08-17-verify-admin-ai-module/validation-report.md`，6 个问题均已在本地浏览器复现。
- 改动只涉及 `apps/admin` 前端，不需要修改 API、contracts、数据库或权限规则。
- `apps/admin/src/features/ai/pages/Skills.tsx` 把页面说明 key 同时用于表格列标题和表单字段标签，且中英文资源都缺少 `ai.skills.descriptionRequired`。
- `apps/admin/src/features/ai/pages/AiConversations.tsx` 的 Enter 发送路径调用 `sendMessage()`，没有显式使用键盘事件中 textarea 的当前值。
- `apps/admin/src/i18n/index.ts` 只保存语言选择，没有同步 `document.documentElement.lang`。
- 系统提示词和 Skills 的删除按钮只有图标；用量审计详情只通过表格行 `onClick` 打开。
- Admin 已有 Vitest + Testing Library 测试，页面交互测试位于 `apps/admin/src/test/`。

## Requirements

### R-1 Skills 文案和表单校验

- 页面说明继续使用 `ai.skills.description`。
- 表格“描述”列和表单描述字段改用独立的 `ai.skills.descriptionLabel`。
- 中英文资源都增加 `descriptionLabel` 和 `descriptionRequired`，页面不再显示原始 i18n key。

### R-2 快捷模板 Enter 发送

- 选择快捷模板后按 Enter 必须发送当前 textarea 内容。
- 发送开始后输入框清空，不能残留模板内容或新增换行。
- Shift+Enter 仍然只换行，输入法组合输入期间按 Enter 不发送。
- 点击发送按钮和直接手动输入后按 Enter 的现有行为保持不变。

### R-3 HTML 语言属性

- Admin 初始化和每次语言切换时同步更新 `<html lang>`。
- 中文使用 `zh-CN`，英文使用 `en`。
- 语言持久化和 Ant Design locale 的现有行为保持不变。

### R-4 删除按钮名称

- `/ai/system-prompts` 和 `/ai/skills` 的删除图标按钮增加明确的 `aria-label`。
- 桌面端悬停删除按钮时显示 Tooltip。
- 删除确认、取消和提交逻辑保持不变。

### R-5 用量详情键盘入口

- `/ai/usage` 每条记录提供可聚焦的“查看详情”图标按钮，并设置 Tooltip 和 `aria-label`。
- 键盘聚焦按钮后按 Enter 或 Space 可以打开原有详情 Drawer。
- 保留点击表格行打开详情的现有鼠标操作。

### R-6 回归验证

- 为 F-1 至 F-6 补充覆盖对应行为的 Admin 自动化测试，不通过只断言 i18n key 存在来代替页面行为测试。
- 按顺序通过 Admin 类型检查、Lint、Format 和测试，再通过仓库级 `pnpm check` 与 `pnpm test`。
- 启动 Admin 和 API 后，用 ego-browser 快速验证 Skills、AI 会话、系统提示词、用量审计和中英文切换。

## Acceptance Criteria

- [x] Skills 页面说明仍是完整说明文字，表格列和表单字段显示“描述”或 `Description`。
- [x] Skills 空表单提交时显示对应语言的描述必填提示，不显示 `ai.skills.descriptionRequired`。
- [x] 选择快捷模板后按 Enter 可以发送，textarea 立即清空且字数统计归零；Shift+Enter 仍保留换行。
- [x] 中文界面的 `<html lang>` 为 `zh-CN`，切换英文后为 `en`，切回中文后恢复 `zh-CN`。
- [x] 系统提示词和 Skills 的删除按钮在无障碍树中有名称，并在桌面端有 Tooltip。
- [x] 用量审计每行都有可聚焦的查看详情按钮，键盘可以打开详情 Drawer；鼠标点击整行仍可打开。
- [x] 新增或更新的回归测试通过，Admin 和仓库级质量检查全部通过。
- [x] ego-browser 快速验证完成，任务文件记录页面路径、操作和结果；验证 task space 在结束后关闭。

## Out of Scope

- 不修改 Provider 配置、模型目录、系统提示词、Prompt 模板、Skill 或历史会话数据。
- 不补做原验证任务中受环境限制的 Provider 写操作、普通账号 403、5xx 注入和系统剪贴板检查。
- 不调整 AI 页面视觉布局，不新增 API，不改变请求或响应结构。
- 不顺手修复验证报告之外的问题，也不修改 `.trellis/spec/admin/frontend/quality-guidelines.md` 中已经存在的用户改动。
- 不执行 Git commit 或 push，除非用户另行确认。
