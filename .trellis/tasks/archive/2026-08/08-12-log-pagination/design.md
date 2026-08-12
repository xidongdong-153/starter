# 日志功能改用分页器方案 — 技术设计

## 目标契约变更

### contracts（`packages/contracts/src/index.ts`）

```ts
export interface SystemLogsQuery {
  requestId?: string
  level?: SystemLogLevel
  query?: string
  page?: number      // 默认 1，普通列表模式使用
  pageSize?: number  // 默认 20，最大 100，普通列表模式使用
  limit?: number     // 默认 100，最大 500，requestId 链路模式使用
}

export interface SystemLogsResponse {
  items: SystemLogEntry[]
  total: number      // 匹配总数；链路模式为截断前总数
}
```

`before` 移除。该接口仅 Admin 一个消费者，前后端同步修改，不做向后兼容。

## API 侧

### `apps/api/src/modules/system/system.openapi.ts`

`systemLogsQuerySchema` 改为：

```ts
z.object({
  requestId: z.string().trim().min(1).max(128).optional(),
  level: systemLogLevelSchema.optional(),
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})
```

`systemLogsResponseSchema` 增加 `total: z.number().int().min(0)`。

### `apps/api/src/modules/system/system.service.ts`

`SystemLogsQuery` 接口同步 contracts；`queryLogs` 改为：

1. 全量扫描所有匹配行（不再"收集满 limit 即停"），按文件从新到旧、行从后往前，得到倒序数组 `matches`。
2. `requestId` 模式：`matches.reverse()` 正序，`total = matches.length`，`items = matches.slice(0, limit)`。
3. 普通模式：`total = matches.length`，`items = matches.slice((page - 1) * pageSize, page * pageSize)`。
4. 返回 `{ items, total }`。

扫描顺序本身就是倒序（最新在前），无需额外排序。`matches` 中的 `before` 过滤逻辑删除。

### `apps/api/src/modules/system/system.route.ts`

handler 直接透传 `c.req.valid("query")`，仅响应结构随 service 变更。无其他改动。

### `apps/api/src/test/system-logs.smoke.test.ts`

- 倒序断言补充 `total`（现有 7 条有效行 → total 7）。
- `before=3000` 用例删除，替换为 `page`/`pageSize` 用例：
  - `?page=2&pageSize=3` → items 为第 4-6 条（time 3000/2000/1000），total 7。
  - `?page=3&pageSize=3` → items 为第 7 条（time 500），total 7。
  - `?pageSize=2` → items 2 条，total 7。
- `limit=2` 用例改为链路模式截断：`?requestId=req-1&limit=1` → 1 条且 total 2。
- 其他用例（权限、level/query 过滤、requestId 正序、无 LOGS_DIR）保持并补 total 断言。

## Admin 侧

### `apps/admin/src/api/system/logs.api.ts`

参数从 `before` 改为 `page`/`pageSize`，保留 `requestId`/`level`/`query`/`limit`（链路用）。

### `apps/admin/src/api/system/logs.query.ts`

- `LOGS_PAGE_SIZE` 改为 `LOGS_DEFAULT_PAGE_SIZE = 20`。
- `useSystemLogsQuery` 从 `useInfiniteQuery` 改为普通 `useQuery`：

```ts
export function useSystemLogsQuery(filters: SystemLogsQuery) {
  return useQuery({
    queryKey: systemLogsQueryKeys.page(filters),
    queryFn: () => getSystemLogs(filters),
  })
}
```

- `systemLogsQueryKeys.page` 保持（filters 现含 page/pageSize）。
- `useSystemLogsByRequestIdQuery` 不变（limit 500）。

### `apps/admin/src/features/system/pages/LogViewer.tsx`

- 新增 state：`page`、`pageSize`（默认 20）。
- `items = logsQuery.data?.items ?? []`，`total = logsQuery.data?.total ?? 0`。
- 筛选提交 / 清除时重置 `page = 1`（保留 pageSize）。
- Table 使用分页器（与 AuthorizationAudit 一致）：

```tsx
pagination={{
  current: page,
  pageSize,
  total,
  showSizeChanger: true,
  pageSizeOptions: [10, 20, 50, 100],
  onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize) },
}}
```

- 删除底部"加载更多"按钮块。
- 摘要 `systemLogs.summary.loaded`（已加载 N）改为 `systemLogs.summary.total`（共 N 条，值取 total）。
- 链路抽屉逻辑不变。

### i18n（`apps/admin/src/i18n/locales/zh.ts` / `en.ts`）

- 新增 `systemLogs.summary.total`（zh: '共', en: 'Total'，与 audit.summary.total 同风格）。
- 删除 `systemLogs.loading`、`systemLogs.loadMore`。

### `apps/admin/src/test/system-logs.test.tsx`

- queryKeys 测试参数改为 `page/pageSize`。
- `useSystemLogsQuery` 测试改为普通 useQuery：断言请求 `{ page: 1, pageSize: 20 }`，`hasNextPage` 相关断言删除。
- 页面测试：mock 返回 `{ items, total }`；断言初始请求参数、筛选提交回第一页、分页器 onChange 触发 `{ page: 2, pageSize: 20 }` 新请求。

## 兼容性与性能

- `before` 参数移除：无外部消费者（Admin 是唯一调用方），同步修改，不保留兼容分支。
- 性能：每次请求全量扫描日志文件（方案 A，已确认），无缓存。当前日志文件无保留策略，量大后可演进为上限扫描（方案 B），本次不做。
- requestId 链路模式语义不变：正序、limit 截断（默认 100，Admin 传 500），total 为截断前匹配数。

## 文档同步

`.trellis/spec/api/backend/logging-guidelines.md` 第 43-48 行更新接口说明：`page`/`pageSize`/`limit`、`before` 移除、响应含 `total`。
