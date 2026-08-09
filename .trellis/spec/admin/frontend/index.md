# @starter/admin 前端规范

## 适用范围

本目录描述 `apps/admin/src/` 的 React 管理后台代码。Admin 是 Vite + React 19 单页应用，使用 TanStack Router、TanStack Query、Zustand、Ant Design、react-i18next 和 `@starter/theme`。

## 开发前检查

1. 先看 `apps/admin/src/app/router/records.ts`，确认页面是否需要登录、标签页和导航记录。
2. 页面放入对应的 `features/<domain>/pages/`，路由放入同一 feature 的 `routes.tsx`。
3. 服务端数据先看 `api/<domain>/*.api.ts` 和 `*.query.ts`，不要在页面里直接拼接请求。
4. 需要全局显示设置或标签页状态时，先看 `stores/modules/setting.ts` 与 `stores/modules/tabBar.ts`。
5. 涉及主题变量时，同时查看 `packages/theme/styles/admin.css` 和 `packages/theme/src/antd.ts`。

## 质量检查

在修改 Admin 代码后运行：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
```

仓库级检查使用 `pnpm check`。当前 Admin 没有独立的组件测试目录，交互变化至少要覆盖加载、失败、空数据和 mutation pending 状态。

## 代码入口

- `apps/admin/src/main.tsx`：挂载 React 根节点并加载全局样式。
- `apps/admin/src/App.tsx`：装配 Ant Design、语言环境、QueryClient 和 Router。
- `apps/admin/src/app/router/routes.tsx`：生成根路由、认证路由和登录后布局路由。
- `apps/admin/src/layout/RootLayout.tsx`：装配布局、设置抽屉、移动端菜单和路由监听。
- `apps/admin/src/api/http.ts`：统一处理凭据、JSON/FormData 请求和 API 错误。

## 文件索引

- `directory-structure.md`：目录、feature、路由和导入边界。
- `component-guidelines.md`：页面、表单、共享组件和交互反馈。
- `hook-guidelines.md`：React Query hooks、UI hooks 和副作用清理。
- `state-management.md`：React Query、Zustand、表单和局部 state 的归属。
- `type-safety.md`：contracts DTO、表单转换、路由和 store 类型。
- `authorization-guidelines.md`：权限 query、路由、菜单、标签栏、403 和文件动作控制。
- `quality-guidelines.md`：检查命令和页面交互质量要求。
