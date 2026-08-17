# Admin AI 模块验证问题修复计划

## 1. 开发前确认

- [x] 读取 `prd.md`、`design.md` 和本文件。
- [x] 运行 `python3 ./.trellis/scripts/get_context.py --mode packages`，读取 Admin 前端规范和共享指南。
- [x] 检查 `git status --short`，保留 `.trellis/spec/admin/frontend/quality-guidelines.md`、`apps/web/next-env.d.ts` 及其他用户改动。
- [x] 搜索将修改的 i18n key、输入事件、删除按钮和表格详情入口，确认没有遗漏调用方。

## 2. 修复文案与语言

- [x] 在中英文资源增加 `ai.skills.descriptionLabel`、`ai.skills.descriptionRequired` 和 `ai.usage.viewDetail`。
- [x] `Skills.tsx` 的页面说明保留 `description`，表格列和表单字段改用 `descriptionLabel`。
- [x] 在 `i18n/index.ts` 增加语言到 HTML `lang` 的映射，覆盖初始化和后续切换。

## 3. 修复交互与无障碍入口

- [x] Enter 发送时把 textarea 当前值显式传给 `sendMessage`，保留 Shift+Enter 和输入法组合输入行为。
- [x] 系统提示词和 Skills 删除按钮增加 Tooltip 与 `aria-label`，不改变 `Popconfirm`。
- [x] 用量审计增加查看详情图标按钮，保留整行鼠标点击。

## 4. 自动化回归

- [x] 更新 `apps/admin/src/test/ai-conversations.test.tsx`，覆盖快捷模板 Enter 发送、清空输入和 Shift+Enter。
- [x] 更新 `apps/admin/src/test/ai-usage-audit.test.tsx`，通过可访问按钮打开详情。
- [x] 增加 AI 管理页面测试，覆盖 Skills 文案、必填提示和两个删除按钮的可访问名称。
- [x] 增加 i18n 的 HTML `lang` 同步测试。

按顺序运行，前一项失败时只修复本任务引入的问题：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test
pnpm check
pnpm test
```

## 5. ego-browser 快速验证

- [x] 启动 API 和 Admin，确认 `http://localhost:7788/health` 与 `http://localhost:2333` 可访问；本次复用已有服务，未启动或停止服务进程。
- [x] 创建并复用名为 `verify admin ai fixes` 的 ego-browser task space。
- [x] `/ai/skills`：检查页面说明、描述列、描述字段和空表单必填提示；语义树中的删除按钮有名称。
- [x] `/ai/chat`：选择快捷模板后按 Enter，确认消息发送且 textarea 和字数统计清空；Shift+Enter 仍换行。
- [x] `/ai/system-prompts`：语义树中的删除按钮有名称，悬停显示 Tooltip；不确认删除。
- [x] `/ai/usage`：用 Tab 聚焦查看详情按钮，按 Enter 打开 Drawer；鼠标点击行仍可打开。
- [x] 切换英文并检查 `document.documentElement.lang === 'en'`，切回中文后检查值为 `zh-CN`。
- [x] 记录页面路径、动作和结果，关闭 task space；本次未启动服务，因此没有停止服务。

## 6. 完成检查

- [x] 使用 `trellis-check` 检查任务范围、测试覆盖和 Admin 规范。
- [x] 运行 `python3 ./.trellis/scripts/task.py validate 08-17-fix-admin-ai-module-issues`。
- [x] 判断是否需要更新 `.trellis/spec/`；现有 Admin 质量规范已经覆盖本次规则时不重复修改。
- [x] 更新本文件的执行结果和验证证据。
- [x] 未经用户确认，不执行 `git commit` 或 `git push`。

## 停止点

- 自动化检查出现本任务之外的既有错误时，记录文件和命令，不扩大修复范围。
- ego-browser 没有登录态时交还控制给用户，不尝试绕过登录。
- 页面没有可用模型或快捷模板时，记录环境阻塞；不修改 Provider 配置或创建持久业务数据。

## 7. 执行结果

### 代码和测试

- 已完成 F-1 至 F-6：Skills 文案拆分和必填提示、快捷模板 Enter 发送、`<html lang>` 同步、两个页面的删除按钮名称和 Tooltip、用量审计详情按钮。
- 已更新 `apps/admin/src/test/ai-conversations.test.tsx` 和 `apps/admin/src/test/ai-usage-audit.test.tsx`。
- 已新增 `apps/admin/src/test/ai-management-pages.test.tsx` 和 `apps/admin/src/test/i18n.test.ts`。

### 自动化检查

以下命令按计划执行并通过：

```text
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test
pnpm check
pnpm test
```

结果：Admin 17 个测试文件、100 个测试通过；API 25 个测试文件、214 个测试通过。测试输出中的 Node `localStorage` 实验性提示、jsdom `getComputedStyle` 提示和 Ant Design 弃用提示不影响退出状态。

### ego-browser 快速验证

使用现有 `http://localhost:2333` Admin 和 `http://localhost:7788` API 完成验证；两个服务未由本任务停止。

- `/ai/skills`：页面说明、描述列和描述字段文案正确；空表单显示“请输入技能描述”；删除按钮有名称，悬停显示 Tooltip。
- `/ai/chat`：选择快捷模板后按 Enter 发送；textarea 清空，字数统计归零，消息进入会话；临时会话已删除。
- `/ai/system-prompts`：删除按钮有名称，悬停显示 Tooltip；未确认删除。
- `/ai/usage`：查看详情按钮可访问、可聚焦，键盘和按钮点击均打开 Drawer；表格行点击仍可打开 Drawer。
- 语言切换：英文 `<html lang>` 为 `en`，切回中文后为 `zh-CN`。
- 验证结束后已执行 `completeTaskSpace(1, { keep: false })` 关闭 ego-browser task space。

### 收尾判断

- Admin 前端规范已包含本次发现的 AI 管理页面规则，无需重复更新 `.trellis/spec/`。
- 保留工作区中已有的 `.trellis/spec/admin/frontend/quality-guidelines.md`、`apps/web/next-env.d.ts` 和 `.trellis/tasks/08-17-verify-admin-ai-module/` 改动。
- 未执行 Git commit、push 或 archive。
