# Theme 后端日志边界

`@starter/theme` 不创建 logger、不输出日志，也不读取环境变量。颜色和 token 函数应保持纯函数，便于在 API 或构建工具中安全调用。

若发现主题解析失败，调用方决定是否记录日志；不要在共享 theme 包中直接 `console.error` 或引入 Pino。
