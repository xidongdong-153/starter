# Contracts 前端组件边界

`@starter/contracts` 不定义 React 组件。它提供组件需要的 props 数据形状，例如 `FileItem`、`AccountProfile` 和 `PublicProfile`；转换工作在应用层完成。

Admin 的 `ProfileSettings` 将 `AccountProfile` 转成表单值，Web 的公开资料页面接收 `PublicProfile` 后渲染。不要在 contracts 中加入 JSX、CSS class、Ant Design 类型或 Next.js 依赖，以免共享包绑定某个 UI 平台。
