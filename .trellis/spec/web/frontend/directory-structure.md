# Web 目录结构

## App Router 分组

`apps/web/app/` 按访问场景分组：

- `(site)/`：公开站点布局和页面，包括首页、文稿、项目、搜索、对话、公开资料。
- `(auth)/`：登录和注册页面。
- `layout.tsx`：全局字体、metadata、viewport、主题初始化和 body。
- `loading.tsx`、`error.tsx`、`not-found.tsx`：全局加载、错误和 404 状态。

站点共享 UI 放在 `app/(site)/_components/`，跨路由客户端组件放在 `components/`，浏览器 hooks 放在 `hooks/`，数据访问放在 `lib/api/`。

## 页面与数据访问

动态公开资料页位于 `app/(site)/profiles/[userId]/page.tsx`，通过 `lib/api/profile.api.ts` 获取并校验 `PublicProfile`。不要在 page 文件里直接拼接数据库查询或重复 API response 解析。

```text
apps/web/
├── app/(auth)/
├── app/(site)/
├── components/
├── hooks/
├── test/
└── lib/
    ├── ai/
    ├── api/
    ├── auth-client.ts
    ├── env.client.ts
    └── http.ts
```

`lib/ai/` 只放与后端协议相关的纯逻辑（事件归并、SSE 帧解析），不 import React、不碰 DOM，方便在 node 环境下直接测。浏览器编排逻辑（请求时序、AbortController、轮询）放 `hooks/`，测试放 `test/`。

## 路径与环境

Web 使用 `@web/*` 别名，配置在 `apps/web/tsconfig.json`。浏览器 API 地址由 `lib/env.client.ts` 解析；不要把服务端 secret 放进公开环境变量或客户端 bundle。
