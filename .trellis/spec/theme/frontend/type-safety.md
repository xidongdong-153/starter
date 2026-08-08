# Theme 类型安全规范

主题 ID 使用字面量联合，不使用任意 string 作为应用内部状态：

```ts
export const THEMES = ["dawn", "moon"] as const;
export type ThemeName = (typeof THEMES)[number];

export function resolveTheme(value: string | null | undefined): ThemeName {
  return isThemeName(value) ? value : DEFAULT_THEME;
}
```

`RosePineTheme` 的 id 是 `'dawn' | 'moon'`，主色查询通过 `getThemeById` 和 `getPrimaryColorByTheme`。外部 localStorage、data attribute 和配置字符串先通过 `resolveTheme`/`isThemeName` 收窄。

颜色工具的无效输入类型是 `null` 或约定的 fallback，调用方不能把可能为 null 的 `hexToRgb` 结果直接当作 RGB 对象。
