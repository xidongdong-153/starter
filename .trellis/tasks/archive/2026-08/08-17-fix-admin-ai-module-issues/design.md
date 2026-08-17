# Admin AI 模块验证问题修复设计

## 范围

本任务只修改 Admin 前端。6 个问题分为文案与语言、输入状态、无障碍入口三组，API 数据流和后端行为不变。

| 问题 | 修改位置 | 处理方式 |
| --- | --- | --- |
| F-1、F-2 | `Skills.tsx`、中英文资源 | 拆分页面说明与字段标签 key，补齐必填提示 |
| F-3 | `AiConversations.tsx` | Enter 路径显式传入 textarea 当前值 |
| F-4 | `i18n/index.ts` | 初始化和 `languageChanged` 时同步 `<html lang>` |
| F-5 | `SystemPrompts.tsx`、`Skills.tsx` | 删除按钮增加 Tooltip 和 `aria-label` |
| F-6 | `AiUsageAudit.tsx` | 新增可聚焦的查看详情按钮，保留行点击 |

## 文案和语言

`ai.skills.description` 只保留页面说明用途，新增以下中英文 key：

| key | 中文 | 英文 |
| --- | --- | --- |
| `ai.skills.descriptionLabel` | 描述 | Description |
| `ai.skills.descriptionRequired` | 请输入技能描述 | Enter a skill description |
| `ai.usage.viewDetail` | 查看详情 | View detail |

语言同步放在 i18n 初始化模块中，避免 `LanguageButton`、设置抽屉或后续其他入口分别维护 DOM 属性。用一个小函数把 `zh` 映射为 `zh-CN`，把 `en` 映射为 `en`；初始化完成后执行一次，并在 `languageChanged` 事件中再次执行。

## 输入状态

`sendMessage` 已支持可选的 `customText`。Enter 事件直接调用 `sendMessage(event.currentTarget.value)`，使本次键盘事件读取到的 textarea 值成为发送内容。`sendMessage` 内原有的 `setInput('')` 继续负责清空受控输入框。

保留以下条件：

- 只有 Enter 且未按 Shift 时发送。
- 输入法组合输入时不发送。
- 没有会话、没有模型或已有生成任务时不发送。

## 无障碍操作

系统提示词和 Skills 的删除按钮沿用项目已有的 `Tooltip + aria-label + icon Button` 结构，不改变 `Popconfirm` 的确认流程。

用量审计新增窄操作列，按钮使用 `Eye` 图标、`ai.usage.viewDetail` Tooltip 和带记录标识的 `aria-label`。按钮与现有行点击都调用 `setSelectedCallId(item.id)`，继续打开同一个 Drawer，不增加第二套详情状态。

## 测试和浏览器验证

自动化测试覆盖状态和语义：

- AI 会话测试增加“选择快捷模板后按 Enter，发送内容正确且输入框清空”，并保留 Shift+Enter 分支。
- 用量审计测试通过可访问名称定位查看详情按钮，再触发 Drawer。
- 新增 AI 管理页面测试，检查 Skills 字段标签、必填提示以及 Skills、系统提示词删除按钮的可访问名称。
- i18n 测试检查初始化语言和中英文切换后的 `<html lang>`。

ego-browser 只做快速回归，不重复原验证任务的全量检查。使用一个新的 task space，依次检查 `/ai/skills`、`/ai/chat`、`/ai/system-prompts`、`/ai/usage`，并在任意 Admin 页面切换中英文核对 `<html lang>`。验证完成后关闭 task space。

```mermaid
%%{init: {"theme": "dark"}}%%
flowchart LR
  F["F-1 至 F-6"] --> C["修改 Admin 前端"]
  C --> T["Vitest 回归测试"]
  T --> Q["类型、Lint、Format"]
  Q --> B["ego-browser 快速验证"]
  B --> R["记录结果并关闭 task space"]
```

## 兼容与回退

- 不修改接口、DTO、query key、权限和持久化字段，不需要数据库迁移。
- 每组修复按文件独立回退。若语言同步影响初始化，先回退 `i18n/index.ts` 及对应测试；其他页面修复不受影响。
- 浏览器验证只读取现有数据并触发可回退的页面状态，不确认删除、不保存表单、不发送包含敏感信息的内容。
