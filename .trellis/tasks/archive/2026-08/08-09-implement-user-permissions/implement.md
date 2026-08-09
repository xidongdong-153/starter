# 执行计划

## 1. 共享权限契约

- [x] 在 `packages/contracts/src/index.ts` 增加 `PermissionKeys`、`Permission`、输入 schema、授权 DTO 和 `AUTH.FORBIDDEN`。
- [x] 保持权限 key、角色 key、mutation body 和 API response 可序列化，不加入数据库内部字段。
- [x] 先运行 `pnpm --filter @starter/contracts check-types`，确认 API 和 Admin 可以从同一入口导入新类型。

检查点：contracts 编译通过，权限字符串只定义一份。

## 2. 数据库模型与初始数据

- [x] 新建 `apps/api/src/modules/authorization/authorization.schema.ts`，定义四张表、relations、唯一约束、外键和反向索引。
- [x] 在 `apps/api/src/infra/db/schema/index.ts` 注册 authorization schema。
- [x] 生成新 migration，不修改 `0000_broken_komodo.sql`。
- [x] 检查 migration 包含系统角色、权限、角色权限关系和已有用户的 `operator` 回填。
- [x] 运行 `pnpm --filter @starter/api db:check`，并用 API smoke test 的临时 SQLite 执行完整 migration。

检查点：空数据库和已有用户数据库都能得到一致的系统授权数据。

回滚点：若 migration 约束或 seed 不正确，在产品代码依赖新表前删除本次未提交 migration，修正 schema 后重新生成；不改旧 migration。

## 3. 默认角色与管理员 Bootstrap

- [x] 把新用户 profile 创建和默认 `operator` 分配放进同一数据库事务。
- [x] 在 `apps/api/src/shared/env.ts` 和 `apps/api/.env.example` 增加可选 `AUTH_BOOTSTRAP_ADMIN_EMAIL`。
- [x] 新增 bootstrap 脚本，按邮箱查找已存在用户并把角色幂等替换为 `admin`。
- [x] 在 `apps/api/package.json` 增加 `auth:bootstrap-admin` 命令。
- [x] 更新根 `README.md`，写清 migration、注册、配置邮箱和 bootstrap 的执行顺序。
- [x] 为缺少环境变量、用户不存在、migration 未执行和重复执行增加可验证结果。

检查点：普通注册只得到 `operator`；只有显式命令能产生首个 `admin`。

## 4. API 授权模块

- [x] 实现 authorization repository，完成权限判断、当前权限、用户角色、角色目录和两个替换事务。
- [x] 实现 presenter，把查询行聚合为 contracts DTO，并稳定排序角色和权限。
- [x] 实现 service 规则：禁止自改角色、至少保留一个角色、归档项无效、`admin` 权限不可编辑。
- [x] 实现 `createRequirePermission`，只读取 `currentUserId` 和代码 permission 常量。
- [x] 实现 OpenAPI schema 和五个授权 endpoint，补齐 400、401、403、404 response。
- [x] 在 `apps/api/src/routes/index.ts` 注册 authorization route。
- [x] 在 `apps/api/src/openapi/responses.ts` 增加可复用的 forbidden response。

检查点：授权失败为 403 `AUTH.FORBIDDEN`，数据库异常仍由全局处理返回 500。

## 5. 文件模块接入

- [x] 给文件列表、内容、上传、重命名和删除 route 分别挂对应 permission middleware。
- [x] 给 OpenAPI 文件 route 增加 403 response。
- [x] 复查 `files.repository.ts` 和 `files.service.ts` 的 owner 条件没有被 permission 判断替换。
- [x] 运行现有 auth、profile、files smoke tests，先确认默认 `operator` 保持原行为。

检查点：permission 决定动作类型，owner 条件仍决定能否操作具体文件。

## 6. API Smoke Tests

- [x] 新增 authorization smoke test，覆盖当前权限、管理查询和两个 mutation。
- [x] 覆盖无 session 401、viewer 写操作 403、admin 成功、多角色并集和 version 变化。
- [x] 直接归档测试角色或权限，确认下一次请求立即拒绝。
- [x] 覆盖禁止自改角色、禁止修改 `admin` 权限和无效 key。
- [x] 使用两个用户验证文件 owner 隔离。
- [x] 运行 `pnpm --filter @starter/api check-types` 和 `pnpm --filter @starter/api test`。

检查点：所有授权状态都通过真实 Hono request、cookie session 和临时 SQLite 验证。

## 7. Admin 权限基础能力

- [x] 新增 authorization API adapter、query keys、query options 和 mutation hooks。
- [x] 新增 API 401/403 listener；在 `App.tsx` 处理登录跳转和当前权限 query 失效。
- [x] 新增纯 `hasPermission`、`usePermission` 和 `PermissionGuard`。
- [x] 给 `AdminRouteRecord` 增加 permission 元数据，并让带权限的子路由通过 QueryClient 检查访问权。
- [x] 新增实际 `/403` route；权限请求失败继续走 ErrorBoundary，不伪装成无权限。
- [x] 修改导航生成函数，让桌面、移动端菜单和标签栏使用同一权限过滤结果。

检查点：权限未加载或失败时不显示受保护菜单，直接 URL 也不能进入受保护页面。

## 8. 文件 UI 权限接入

- [x] 文件路由要求 `file:list`。
- [x] 用 `PermissionGuard` 分别控制预览/下载、上传、重命名和删除操作。
- [x] 按权限处理首页文件快捷入口和资料页文件入口；缺少文件权限时资料主体仍可使用。
- [x] 验证 403 只刷新权限并显示操作失败，不退出登录。

检查点：viewer 只能查看和读取，operator 保持现有自有文件操作，API 仍负责最终授权。

## 9. 授权管理页面

- [x] 新增 `/settings/authorization` route，要求 `authorization:read`。
- [x] 页面加入用户角色和角色权限两个页签，使用共享 DTO 和现有 Admin 页面组件。
- [x] 用户表支持查看角色；有 `authorization:manage` 时可以选择至少一个角色并保存。
- [x] 角色表支持查看权限；有 `authorization:manage` 时可以编辑 `operator`、`viewer`，`admin` 显示只读状态。
- [x] 查询处理 loading、失败、空数据和重试；mutation pending 禁止重复保存并显示成功/失败反馈。
- [x] 更新中英文 i18n、菜单分组和页面文案；图标按钮补 Tooltip 或 `aria-label`。

检查点：长邮箱、角色 key 和 permission key 在桌面与移动端都不溢出，Modal 或 Drawer 不遮挡主要操作。

## 10. 全量检查与浏览器验证

严格按以下顺序运行，前一步失败时先修复本任务引入的问题：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

- [x] 使用临时 SQLite 执行新增 migration；开发数据库只运行 `db:check`，未直接修改用户本地数据。
- [x] 注册普通账号，运行 `auth:bootstrap-admin` 产生管理员。
- [x] 启动 API 和 Admin 开发服务器。
- [x] 使用浏览器分别验证 admin、operator、viewer 的菜单、直接 URL、文件动作和授权管理 mutation。
- [x] 检查桌面和移动视口的表格、页签、弹窗、长文本和错误状态。
- [x] 结束不再需要的后台进程，不提交 `.env.development`、SQLite 数据库、上传文件或截图临时文件。

## 11. Trellis 完成步骤

- [x] 运行 `trellis-check`，核对 PRD、design、migration、跨层 DTO 和测试范围。
- [x] 使用 `trellis-update-spec` 把 authorization 候选规范改成已实现契约，并补 Admin 权限规范。
- [x] 再次运行任务验证和仓库质量门禁。
- [x] 按仓库 Conventional Commits 规则提交本任务改动。
- [x] 归档任务并记录会话结果。

## 主要风险

- migration seed 与代码权限目录不一致：smoke test 必须比较数据库活动 permission key 和 `PermissionKeys`。
- Hono OpenAPI route 的 middleware 元组类型不兼容：先在一个授权 route 编译验证，再批量接入文件 route。
- Router parent guard 无法识别子 route permission：权限检查放在每个生成的子 route `beforeLoad`，parent 只检查 session。
- 403 刷新造成权限 query 重复请求：listener 只使当前权限 query 失效，不重试原失败 mutation。
- 默认角色变化破坏现有功能：migration 和注册都使用 `operator`，现有 files/profile smoke tests必须先通过。
