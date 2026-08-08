# Theme 前端目录结构

- `styles/core.css`：`--theme-*` 基础语义变量，按 `[data-theme='dawn']` 与 `[data-theme='moon']` 定义。
- `styles/admin.css`：引入 core，并把变量映射到 Tailwind token，供 Admin 使用。
- `styles/web.css`：引入 core，并提供 Web 字体、颜色和边框 token。
- `src/palette.ts`：色板和主题查询。
- `src/color.ts`：颜色转换和色阶生成。
- `src/antd.ts`：Admin 的 Ant Design token/algorithm。
- `src/index.ts`：主题公共 TS 入口。

两个应用从 package exports 导入 CSS，不要复制 `core.css` 到应用目录。应用自己的主题 state 和 DOM 副作用留在应用包内。
