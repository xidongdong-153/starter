# Theme 状态管理规范

主题包本身无状态。主题设置的生命周期由应用决定：

- Web 使用 `starter-web-theme` 存储 `dawn`、`moon` 或 `system`，根布局脚本先设置 data attribute，`useTheme` 再同步客户端状态。
- Admin 使用 `starter-admin-setting` 的 Zustand persist，只持久化 `adminTheme`、`language` 和 `themeMode`；抽屉、移动菜单和 sidebar 临时状态不持久化。
- CSS 只根据 `data-theme` 选择变量，不读取 localStorage。

不要在 `packages/theme/src` 增加模块级可变的当前主题；需要切换时由应用调用 `applyTheme` 或更新 store。
