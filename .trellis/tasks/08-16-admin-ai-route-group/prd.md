# Admin AI 独立路由组

## 目标

把 AI 功能从"系统设置"菜单组中独立出来，成为顶级 AI 主菜单；同时把 AI 页面 URL 统一收敛到 `/ai/*` 前缀，与后端 `/api/ai/*` 前缀对齐。

## 需求

### URL 统一到 `/ai/*`

| 页面 | 新路径 | 原路径 |
| --- | --- | --- |
| AI 会话 | `/ai/chat` | `/ai/chat`（不变） |
| AI 模型 | `/ai/settings` | `/settings/ai` |
| AI Provider | `/ai/providers` | `/settings/ai/providers` |
| AI 用量审计 | `/ai/usage` | `/settings/ai/usage` |

### 顶级 AI 主菜单

- 侧边栏新增顶级"AI"菜单组，AI 4 个页面全部归入该组，不再出现在"系统设置"组。
- 组内顺序：AI 会话、AI 模型、AI Provider、AI 用量审计。
- 菜单图标用 `Bot`（`Sparkles` 已被示例组占用）。
- 菜单组排序放在"文件"与"系统设置"之间（`order: 15`）。
- i18n 新增 `menu.ai` 文案（zh/en）。

### 路由 id 统一为 `ai.*` 前缀

| 新 id | 原 id |
| --- | --- |
| `ai.chat` | `ai.chat`（不变） |
| `ai.settings` | `settings.ai` |
| `ai.providers` | `settings.aiProviders` |
| `ai.usage` | `settings.aiUsage` |

## 约束

- 保持现有 `records 平铺 + menu.group 分组` 模式，不引入嵌套 Outlet 父路由。
- 权限配置不变：AI Provider 仍要求 `AI_CONFIG_READ`，AI 用量审计仍要求 `AI_USAGE_READ`，无权限用户看不到对应菜单项。
- 旧路径不提供重定向（开发阶段项目未发布，直接迁移）。
- 除 AI 相关文件外，不改动其他功能的路由和菜单。

## 验收条件

- [ ] 侧边栏出现顶级"AI"主菜单，包含 4 个菜单项，顺序为会话、模型、Provider、用量；"系统设置"组中不再出现 AI 相关菜单项。
- [ ] 4 个新 URL 均可访问对应页面；旧 URL `/settings/ai`、`/settings/ai/providers`、`/settings/ai/usage` 不再被任何代码和测试引用。
- [ ] 无 `AI_CONFIG_READ` / `AI_USAGE_READ` 权限时，对应菜单项隐藏，直接访问 URL 被权限守卫拦截。
- [ ] 路由 id 变更后 TabBar 权限映射和标签页行为正常（TabBar 由 `appRouteRecords` 派生，自动生效；Tab 状态为内存态，无持久化残留）。
- [ ] `navigation.test.ts` 及 AI 相关测试更新后全部通过。
- [ ] `pnpm --filter @starter/admin check` 通过（类型、Lint、Format 零错误）。
