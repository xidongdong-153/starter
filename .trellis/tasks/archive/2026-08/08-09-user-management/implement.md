# 执行计划

## 1. 共享契约

- [x] 在 `packages/contracts/src/index.ts` 增加用户目录 query schema、列表项、分页响应、资料和详情 DTO。
- [x] 明确日期、可空资料、角色 key 和分页边界的类型。
- [x] 运行 contracts 类型检查，确认 API 与 Admin 可从同一入口导入。

检查点：API response、OpenAPI schema 和 Admin query 参数使用同一字段名；没有复制 DTO。

## 2. API 用户目录模块

- [x] 新建 `apps/api/src/modules/users/` 的 repository、service、route、OpenAPI schema 和导出文件。
- [x] 实现活动角色聚合、姓名/邮箱包含搜索、活动角色筛选、稳定排序、count 和分页。
- [x] 实现用户详情读取，聚合 provider、profile 和头像 URL；profile 缺失时返回空值。
- [x] 复用 `requireAuth` 与 `authorization:read` permission，注册 `/api/users` 两个 GET endpoint。
- [x] 在 `apps/api/src/routes/index.ts` 注册模块。

检查点：无权限请求在 repository 前被拒绝；查询只读且不返回敏感字段。

回滚点：若新模块类型或 OpenAPI middleware 不兼容，先移除新 route 注册，保留 contracts 和未接入的模块文件继续修正。

## 3. API 测试

- [x] 新增 `apps/api/src/test/users.smoke.test.ts`。
- [x] 覆盖未登录 401、无 `authorization:read` 403、admin 成功读取。
- [x] 覆盖默认分页、page/pageSize、姓名搜索、邮箱搜索、角色筛选和稳定排序。
- [x] 覆盖详情成功、profile/provider 聚合、profile 缺失和用户不存在 404。
- [x] 覆盖响应不包含密码、session token、OAuth token 和内部授权关系字段。
- [x] 更新 OpenAPI smoke test，确认新路径和 403 response 已注册。

检查点：每个接口通过真实 Hono request、cookie session 和临时 SQLite 验证。

## 4. Admin API 与路由

- [x] 新建 `apps/admin/src/api/users/` adapter、query hooks 和 index。
- [x] 让 query key 包含所有列表参数；详情 query 只在 Drawer 打开时启用，并保留上一页数据。
- [x] 新建 `apps/admin/src/features/users/routes.tsx`，声明 `/settings/users` 和 `authorization:read`。
- [x] 将 feature route 加入 `apps/admin/src/app/router/records.ts`，设置 settings 菜单顺序和 UsersRound 图标。

检查点：菜单、标签栏、直接 URL 复用现有权限过滤；不新增第二套访问判断。

## 5. Admin 用户目录页面

- [x] 实现搜索提交、角色筛选、清空筛选和受控分页。
- [x] 实现用户表格：姓名/邮箱、角色、邮箱验证、注册时间、详情按钮。
- [x] 实现详情 Drawer：账号基础信息、provider 标签、公开资料、头像链接和 loading/error/404 状态。
- [x] 覆盖列表 loading、失败重试、空数据、详情 loading、详情失败重试和窄屏横向滚动。
- [x] 在 `zh.ts`、`en.ts` 增加用户管理页面、表格、筛选、详情和错误文案。

检查点：页面没有创建、编辑、封禁、会话、密码或删除动作；长邮箱、角色 key 和资料文本不覆盖相邻内容。

## 6. 质量验证

按顺序执行，前一步失败时先修复本任务引入的问题：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

需要单包定位时执行：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
pnpm --filter @starter/admin check-types
```

启动 API 和 Admin 后，手动检查 admin/operator/viewer 的菜单、直达 `/settings/users`、列表筛选、分页、详情 Drawer，以及桌面和移动视口。

## 7. Trellis 检查与提交

- [ ] 运行 `trellis-check`，核对 PRD、设计、跨层字段、权限边界和测试。
- [ ] 必要时运行 `trellis-update-spec`，只记录本任务发现的长期规范。
- [ ] 再次运行 `python3 ./.trellis/scripts/task.py validate user-management`。
- [ ] 提交前确认只包含本任务代码和任务文件，按 Conventional Commit 提交。
- [ ] 归档任务并记录验证结果。

## 风险文件

- `packages/contracts/src/index.ts`：跨层字段变更，先完成类型检查。
- `apps/api/src/modules/users/users.repository.ts`：分页、LIKE 转义和角色 join，优先写测试再调整查询。
- `apps/api/src/modules/users/users.route.ts`：middleware 顺序与 OpenAPI response 类型。
- `apps/admin/src/features/users/pages/UserManagement.tsx`：Table 受控分页、Drawer 状态和响应式文本。
