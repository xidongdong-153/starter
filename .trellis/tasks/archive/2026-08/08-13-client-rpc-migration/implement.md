# 实现计划：Web/Admin 薄 RPC adapter

## 前置检查

1. 确认 `contracts-schema` 和 `api-rpc-boundary` 已完成并通过各自检查。
2. 读取 Web/Admin 的现有 HTTP helper、领域 API、Query hooks、auth client、文件函数和错误 listener。
3. 建立 26 个普通 JSON operation 的迁移表，记录旧 URL/method/body/headers/返回值和新 RPC method。
4. 先运行两端类型检查和 API smoke，保存基线。

## 阶段 1：Web adapter 和最小迁移

目标文件范围：

- `apps/web/lib/http.ts` 或同目录新增 RPC transport。
- `apps/web/lib/api/auth-config.api.ts`。
- `apps/web/lib/api/profile.api.ts`。
- 必要时 `apps/web/package.json` 与锁文件已由 API 子任务处理的依赖。

步骤：

1. type-only 导入 `AppType`，从 Web 的 `hono` 导入 `hc`。
2. 保留 `resolveApiUrl`、credentials、cache/signal 和现有 `ApiRequestError` 文案/状态。
3. 用 RPC method 迁移 auth config 和 public profile 的动态 path。
4. 保留现有公开函数、运行时 envelope/error 检查和头像 URL 行为。
5. 用静态搜索确认 page/component 没有直接创建 client。

检查：

```bash
pnpm --filter @starter/web check-types
pnpm --filter @starter/web lint
pnpm --filter @starter/web format:check
pnpm --filter @starter/web build
```

回滚点：只恢复两个 Web 领域函数到旧 `apiRequest`；保留 API/contracts 改动。

## 阶段 2：Admin adapter 和基础领域

目标文件范围：

- `apps/admin/src/api/http.ts` 或新增同目录 adapter。
- `apps/admin/src/api/system/health.api.ts`、`system/logs.api.ts`。
- `apps/admin/src/api/auth/auth-config.api.ts`。
- `apps/admin/src/api/profile/profile.api.ts`。

步骤：

1. type-only 导入 `AppType`，从 Admin 的 `hono` 依赖导入 `hc`。
2. 将普通 JSON 的 envelope 解包和错误转换接入现有 401/403 listener。
3. 迁移 health、logs、auth config、profile 和 JSON avatar set/clear。
4. 保留 `fetchApi` 的原始 Response 能力，暂不迁移 Better Auth、上传和下载。
5. 对 query 输入按 `AppType` 的 URL input 传递，不在 adapter 另写 query schema。

检查：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test
```

## 阶段 3：Files、Users、Authorization

按顺序每组完成后检查：

1. Files：list/rename/delete 用 RPC；`uploadFile` 保持 FormData；`downloadFileBlob` 保持 raw Response。
2. Users：list/detail/status 使用动态 param、query 和 JSON body；保留状态返回的 `from` 字段。
3. Authorization：permissions、users、roles、role lifecycle、impact、audit 全部使用 RPC；保留 query 默认值、409 和权限错误分支。
4. 删除这些普通 JSON 函数中的手写 `apiRequest<TData>` response generic，使用 RPC 推导或 contracts 返回类型。

每组检查：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin test
pnpm --filter @starter/api test
```

任一组失败时，只回滚该组领域函数，不进入下一组。

## 阶段 4：请求和特殊接口回归

对迁移前后的代表性调用比较：

- URL/path 参数编码。
- method、query 序列化、JSON body。
- `accept`、`content-type`、credentials、cache/signal。
- 2xx data 解包和 400/401/403/404/409 错误 status/code。

特殊接口回归：

1. Better Auth session、sign-in、sign-out、password flow 使用原 auth client。
2. multipart 上传不手设 boundary，成功返回 FileItem，失败状态和 listener 不变。
3. 文件下载继续返回 Blob/原始 Response，检查 MIME、长度和下载 header。
4. 头像 URL 仍直接加载二进制，检查缓存和 404。
5. `/doc`、`/reference` 仍可访问且文档开关行为不变。

## 阶段 5：静态与完整检查

```bash
rg -n "from ['\"]@starter/api/rpc['\"]|import\(['\"]@starter/api/rpc|hc\(" apps/web apps/admin
rg -n "apiRequest<" apps/web/lib/api apps/admin/src/api
rg -n "(/api/|/health)" apps/web/lib/api apps/admin/src/api
pnpm --filter @starter/web check-types
pnpm --filter @starter/web lint
pnpm --filter @starter/web format:check
pnpm --filter @starter/web build
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test
pnpm --filter @starter/admin build
pnpm --filter @starter/api test
```

静态搜索结果需要人工区分允许的 raw/special transport 和普通 JSON endpoint；不能只凭搜索数量宣称完成。

## 阶段 6：交接

1. 确认 26 个 operation 全部列入迁移表并通过调用/类型检查。
2. 确认旧 helper 仍被特殊接口需要时没有被误删。
3. 记录按 Web/Admin/领域的回滚点、测试结果和未覆盖的外部 OAuth 行为。
4. 将 adapter 只属于 app、页面不得直接创建 `hc`、特殊接口保持专用 transport 的规则交给父任务集成检查。
