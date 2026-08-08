# Web 状态管理规范

## 状态归属

- 服务器渲染的公开资料通过 page 调用 `lib/api/profile.api.ts`，页面不维护一份重复的全局 cache。
- 登录 session 由 Better Auth client 管理，使用 `authClient.useSession()` 和 `authClient.signOut()`。
- 登录/注册表单的 name、email、password、error、pending 是 `AuthForm` 的局部 state。
- 移动菜单 open 状态是 `SiteNav` 局部 state。
- 主题设置由 `useTheme` 管理，并持久化到 `starter-web-theme`。

## 主题初始化

`app/layout.tsx` 在渲染 body 前执行内联初始化脚本，把 localStorage 或系统偏好转换成 `data-theme`；`useTheme` 在客户端挂载后再读取同一设置。新增主题逻辑要同时保持这两个入口一致，避免 hydration 闪烁和状态覆盖。

## 请求状态

`lib/http.ts` 将网络失败、非 2xx、无效 JSON 和错误 response 统一转换为 `ApiRequestError`。组件显示用户可读错误，但不要把错误状态写进 localStorage 或共享模块变量。
