# Web Hook 规范

## 浏览器 hook

只有需要浏览器状态或副作用的组件才使用 hook。`hooks/use-theme.ts` 负责读取 localStorage、同步 `data-theme`、响应系统主题变化，并在 effect 清理 media query listener。

```tsx
useEffect(() => {
  if (!theme) return;

  activateTheme(theme);
  if (theme !== "system") return;

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => activateTheme("system");
  mediaQuery.addEventListener("change", handleChange);
  return () => mediaQuery.removeEventListener("change", handleChange);
}, [theme]);
```

## 认证和请求

`SessionHome` 使用 `authClient.useSession()` 读取 session，并在 effect 中刷新一次 session；`AuthForm` 用局部 state 管理输入和 pending。服务端数据请求函数放在 `lib/api/`，不在通用 hook 中隐藏 URL 或 response 解析。

## 清理与依赖

effect 注册事件、计时器或 media query 时必须返回清理函数。异步 effect 要用 active 标记避免卸载后写 state，`AuthForm` 获取 provider 配置的写法可作为例子。

不要在 Server Component 中调用浏览器 hook，也不要为静态页面引入全局状态库。
