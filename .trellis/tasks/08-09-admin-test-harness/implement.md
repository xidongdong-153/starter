# 执行计划

## 顺序

### 1. 依赖与配置

- [x] 查 npm 确认 `jsdom`、`@testing-library/react`、`@testing-library/dom`、`@testing-library/user-event` 与 React 19 兼容的当前稳定版本。
- [x] 在 `pnpm-workspace.yaml` 的 `catalog` 按字母序插入这四个条目。
- [x] 在 `apps/admin/package.json` 的 `devDependencies` 增加这四项加 `vitest`，全部写 `catalog:`。
- [x] 运行 `pnpm install`。
- [x] 新增 `apps/admin/vitest.config.ts`，按 design 第 2 节形状。
- [x] 在 `apps/admin/package.json` 增加 `"test": "vitest run"`。配置文件用默认发现，不写 `--config`。
- [x] 写一个最小 smoke 测试确认环境可跑，再删掉。
- [x] 追加 `apps/admin/tsconfig.node.json` 的 `include`，加入 `vitest.config.ts`，否则该文件不被任何 tsconfig 覆盖，`pnpm check-types` 报错。

检查点：`pnpm --filter @starter/admin test` 能启动并通过，不报 JSX 或别名解析错误。

### 2. 纯函数测试

- [x] `apps/admin/src/test/permissions.test.ts` 覆盖 R3：`undefined`、空数组、命中、未命中。共 4 例。
- [x] `apps/admin/src/test/navigation.test.ts` 覆盖 R4：四组权限组合加 `menu: false` 加分组顺序，用 `key` 定位，不传 `t`。共 6 例。
- [x] 新增 `apps/admin/src/test/setup.ts`。`navigation.ts` 间接引入 setting store，模块初始化就调用 `matchMedia`，jsdom 不提供。setup 里补 `matchMedia`。

检查点：两个文件通过，断言基于真实 `adminRouteRecords`。

实际偏差：PRD R4 写的是「无权限时 `settings` 分组不出现」，真实行为是 `settings` 分组因个人资料（无 permission 要求）仍然保留，只是不含受保护项。按「断言当前真实行为」原则，测试断言后者，并单独加一例说明。

### 3. Route guard 测试

- [x] `apps/admin/src/test/auth-guard.test.ts` 覆盖 R5 四个分支，另加一例 403 原样抛出，共 5 例。
- [x] 401 用例使用从 `@admin/api/http` 导入的真实 `ApiRequestError`。
- [x] 用 `vi.spyOn(queryClient, 'fetchQuery')` 控制，不 mock 整个 react-query。

检查点：`/403` 与 `/login` 两个 redirect 分支断言的是抛出物的 `to` 字段；非 401 错误原样抛出。

实际偏差：TanStack Router 的 `redirect()` 返回 `Response` 实例，跳转目标在 `options.to`，不是顶层 `to`。断言改为读 `options.to`。

### 4. Query 与组件测试

- [x] `apps/admin/src/test/helpers.tsx` 提供 `createTestQueryClient` 和 `renderWithQueryClient`，`retry: false`。
- [x] `helpers.tsx` 另提供 `createCurrentPermissions`，四个测试文件共用同一份 `CurrentPermissions` 形状，不各自重写。
- [x] `apps/admin/src/test/permission-guard.test.tsx` 覆盖 R6 组件部分：pending、error、无权、有权四态，另加默认 fallback 一例，共 5 例。
- [x] `apps/admin/src/test/authorization-query.test.tsx` 覆盖 R6 的 `usePermission` 四态、query options 形状和两个 mutation 的三组 key 失效，另加 mutation 失败不失效一例，共 8 例。
- [x] `vi.mock('@admin/api/authorization/authorization.api')` 控制 API 层返回。

检查点：pending 态断言在 promise resolve 之前完成；三组 queryKey 的失效各有独立断言。

### 5. TabBar 测试

- [x] `apps/admin/src/test/tab-bar.test.tsx` 按 design 第 4 节和 PRD R4b 实现，共 4 例。
- [x] `vi.mock('@tanstack/react-router')` 只替换 `useNavigate` 和 `useRouter`，保留其余导出。全量 mock 会让 `appRouteRecords` 拿不到真实 `lazyRouteComponent`。
- [x] 每个用例前重置 `useTabBarStore` 状态，用真实 store 的 `reset()` 和 `addTab`。
- [x] 缺失的 DOM 能力统一放进 `src/test/setup.ts`，没有按原计划做本文件局部 stub。原因见下。

R4b 未降级，TabBar 已覆盖。

检查点：无权限时带 permission 的 tab 不出现在渲染结果里。

实际偏差，两处 jsdom 环境缺口，都在 `setup.ts` 补齐而非局部 stub，因为 `matchMedia` 在步骤 2 已经需要，局部 stub 会重复：

- `localStorage`：Node 22 的实验性 `localStorage` 覆盖 jsdom 实现，descriptor 存在但取值为 `undefined`，zustand persist 直接失败。补一个最小 `Storage` 实现。
- `scrollIntoView`：jsdom 不实现，TabBar 在 rAF 回调里调用，导致未捕获异常。补空实现。

### 6. 接入根目录

- [x] 根 `package.json` 的 `test` 改为 `turbo run test`。
- [x] 确认 `pnpm test` 同时跑到 API 与 Admin：API 17 例，Admin 32 例，全部通过。

### 7. 质量门禁

按项目顺序执行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

- [x] 五项全过。
- [x] `git diff --stat apps/admin/src` 为空，除新增 `src/test/` 外没有产品代码改动。
- [x] 确认 `apps/admin/dist/assets` 里没有测试文件。

为过 lint 做的两处测试代码调整，未加 eslint 例外：

- `vi.mock` 的模块路径用字符串字面量而非 `import.meta.resolve`，`importOriginal<T>()` 带类型参数，避免部分 mock 的返回值参与模块类型比对（`useRouter` 是泛型返回 `TRouter`，全量类型比对过不了 `tsc`）。
- 删掉未使用的 `screen` 导入，测试统一走 `container.querySelector`。

## 已知缺口

实现过程中发现但不在本任务修复的问题记录在这里，交给后续任务或单独告知。

- `@testing-library/user-event` 已写入 catalog 和 `apps/admin/package.json`，但当前 6 个测试文件都没用到。R4b 最终只靠渲染结果断言，没做点击交互。保留给 S3 审计页的表单交互测试；若 S3 也用不上，应从两处一起删掉。

- `apps/admin/src/test/setup.ts` 里补的 `localStorage` 是最小实现，只有 `getItem`/`setItem`/`removeItem`/`clear`/`key`/`length`。如果后续测试依赖 `Storage` 的其他行为，需要扩展或换用 `jsdom` 的 `--experimental-webstorage` 关闭方案。
- 授权管理 drawer（`apps/admin/src/app/authorization/` 下的表单交互）没有覆盖。本任务范围是权限逻辑、导航数据和 guard 分支，drawer 的 Antd 深层交互按 PRD 明确排除。S3 新增审计页时可以复用现在的 `helpers.tsx` 直接补。
- `apps/web` 仍然没有任何测试，`turbo run test` 对它是空跑。

## 回滚点

- 步骤 1 装依赖后如果 `@vitejs/plugin-react` 与 Vitest 4 冲突，先按 design 第 6 节改 esbuild JSX 方案，不降级 Vitest。
- 步骤 5 失败时降级为已知缺口，不回退前四步。
- 步骤 6 如果 `turbo run test` 在 CI 或本地出现缓存问题，可临时改回显式 filter 形式并记录，但不能让 Admin 测试脱离 `pnpm test`。

## 验证命令

```bash
pnpm --filter @starter/admin test
pnpm test
pnpm check-types
pnpm lint
pnpm format:check
pnpm build
```
