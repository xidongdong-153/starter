# @starter/theme 前端规范

## 适用范围

`@starter/theme` 为 Admin 和 Web 提供 Rose Pine Dawn/Moon 两套主题。TypeScript 导出主题标识、色板和颜色工具，CSS 导出语义变量，Admin 额外使用 Ant Design token。

## 开发前检查

1. 色板变更先看 `src/palette.ts` 和 `styles/core.css` 两处是否需要同步。
2. Admin token 变更看 `src/antd.ts`，确认 dawn/moon 和组件 token 同时覆盖。
3. CSS 入口变更检查 `packages/theme/package.json` exports 与两个应用的 import。
4. 主题状态变更查看 `apps/admin/src/utils/theme.ts`、`apps/admin/src/stores/modules/setting.ts` 和 `apps/web/hooks/use-theme.ts`。

## 质量检查

```bash
pnpm --filter @starter/theme check-types
pnpm --filter @starter/theme lint
pnpm --filter @starter/theme format:check
pnpm --filter @starter/theme build
```

主题变更还要运行 Admin/Web type-check，并检查 light/dark、system、首屏初始化和持久化设置。

## 文件索引

- `directory-structure.md`：core、admin、web CSS 和 TS 入口。
- `component-guidelines.md`：语义 token、Ant Design token 和色板选择器。
- `hook-guidelines.md`：应用主题 hook 与共享纯函数的边界。
- `state-management.md`：Web/Admin 主题设置的存储方式。
- `type-safety.md`：主题 ID、色板类型和颜色函数返回值。
- `quality-guidelines.md`：双主题、CSS token、SSR 和构建检查。
