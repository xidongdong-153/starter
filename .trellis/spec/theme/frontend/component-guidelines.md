# Theme 组件使用规范

theme 包不定义 React 组件。组件通过语义 CSS token 使用主题：Web 使用 `bg-background`、`text-foreground`、`border-border`，Admin 使用 `admin.css` 暴露的 `bg-surface`、`text-fg` 和 `text-primary` 等类。

Admin 的 Ant Design 组件通过 `getAntdThemeConfig(themeId)` 获得 token，再由 `apps/admin/src/App.tsx` 的 `ConfigProvider` 应用。不要在单个页面直接复制 dawn/moon 颜色或绕过 ConfigProvider 写一套局部主题。

需要显示色板选择器时使用 `rosePineThemes` 和 `getThemeColors`，例如 Admin 的 `SettingDrawer`，不要手写第二份颜色列表。
