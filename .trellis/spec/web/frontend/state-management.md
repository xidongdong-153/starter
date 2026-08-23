# Web 状态管理规范

## 状态归属

- 服务器渲染的公开资料通过 page 调用 `lib/api/profile.api.ts`，页面不维护一份重复的全局 cache。
- 登录 session 由 Better Auth client 管理，使用 `authClient.useSession()` 和 `authClient.signOut()`。
- 登录/注册表单的 name、email、password、error、pending 是 `AuthForm` 的局部 state。
- 移动菜单 open 状态是 `SiteNav` 局部 state。
- 主题设置由 `useTheme` 管理，并持久化到 `starter-web-theme`。

## AI Run 运行态

Chat 页面的 agents、当前 session、事件折叠结果、transcript 历史和输入框文本都是组件或 `hooks/use-chat-run.ts` 的局部 state，不进全局 store、不写 localStorage。

- `AgentRun.status` 是判断 Run 是否结束的唯一判据；`live` 快照只是进程内视图，不是持久事实。
- 断流后用 `setTimeout` 链式轮询，不用 `setInterval`，避免请求慢于间隔时 tick 重叠。
- 卸载、切换 session、重新发送前 abort 上一个流并停轮询；异步回调回来后先校验 controller 或轮询 token 的身份。
- 详细协议约束见 `ai-runtime-consumer.md`。

## 主题初始化

`app/layout.tsx` 在渲染 body 前执行内联初始化脚本，把 localStorage 或系统偏好转换成 `data-theme`；`useTheme` 在客户端挂载后再读取同一设置。新增主题逻辑要同时保持这两个入口一致，避免 hydration 闪烁和状态覆盖。

## 请求状态

`lib/http.ts` 将网络失败、非 2xx、无效 JSON 和错误 response 统一转换为 `ApiRequestError`。组件显示用户可读错误，但不要把错误状态写进 localStorage 或共享模块变量。
