# Admin 目录结构

## 目录职责

`apps/admin/src/` 按运行职责和业务 feature 分层：

- `api/`：按领域拆分请求函数和 React Query hooks。例：`api/files/files.api.ts`、`api/files/files.query.ts`。
- `app/`：QueryClient、路由、导航记录和路由访问控制。
- `assets/styles/`：reset、滚动条、Ant Design 覆盖、布局和工具样式。
- `components/`：跨 feature 复用的通用组件，分为 `common/` 与 `ui/`。
- `config/`：Admin 专用配置，例如 `config/theme.ts`。
- `features/<domain>/`：页面和该领域的路由，例如 `features/files/pages/FileList.tsx` 与 `features/files/routes.tsx`。
- `hooks/`：跨页面 React hooks，例如 `useMobile`、`useRouteListener`。
- `i18n/`：i18next 实例和中英文资源。
- `layout/`：根布局、顶部栏、侧栏、标签栏和抽屉。
- `stores/`：Zustand store，按 `stores/modules/` 拆分。
- `utils/`：日期、文件大小、路径、路由、主题等无 UI 工具。

## 页面与路由

新增页面时同时更新 feature 路由和 `app/router/records.ts`。现有路由通过 record 生成 TanStack Router route，`routes.tsx` 中的 `staticData` 负责标题、图标、标签页和布局信息。

```tsx
// apps/admin/src/features/files/routes.tsx
export const filesRoutes = [
  {
    component: FileList,
    id: "files",
    path: "/files",
    tab: { closable: true },
    title: "files.title",
  },
];
```

## 导入路径

业务代码使用 `@admin/*` 别名，别名根目录是 `apps/admin/src/`，配置在 `apps/admin/tsconfig.app.json`。不要从构建产物或 `dist` 导入源码。

## 不要做的事

不要把页面组件、请求函数和全局 store 放回 `src/App.tsx` 或 `src/layout/`。`App.tsx` 只负责应用级 Provider，领域行为应留在对应 feature 或 api 目录。
