# Theme Hook 边界

`@starter/theme` 不定义 React hook。它提供纯函数和常量；浏览器副作用由应用管理：

- Web 的 `useTheme` 读取 localStorage、写 `data-theme` 并监听系统主题。
- Admin 的 `useSettingStore` 调用 `updateThemeAttribute` 和 `updatePrimaryColorAttribute`，并持久化主题模式。

新增主题 hook 应留在对应应用，不要让共享 theme 包依赖 React、Zustand 或 Next.js。修改纯函数时保持 SSR/Node 可调用，不访问 `window` 或 `document`。
