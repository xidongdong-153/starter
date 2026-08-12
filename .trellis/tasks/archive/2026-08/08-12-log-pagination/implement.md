# 日志功能改用分页器方案 — 执行计划

## 实现顺序（每步可独立验证）

1. **contracts**（`packages/contracts/src/index.ts`）
   - `SystemLogsQuery`：删除 `before`，新增 `page`/`pageSize`/`limit`（可选）。
   - `SystemLogsResponse`：新增 `total: number`。
   - 验证：`pnpm --filter @starter/contracts check-types`

2. **API service**（`apps/api/src/modules/system/system.service.ts`）
   - `SystemLogsQuery` 类型同步；`queryLogs` 全量扫描 + 切片，返回 `{ items, total }`；删除 `before` 过滤。

3. **API openapi + route**（`system.openapi.ts`、`system.route.ts`）
   - schema 增加 `page`/`pageSize`/`limit`、响应加 `total`；route 透传，无结构改动。

4. **API smoke test**（`apps/api/src/test/system-logs.smoke.test.ts`）
   - 补 total 断言；`before` 用例替换为 `page`/`pageSize` 用例；`limit` 用例改为链路截断。
   - 验证：`pnpm --filter @starter/api test`

5. **Admin query + api**（`logs.query.ts`、`logs.api.ts`）
   - `useSystemLogsQuery` 改普通 useQuery（page/pageSize）；`getSystemLogs` 参数同步。

6. **Admin LogViewer**（`apps/admin/src/features/system/pages/LogViewer.tsx`）
   - 分页器 + page/pageSize state；筛选重置 page；删除加载更多按钮；摘要改 total。

7. **i18n**（`zh.ts`、`en.ts`）
   - 新增 `systemLogs.summary.total`，删除 `loading`/`loadMore`。

8. **Admin 测试**（`apps/admin/src/test/system-logs.test.tsx`）
   - queryKeys / hook / 页面测试同步分页器行为。

9. **spec 文档**（`.trellis/spec/api/backend/logging-guidelines.md`）
   - 更新接口参数与响应说明。

## 验证命令（最后统一跑）

```bash
pnpm check                        # 全仓库类型 + lint + format
pnpm --filter @starter/api test   # API smoke tests
cd apps/admin && pnpm vitest run  # Admin 组件测试（含 system-logs）
```

## 风险与回滚点

- 改动集中在 contracts 类型 + system 模块 + LogViewer，边界清晰；每步 1-5 完成后 API 即可独立验证（smoke test），6-8 完成后 Admin 可验证。
- 无 DB migration、无环境变量变更。
- 回滚：还原本次 commit 即可，`before` 参数不保留兼容分支（已确认无外部消费者）。

## start 前检查

- [ ] prd.md 已收敛（Goal / Requirements / Acceptance Criteria / Out of Scope / 无阻塞问题）
- [ ] design.md 覆盖契约、数据流、兼容性
- [ ] 用户已批准最终规划摘要
