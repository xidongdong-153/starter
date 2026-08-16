# Implement Plan

## 改动清单

1. `apps/admin/src/features/ai/routes.tsx`
   - 4 条记录的 `path` 改为 `/ai/*` 前缀（chat 不变）。
   - 4 条记录的 `id` 改为 `ai.*` 前缀。
   - `menu.group` 全部从 `settings` 改为 `ai`，组内 order 保持 5/6/7/8。

2. `apps/admin/src/app/navigation/navigation.ts`
   - `navigationGroups` 新增 `ai` 组：`icon: Bot`、`label: 'menu.ai'`、`order: 15`。
   - 从 `lucide-react` 引入 `Bot`（注意与现有导入去重）。

3. `apps/admin/src/i18n/locales/zh.ts` 与 `en.ts`
   - `menu` 下新增 `ai` 文案：zh `'AI'`、en `'AI'`（按现有文案风格，如"AI 能力"需保持 zh/en 对称，实施时确认）。

4. `apps/admin/src/test/navigation.test.ts`
   - 更新对 `/settings/ai`、`/settings/ai/providers` 及 AI 菜单分组结构的断言。

## 验证

- `pnpm --filter @starter/admin check-types`
- `pnpm --filter @starter/admin lint`
- `pnpm --filter @starter/admin format:check`
- `pnpm --filter @starter/admin test`（navigation / ai 相关用例）

## 影响说明

- TabBar 由 `appRouteRecords` 派生权限映射，id 变更自动生效；Tab store 为内存态（zustand，无 persist），无旧 id 残留。
- 旧 URL 直接失效，不加重定向（开发阶段）。
