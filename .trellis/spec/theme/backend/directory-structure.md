# Theme 后端目录边界

主题包的源文件按能力拆分：

- `src/palette.ts`：Rose Pine 主题 ID、名称、颜色列表和主色查询。
- `src/color.ts`：hex、RGB、HSL、RGBA、颜色混合和色阶生成。
- `src/antd.ts`：Admin 使用的 Ant Design `ThemeConfig`。
- `src/index.ts`：主题名称、纯工具和 palette 的公共入口。
- `styles/core.css`、`styles/admin.css`、`styles/web.css`：CSS 变量和 Tailwind 入口。

后端代码只能按需使用纯 TS exports，不应绕过 package exports 读取 CSS 或内部文件。
