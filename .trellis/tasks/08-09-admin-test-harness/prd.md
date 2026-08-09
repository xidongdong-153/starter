# Admin 测试基础设施

## Goal

给 `apps/admin` 引入 Vitest + jsdom 测试环境，覆盖已有的权限判断、导航过滤、route guard 和 query 失效行为，并把 Admin 测试接入根目录 `pnpm test`。

本任务不改变任何产品行为，只增加测试基础设施和针对现状的回归测试。

## Background

父任务：`08-09-rbac-governance`。本任务是 S1，没有前置子任务。

`apps/admin/package.json` 当前只有 build、check-types、lint、format 脚本，没有 `test`。仓库中没有 `apps/admin/**/*.test.ts(x)`。根目录 `test` 脚本是 `pnpm --filter=@starter/api test`，即使直接新增 Admin 测试文件也不会被执行。

因此以下已实现的行为没有任何自动化证据：

- `hasPermission` 的权限判断和 `usePermission` 返回的 allowed/loading/error 组合。
- `buildNavigationItems` 按 route permission 过滤菜单。
- `requireAdminRoutePermission` 的无权跳 `/403`、401 跳 `/login`、其他错误继续抛出三个分支。
- `PermissionGuard` 在 loading、失败、无权时不渲染 children。
- mutation 成功后同时失效 current、users、roles 三组 query。

后续 S2 和 S3 都会改动 Admin，S3 还要新建一个完整的审计页面。先建立这层测试是后两个子任务的回归基础。

## Product Decision

- 测试环境使用 jsdom，不使用 node 环境。归档任务的 `implement.md` 原本要求 node 环境、不引入 DOM 依赖，但那样 `PermissionGuard` 的渲染行为、授权管理 drawer 和 S3 的审计页都无法覆盖，只能人工验收。本任务是安装测试基础设施的唯一合适时机，之后再补要回头改配置。
- 使用 `@testing-library/react` 渲染组件和 hook，不自建渲染工具。
- Antd 组件不做深层交互测试。本任务只覆盖权限逻辑、导航数据和 guard 分支，不测 Antd 内部行为。
- 新增依赖需要写入 `pnpm-workspace.yaml` 的 `catalog`，因为 catalog 当前只有 `vitest`，没有 jsdom 和 testing-library。

## Requirements

### R1. 测试环境

- 在 `pnpm-workspace.yaml` 的 `catalog` 增加 `jsdom`、`@testing-library/react`、`@testing-library/dom`、`@testing-library/user-event`，版本固定为具体号段，不用开放区间之外的写法。
- 在 `apps/admin` 增加上述依赖和 `vitest` 的 devDependency，全部通过 `catalog:` 引用。
- 新增 `apps/admin/vitest.config.ts`，环境为 jsdom，解析 `@admin/` 与 `@starter/contracts` 别名，与 `tsconfig.app.json` 的 `paths` 一致。
- 新增 `apps/admin/package.json` 的 `test` 脚本。
- 测试文件必须能被 `tsc -p tsconfig.app.json --noEmit`、`eslint .` 和 `prettier --check .` 检查通过，不新增例外配置。

### R2. 根目录测试入口

- 根目录 `package.json` 的 `test` 从 `pnpm --filter=@starter/api test` 改为 `turbo run test`。
- 改动后 `pnpm test` 同时执行 API 与 Admin 测试。
- `turbo.json` 已有 `test` task，不需要修改。

### R3. 权限逻辑测试

覆盖 `apps/admin/src/app/authorization/permissions.ts` 的 `hasPermission`：

- permissions 为 `undefined` 时返回 false。
- permissions 为空数组时返回 false。
- 命中和未命中的精确 key。

### R4. 导航过滤测试

`buildNavigationItems` 没有导出，测试通过公开入口 `buildNavigationMenuItems(permissions, t?)` 进行，它内部使用真实的 `adminRouteRecords`。断言基于当前真实 route 记录：

- `permissions` 为 `undefined` 时，`/settings/authorization`、`/settings/users`、`/files` 都不出现。
- 只持有 `authorization:read` 时，`settings` 分组出现且包含授权与用户管理，`files` 分组不出现。
- 只持有 `file:list` 时，`files` 分组出现，`settings` 分组不出现。
- `menu: false` 的记录（登录页、错误页）在任何权限下都不出现。
- 分组顺序按 `navigationGroups` 的 `order` 排列。

不为导航测试导出新的内部函数，也不改动 `navigation.ts`。

### R4b. TabBar 过滤测试

`TabBar` 的过滤逻辑内联在组件内，依赖 `useTabBarStore`、`useNavigate`、`useRouter` 和 Antd `Dropdown`。测试方式：

- `vi.mock` 掉 `@tanstack/react-router` 的 `useNavigate` 与 `useRouter`。
- 使用真实的 `useTabBarStore`，在每个用例前重置并写入固定 tabs。
- 断言无权限时带 permission 的 tab 不渲染，有权限时渲染。

如果 mock 成本超出预期（例如 Antd `Dropdown` 在 jsdom 下报错无法绕过），把 R4b 降级为已知缺口写入 `implement.md`，不改动 `TabBar.tsx` 来迁就测试。

### R5. Route guard 测试

覆盖 `requireAdminRoutePermission` 三个分支：

- 权限满足时正常返回，不抛出。
- 权限不满足时抛出跳 `/403` 的 redirect。
- `fetchQuery` 抛 401 错误时抛出跳 `/login` 的 redirect。
- `fetchQuery` 抛其他错误时原样抛出，不转成 redirect。

### R6. 组件与 query 行为测试

- `PermissionGuard` 在 loading、query 失败、无权限时渲染 fallback；有权限时渲染 children。
- `usePermission` 在 pending、error、success 三种状态下返回正确的 allowed/isLoading/isError 组合。
- 两个 mutation 成功后，current、users、roles 三组 query key 都被失效。

## Out of Scope

- 不改动任何 `apps/admin/src` 下的产品代码。发现的问题只记录，不在本任务修复。
- 不引入 E2E 或浏览器测试（Playwright、Cypress）。
- 不测试 Antd 组件内部行为、样式和布局。
- 不给 `apps/web` 增加测试。
- 不修改 `apps/api` 的测试配置。
- 不增加覆盖率门禁。

## Acceptance Criteria

- [x] `pnpm --filter @starter/admin test` 全部通过（32 例）。
- [x] 根目录 `pnpm test` 同时执行 API 与 Admin 测试，全部通过（API 17 例，Admin 32 例）。
- [x] R3 到 R6 的每一项都有对应测试用例，且断言的是当前真实行为。R4b 未降级，TabBar 已覆盖。
- [x] `apps/admin/src` 下的产品代码没有被修改（`git diff --stat apps/admin/src` 为空，只新增 `src/test/`）。
- [x] `pnpm check-types`、`pnpm lint`、`pnpm format:check` 通过。
- [x] `pnpm build` 通过，构建产物里没有测试文件。Admin 的 chunk 输出在 `dist/js`，不是 `dist/assets`，实际校验的是整个 `dist`。
- [x] 新增依赖全部通过 `catalog:` 引用，`pnpm-workspace.yaml` 同步更新。

## 实现后的实际偏差

三处与原计划不同，均已写入 `implement.md` 对应步骤：

- R4 的「无权限时 `settings` 分组不出现」与真实行为不符。个人资料页没有 permission 要求，所以 `settings` 分组会保留，只是不含受保护项。测试断言真实行为。
- R5 的 redirect 断言目标从顶层 `to` 改为 `options.to`。TanStack Router 的 `redirect()` 返回 `Response` 实例。
- R4b 的 DOM 能力补齐从「本文件局部 stub」改为统一放 `src/test/setup.ts`。`matchMedia` 在导航测试阶段已经需要，局部 stub 会重复。
- R1 写的「解析 `@admin/` 与 `@starter/contracts` 别名」只实现了 `@admin`。`tsconfig.app.json` 的 `paths` 本来就只有 `@admin/*`，`@starter/contracts` 是 workspace 依赖，走 node_modules 解析，不需要别名，与 `vite.config.ts` 一致。
