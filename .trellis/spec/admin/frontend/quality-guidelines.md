# Admin 质量规范

## 必须通过的检查

修改 `apps/admin` 后依次运行：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test
```

`check-types` 同时检查 `tsconfig.app.json` 和 `tsconfig.node.json`。仓库级 `pnpm check` 还会通过 Turborepo 检查所有 workspace，`pnpm test` 通过 `turbo run test` 同时执行 API 与 Admin 测试。

## 测试环境

测试用 Vitest + jsdom，配置在 `apps/admin/vitest.config.ts`，测试文件放 `apps/admin/src/test/`，与 API 的 `apps/api/src/test/` 对齐。

配置有三条必须遵守的约束：

- 必须独立于 `vite.config.ts`。后者在顶层调用 `parseAdminEnv`，测试环境没有 `VITE_API_URL` 会直接抛错。
- 必须加载 `@vitejs/plugin-react`，否则 `.tsx` 的 JSX 转换失败。
- 新增的根级配置文件要同步加进 `tsconfig.node.json` 的 `include`，否则不被任何 tsconfig 覆盖，`check-types` 报错。

`src/test/setup.ts` 补齐三个 jsdom 缺失的浏览器能力。新增测试碰到类似缺失时补在这里，不在单个测试文件里局部 stub：

| 能力 | 缺失原因 | 谁需要 |
| --- | --- | --- |
| `matchMedia` | jsdom 不实现 | `stores/modules/setting.ts` 在模块初始化就调用，任何间接 import 到 store 的测试都会在 import 阶段失败 |
| `localStorage` | Node 22 的实验性实现盖掉 jsdom 版本，未传 `--localstorage-file` 时取值为 `undefined` | zustand `persist` 直接调用 `setItem` |
| `scrollIntoView` | jsdom 不实现 | `TabBar` 在 `requestAnimationFrame` 回调里调用，抛错会变成无法捕获的异常而不是用例失败 |

## 现有测试风格

测试只覆盖权限逻辑、导航数据和 guard 分支，不测 Antd 组件内部行为、样式和布局。

- 纯函数直接调用断言，不渲染。`buildNavigationMenuItems` 内部使用真实 `adminRouteRecords`，断言要基于当前真实 route 配置，用 `key` 定位而不是 i18n 文案。
- 依赖 query 的 hook 和组件用真实 `QueryClientProvider`，只 `vi.mock` 最底层的 `authorization.api`。这样 `staleTime`、`queryKey` 和失效行为本身也在测试范围内。`QueryClient` 必须配 `retry: false`，否则 error 用例要等默认重试耗尽。
- 共用的测试工具放 `src/test/helpers.tsx`：`createTestQueryClient`、`renderWithQueryClient`、`createQueryClientWrapper`、`createCurrentPermissions`。DTO 构造工厂集中在这里，contracts 变动时只有一处要跟。
- 部分 mock 一个模块时用字符串路径加 `importOriginal<T>()`，不用 `vi.mock(import('...'), ...)` 形式。后者会把返回值与完整模块类型比对，`useRouter` 这类泛型返回过不了 `tsc`。
- 全量 mock `@tanstack/react-router` 会让 `appRouteRecords` 拿不到真实 `lazyRouteComponent`，模块加载即失败。只替换用到的 hook。

> **Warning**: TanStack Router 的 `redirect()` 返回 `Response` 实例，跳转目标在 `options.to` 而不是顶层 `to`。
>
> 断言顶层 `to` 会拿 `undefined` 跟 `undefined` 比而假通过，测试看起来是绿的但没有验证任何东西。

## 交互质量

- 查询页面显示加载态；失败时显示 `Alert` 和可执行的重试按钮；空结果交给组件的 `emptyText` 或页面空状态。
- mutation 期间禁用或显示 loading，避免重复提交。成功和失败都通过 Ant Design `App` 的 message/modal 反馈。
- 错误边界必须保留用户可执行的重试和返回首页操作，参见 `components/ui/ErrorBoundary.tsx`。
- 图标按钮要有 `aria-label` 或 Tooltip；移动菜单打开时锁定 body 滚动、聚焦首个链接并支持 Escape 关闭，参见 `layout/atoms/MobileMenuButton.tsx` 和 `layout/components/mobile-drawer/MobileDrawer.tsx`。
- 主题和语言切换不能只改变视觉状态，还要更新 `data-theme`、Ant Design locale 或 i18n 实例。

## AI 管理页面验证规则

- 页面说明、表格列标题和表单字段标签使用不同的 i18n key；页面说明不能复用为“描述”“名称”等字段标题。
- 新增 `t('...')` key 后，在 `zh.ts` 和 `en.ts` 中分别检查真实 key；提交空表单时不能显示原始 key。
- 图标按钮必须有 `aria-label` 或 `Tooltip`；仅有垃圾桶、复制或关闭图标的按钮不能依赖图标猜测用途。
- 表格行通过 `onClick` 打开详情时，同时提供可聚焦的按钮或键盘操作；只设置 `cursor-pointer` 不算键盘可用。
- 切换语言时同时更新 `document.documentElement.lang`，并检查页面可见文案和 HTML 语言属性一致。
- 一次性 secret 只出现在展示弹窗里：断言列表只有 `secretPrefix`，断言弹窗关闭后 mutation 已 reset，query cache 里搜不到 secret 字符串。

## 变更后的检查重点

新增 API query 时确认 query key 唯一、mutation 成功后的 cache 更新正确；新增路由时确认登录守卫、标签栏元数据和移动端导航都能得到该路由；新增表单时确认提交值经过 schema 对应的转换。

新增受权限保护的路由或操作时，补 `src/test/` 下的对应用例：route guard 的允许与拒绝分支、导航过滤、`PermissionGuard` 的四种状态。前端隐藏入口不替代 API guard，测试只验证界面行为。
