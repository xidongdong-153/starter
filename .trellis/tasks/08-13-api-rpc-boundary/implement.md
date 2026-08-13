# 实现计划：API RPC 类型与构建边界

## 阶段 0：基线和最小探针

1. 确认 contracts 子任务已通过检查，读取最新 schema 和 API OpenAPI 文件。
2. 清理或隔离旧 API `dist` 产物影响，记录 `rpc.d.ts` 入口大小和直接引用声明。
3. 用临时 TypeScript probe 访问当前 `AppType` 的 system、profile、files、users、authorization、auth 路径，记录遗漏和宽泛 `data`。
4. 记录 Web/Admin/API 的 `extendedDiagnostics` 和 Turbo dry graph。

```bash
pnpm --filter @starter/api build
pnpm --filter @starter/api check-types
pnpm turbo run build --dry=json
pnpm turbo run check-types --dry=json
pnpm --filter @starter/web exec tsc --noEmit --extendedDiagnostics
pnpm --filter @starter/admin exec tsc -p tsconfig.app.json --noEmit --extendedDiagnostics
```

临时 probe 放 `/tmp` 或测试专用目录，不把未评审的探针混入公共运行时。

## 阶段 1：修复 route factory 类型

按模块逐个处理：

1. `apps/api/src/modules/auth/auth.route.ts`：保留 auth config 和 current session 的 OpenAPI route；Better Auth catch-all 留在专用 handler。
2. `profile.route.ts`：保留五个普通 JSON route，头像二进制保持 raw `app.get`。
3. `files.route.ts`：保留列表、上传 schema、重命名、删除的行为，文件内容保持 raw `app.get`。
4. `users.route.ts`：保留三个 JSON route。
5. `authorization.route.ts`：保留全部授权 JSON route 和 middleware。
6. `system.route.ts`：作为链式写法基准，不做无关改动。
7. `routes/index.ts`：继续通过真实 `.route()` 合并，不手写 `AppType`。

每个模块改完立即运行 API type-check，并检查 handler 的 `c.req.valid()` 类型没有退化。

回滚点：按模块恢复旧 `const app` 注册写法；此阶段不改客户端。

## 阶段 2：修复 response helper 泛型

1. 调整 `apps/api/src/openapi/responses.ts` 的 success schema/response 泛型签名。
2. 让 response schema 的具体 `data` 类型进入 OpenAPI route 的 Hono schema。
3. 让 failure schema 复用 contracts error code schema，保持 details 和 envelope 形状。
4. 用 `InferResponseType` probe 验证 `/health`、`/api/profiles/:userId`、`/api/users`、`PATCH /api/profile` 和 401/404 联合。

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api build
```

如果泛型改动影响 `c.json()` status 推导，只修 response helper 的类型签名或局部 route 类型，不修改 handler 返回的 HTTP 状态。

## 阶段 3：exports、依赖和声明前置

1. 调整 `apps/api/package.json` 的 `./rpc` exports，使公共 consumer 不命中 source development 分支，并验证 API 自己的 dev 条件仍可运行。
2. 在 `apps/web/package.json`、`apps/admin/package.json` 声明 `@starter/api: workspace:*`；两端需要 `hono/client` 时显式声明 `hono`。
3. 调整 Turbo 配置或 package scripts，表达 API RPC declaration/build 在 Web/Admin `check-types` 和 build 前执行。先改最小范围，再用 `--dry=json` 检查依赖图。
4. 不把 `@starter/api` 加入 Web `transpilePackages`，不复制 `@api/*` paths。

验证：

```bash
pnpm install --lockfile-only
pnpm turbo run build --dry=json
pnpm turbo run check-types --dry=json
pnpm --filter @starter/api build
```

若指定的 Turbo 任务表达方式在当前版本不能形成可观察的前置，停在该失败点，记录错误并回到设计文件；不要靠串行 shell 命令掩盖任务图缺失。

## 阶段 4：consumer 和边界探针

1. 用 `tsc --traceResolution` 验证 Web/Admin 的 `@starter/api/rpc` 命中 `dist/rpc.d.ts`，trace 无 `apps/api/src`、`@api/*`。
2. 用 `hc<AppType>()` 编译 28 个候选 operation：动态 params、query、JSON body、多状态响应和具体 data 字段均有断言。
3. 运行 API 生产声明入口和 development/API 内部入口的独立 probe；两者若不能分别工作，先修 exports，不迁移客户端。
4. 对 `import type` 与 API value import 做静态搜索。
5. 删除/隔离旧 dist 后运行 clean declaration build，确认 consumer check-types 仍能按 task graph 工作。

## 阶段 5：完整检查与交接

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
pnpm --filter @starter/api build
pnpm turbo run build --dry=json
pnpm turbo run check-types --dry=json
pnpm --filter @starter/web check-types
pnpm --filter @starter/admin check-types
```

检查 `/doc`、`/reference`、Better Auth、multipart、文件下载和头像二进制的原有测试。把 declaration 图和 diagnostics 记录到子任务结果，不启动客户端子任务，直到父任务确认交接。
