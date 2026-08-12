# 日志功能改用分页器方案

## Goal

将系统日志查看功能（API + Admin）从"点击加载更多"（游标无限滚动）改为标准页码分页器方案，支持总条数显示、页码跳转、页大小切换。

## Background

- 日志由 pino-roll 按天滚动写入文件（`apps/api/src/infra/log/logger.ts`，`app-YYYY-MM-DD`，无保留天数配置）。
- API 现有接口 `GET /api/system/logs`（`apps/api/src/modules/system/system.service.ts`、`system.route.ts`）：参数 `requestId`、`level`、`query`、`limit`、`before`（time 游标）；从新到旧扫描日志文件行，匹配筛选后收集满 `limit` 即停止；`requestId` 模式按时间正序返回整条链路；响应 `{ items }` 无 `total`。
- Admin 现有实现（`apps/admin/src/features/system/pages/LogViewer.tsx`、`apps/admin/src/api/system/logs.query.ts`、`logs.api.ts`）：`useInfiniteQuery` + 底部"加载更多"按钮，页大小 50，表格 `pagination={false}`；抽屉内按 `requestId` 一次性取 500 条。
- 仓库内已有页码分页参照：AuthorizationAudit 与 UserManagement 均使用 Ant Design Table 分页器（`current`/`pageSize`/`total` + `showSizeChanger`）。
- 接口仅 Admin 一个消费者，前后端同步修改，无外部兼容要求。

## Requirements

- [R1] API：日志列表接口改为页码分页，新增 `page`（默认 1）与 `pageSize`（默认 20，最大 100）参数，响应增加 `total`（全量扫描匹配总数），按页切片返回。
- [R2] API：`requestId` 链路模式保持一次性加载，正序返回，用 `limit`（默认 100，最大 500）截断；响应同样携带 `total`（截断前匹配数）。
- [R3] API：移除 `before` 游标参数。
- [R4] Admin：LogViewer 表格改用 Ant Design Table 分页器，支持页码跳转、页大小切换（10/20/50/100），默认 20；筛选提交或清除时回到第一页（保留页大小）。
- [R5] Admin：移除"加载更多"按钮与 `useInfiniteQuery` 游标逻辑。
- [R6] 摘要栏显示匹配总条数（`total`），替代"已加载 N 条"。
- [R7] 保持现有筛选能力（requestId、level、query）与 requestId 链路抽屉行为。

## Acceptance Criteria

- [AC1] `GET /api/system/logs?page=2&pageSize=3` 返回对应页 items（第 4-6 条，倒序最新在前）且 `total` 为全部匹配数；越界页码返回空 items 且 total 不变。
- [AC2] `GET /api/system/logs?requestId=req-1&limit=1` 返回正序 1 条且 `total` 为链路匹配总数（2）。
- [AC3] `before` 参数不再被解析（传入不报错或按 schema 忽略，不参与过滤）。
- [AC4] Admin 日志页表格底部为分页器；翻页/切换页大小触发带对应 `page`/`pageSize` 的新请求；筛选变化后请求从 `page=1` 开始。
- [AC5] 摘要栏显示总条数；页面无"加载更多"按钮，`systemLogs.loading`/`loadMore` 文案移除。
- [AC6] 链路抽屉点击后仍按 `requestId` 一次性加载展示，行为与现状一致。
- [AC7] API smoke tests 与 Admin 组件测试全部通过；`pnpm check` 通过。
- [AC8] `.trellis/spec/api/backend/logging-guidelines.md` 中日志接口说明同步更新。

## Out of Scope

- 日志扫描性能上限（方案 B：total 封顶）与缓存：本次按方案 A 全量扫描，不做上限。
- 日志保留策略、日志入库（DB 化）。
- 其他页面的分页器改造（AuthorizationAudit、UserManagement 已符合目标形态，不在此任务范围）。

## Notes

- 技术设计见 `design.md`，执行计划见 `implement.md`。
