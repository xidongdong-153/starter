# @starter/web 前端规范

## 适用范围

本目录描述 `apps/web/` 的 Next.js 16 App Router 公开站点。Web 使用 React 19、Tailwind CSS 变量和 `@starter/theme`，默认端口为 4399。

## 开发前检查

1. 先按 `app/(auth)/`、`app/(site)/` 和动态路由确认页面归属。
2. 默认使用 Server Component；只有读取浏览器 API、事件、状态或 Better Auth React client 时才加 `'use client'`。
3. API 调用放在 `lib/api/`，统一经过 `lib/http.ts`；需要运行时校验时参考 `lib/api/profile.api.ts`。
4. 主题逻辑同时查看 `app/layout.tsx`、`lib/theme.ts`、`hooks/use-theme.ts` 和 `packages/theme/styles/web.css`。
5. 新增页面要同步 loading、error、not-found 或空状态路径，并确认文稿、项目等尚未接入的 API 不显示虚构数据。

## 质量检查

```bash
pnpm --filter @starter/web check-types
pnpm --filter @starter/web lint
pnpm --filter @starter/web format:check
pnpm --filter @starter/web build
```

仓库级检查使用 `pnpm check`。可访问性、移动端导航、主题首屏状态和 API 错误反馈是 Web 变更的必查项。

## 关键入口

- `apps/web/app/layout.tsx`：metadata、字体、主题首屏脚本和 html/body 根节点。
- `apps/web/app/(site)/layout.tsx`：公开站点导航、内容区域和 footer。
- `apps/web/app/(auth)/`：登录注册页面壳。
- `apps/web/components/auth/auth-form.tsx`：邮箱和第三方认证表单。
- `apps/web/lib/http.ts`：JSON response wrapper 和 `ApiRequestError`。

## 文件索引

- `directory-structure.md`：App Router 分组、共享组件、hooks 和 API 目录。
- `component-guidelines.md`：Server/Client Component、导航、可访问性和内容边界。
- `hook-guidelines.md`：主题、session、异步 effect 和清理函数。
- `state-management.md`：session、表单、菜单和主题状态归属。
- `type-safety.md`：contracts、运行时 guard、props 和环境变量。
- `quality-guidelines.md`：页面状态、可访问性、响应式和检查命令。
