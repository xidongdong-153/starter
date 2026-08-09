# Admin 测试基础设施设计

## 结论

复用 API 侧已有的 Vitest 形状：一个 `vitest.config.ts`、一个 `test` 脚本、测试文件与被测代码同目录之外的独立目录。差别只有环境从 node 换成 jsdom，以及需要 `@testing-library/react` 渲染 hook 和组件。

不引入自建渲染工具、不引入覆盖率门禁、不改动任何产品代码。

## 1. 依赖决策

catalog 当前有 `vitest: ^4.0.15`，没有 jsdom 和 testing-library。需要新增四个 catalog 条目：

| 依赖                          | 用途                          |
| ----------------------------- | ----------------------------- |
| `jsdom`                       | Vitest 的 DOM 环境            |
| `@testing-library/react`      | 渲染组件和 hook               |
| `@testing-library/dom`        | `@testing-library/react` 的 peer |
| `@testing-library/user-event` | 交互事件（R4b 需要）          |

实现时按 npm 上与 React 19 兼容的当前稳定版本填写具体号段，写入 `pnpm-workspace.yaml` 的 `catalog`，`apps/admin/package.json` 用 `catalog:` 引用。

不引入 `@testing-library/jest-dom`。它提供的 `toBeInTheDocument` 等断言在本任务范围内可以用 `expect(element).not.toBeNull()` 替代，少一层全局 setup 和类型扩展。

## 2. 配置形状

`apps/admin/vitest.config.ts` 与 API 侧对齐，别名与 `tsconfig.app.json` 的 `paths` 一致：

```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@admin": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    restoreMocks: true,
  },
});
```

要点：

- 加载 `@vitejs/plugin-react`，否则 `.tsx` 的 JSX 转换会失败。
- `globals: false`，测试文件显式 `import { describe, expect, it, vi } from 'vitest'`，与 API 侧写法一致。
- `restoreMocks: true`，避免用例间 mock 泄漏。
- 不复用 `vite.config.ts`。那个文件在顶层调用 `parseAdminEnv`，测试环境没有 `VITE_API_URL` 会直接抛错。这是必须独立配置文件的原因。

`apps/admin/package.json` 增加：

```json
"test": "vitest run --config vitest.config.ts"
```

## 3. 测试文件位置

放在 `apps/admin/src/test/`，与 API 的 `apps/api/src/test/` 对齐。

```text
apps/admin/src/test/
├── helpers.tsx                    # QueryClient provider 包装、permission query mock
├── permissions.test.ts            # R3
├── navigation.test.ts             # R4
├── tab-bar.test.tsx               # R4b
├── auth-guard.test.ts             # R5
├── permission-guard.test.tsx      # R6 组件部分
└── authorization-query.test.tsx   # R6 query 部分
```

`tsconfig.app.json` 的 `include` 是 `src/**/*.ts` 和 `src/**/*.tsx`，测试文件自动进入 type-check，不需要改 tsconfig。

`vite build` 的入口是 `index.html`，测试文件不被引用，不会进 `dist`。

## 4. 测试策略

### 4.1 纯函数（R3、R4）

`hasPermission` 和 `buildNavigationMenuItems` 都是纯函数，直接调用断言返回值，不需要渲染。

`buildNavigationMenuItems` 内部使用真实 `adminRouteRecords`，所以断言要基于当前真实 route 配置。已确认的 permission 映射：

| route                      | permission            |
| -------------------------- | --------------------- |
| `/settings/authorization`  | `authorization:read`  |
| `/settings/users`          | `authorization:read`  |
| `/files`                   | `file:list`           |

断言用 `key` 定位（`toMenuItem` 用 `item.path ?? item.key`），不依赖 label 文案，避免 i18n key 变化导致测试失败。

不传 `t`，让 label 保持原始 i18n key。

### 4.2 Query 依赖的 hook 和组件（R6）

`usePermission` 和 `PermissionGuard` 都依赖 `useCurrentPermissionsQuery`。两种可选方式：

一是 mock `@admin/api/authorization` 模块。二是提供真实 `QueryClientProvider`，mock 底层 `getCurrentPermissions`。

选第二种。理由：`currentPermissionsQueryOptions` 的 `staleTime`、`queryKey` 和失效行为本身就是 R6 要验证的内容，mock 掉整个模块会把这些逻辑一起绕过。

`helpers.tsx` 提供：

```tsx
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

export function renderWithQueryClient(ui: ReactNode, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
```

`retry: false` 是必须的，否则 error 用例会等默认重试耗尽。

用 `vi.mock('@admin/api/authorization/authorization.api')` 控制 `getCurrentPermissions` 的 resolve / reject，覆盖 pending、success、error 三态。

### 4.3 Route guard（R5）

`requireAdminRoutePermission` 接收 `QueryClient` 参数，不需要 React 渲染。

`redirect()` 来自 `@tanstack/react-router`，抛出的对象带 `to` 字段。测试直接构造 `QueryClient`，用 `vi.spyOn(queryClient, 'fetchQuery')` 控制返回值和抛错：

- resolve 带足够 permission → `await expect(...).resolves.toBeUndefined()`
- resolve 缺 permission → 捕获抛出物，断言 `to` 是 `/403`
- reject `new ApiRequestError(401, '...')` → 断言 `to` 是 `/login`
- reject `new Error('boom')` → 断言原样抛出，不是 redirect

`ApiRequestError` 从 `@admin/api/http` 导入真实类，不自造对象。`isUnauthorizedError` 用 `instanceof` 判断，假对象过不了。

### 4.4 Query 失效（R6）

两个 mutation 的 `onSuccess` 调用 `invalidateAuthorizationQueries`，失效 current、users、roles 三组 key。

测试方式：`vi.spyOn(queryClient, 'invalidateQueries')`，渲染 `renderHook` 调用 mutation，`await` 完成后断言 spy 被三个 queryKey 分别调用。

`authorization.api` 的两个 replace 函数用 `vi.mock` 返回固定成功值。

## 5. 根目录测试入口

```diff
-"test": "pnpm --filter=@starter/api test"
+"test": "turbo run test"
```

`turbo.json` 已有 `test` task，`outputs: ["coverage/**"]`，不需要修改。

改动后只有声明了 `test` 脚本的包会被执行，即 `@starter/api` 和 `@starter/admin`。`web`、`contracts`、`theme`、`eslint-config` 没有 `test` 脚本，turbo 会跳过。

## 6. 风险

- jsdom 下 Antd 组件可能因缺少 `matchMedia`、`ResizeObserver` 报错。`TabBar` 用了 `Dropdown` 和 `useMobile`。如果需要 polyfill，只在 `tab-bar.test.tsx` 内局部 stub，不建全局 setup 文件；R4b 已经写明降级路径。
- `@vitejs/plugin-react` 在 Vitest 4 下的兼容性需要实测。如果冲突，改用 esbuild 的 `jsx: 'automatic'`，不降级 Vitest 版本。
- 测试文件进入 `eslint .` 后可能触发 `@antfu/eslint-config` 的规则（例如 `no-top-level-await`）。修的是测试文件写法，不加 eslint 例外配置。
- `buildNavigationMenuItems` 断言依赖真实 route 配置，后续增删 route 会影响测试。这是有意的：route permission 变化本来就应该让测试失败，提醒同步检查。

## 7. 回滚

全部改动是新增文件加三处配置修改，没有产品代码变更。回滚删除 `apps/admin/src/test/`、`apps/admin/vitest.config.ts`，还原 `apps/admin/package.json`、根 `package.json` 和 `pnpm-workspace.yaml` 即可，不影响运行时。
