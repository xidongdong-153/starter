# 修复 API RPC 类型与构建边界：需求

## 目标

让 API 的 28 个普通 JSON 路由完整进入 `AppType`，让 Hono RPC 推导出真实的 path、method、参数和具体响应类型，并为 Web/Admin 建立稳定的 API 声明产物和构建前置。

本子任务建立类型边界，不迁移客户端调用。旧的 Web/Admin 手写 fetch 在本子任务完成后必须仍能调用同一 API。

## 前置条件

- `08-13-contracts-schema` 已完成并通过其 PRD 中的所有检查。
- 父任务规划经用户批准后，本子任务执行 `task.py start` 进入实现。
- 本子任务不修改 HTTP 合同、业务逻辑、认证/权限规则、数据库或文件响应。
- `client-rpc-migration` 只有在本子任务的 consumer probe、构建边界和回归检查全部通过后才能开始。

## 要求

1. 修复各普通 JSON route factory 的类型保留方式，使独立模块注册的 `.openapi()` schema 出现在返回值中，并经 `apps/api/src/routes/index.ts` 的 `.route()` 合并进入 `ApiRpcType`。
2. 覆盖 auth、profile、files、users、authorization、system 及根路由的 28 个普通 JSON 候选接口；不手写一份与真实 route 平行的 `AppType`。
3. 泛型化 API 成功响应 schema/helper，使 `data` 保留传入 Zod schema 的具体结构；失败响应保留共享 error code、状态和 envelope 类型。
4. 保留 Better Auth catch-all、multipart、文件下载和头像二进制的现有路由和运行时行为；不为获得 RPC 类型而虚构 JSON response schema。
5. 调整 `@starter/api/rpc` package export 和声明构建边界，使 Web/Admin 的公共 type-only 引用稳定解析到 API `dist` 声明，不命中 API source 或其私有 `@api/*` alias。
6. 在 Web/Admin manifest 中声明实际的 type-only API workspace 依赖；adapter 使用的 `hono` 由各自应用显式声明。不得把 API runtime 加入前端 bundle。
7. 让 Turbo 任务图明确表达 API RPC 声明生成先于 Web/Admin 的类型检查和构建；clean checkout 删除 API `dist` 后仍能按项目命令生成所需产物。
8. 编写临时或受控的 consumer probe，验证 development/production 条件、动态 path、query、JSON body、多状态响应和具体 data 字段；probe 不得靠复制 `@api/*` paths 通过。
9. 记录 API declaration 图大小、Web/Admin TypeScript diagnostics 和构建产物，若类型图或检查耗时显著增加，先定位并记录处理，不改变公共 HTTP 合同。

## 兼容边界

必须保持：

- API 所有现有 path、method、状态码、Cookie、credentials、JSON envelope 和 OpenAPI 文档访问方式。
- Better Auth 的 Cookie、重定向和非 envelope 响应。
- multipart boundary、文件 MIME/长度/缓存/下载 header 和头像原始 Response。
- API 可以独立构建和部署；旧客户端不要求等待 Web/Admin 同时发布。

`AppType` 是编译期视图，不是新的运行时协议。生产 API 不因本子任务增加逐响应 Zod parse。

## 不做的事

- 不在本子任务迁移任何 Web/Admin 领域请求函数。
- 不新增 `packages/api-client` 或 OpenAPI 生成客户端。
- 不把 API 嵌入 Next.js，也不迁移到 Workers/D1/R2。
- 不复制 API 私有 `@api/*` TypeScript paths 到 Web/Admin。
- 不调整数据库、Better Auth 配置、权限规则、页面和业务返回值。

## 验收条件

- [x] `AppType` probe 能访问并约束 28 个普通 JSON route，包含动态 path、query、JSON body 和至少一个多状态响应。
- [x] 代表性 `InferResponseType` 的 `data` 保留具体 schema 字段，不退化为 `JSONValue`、`unknown` 或手写 DTO。
- [x] `apps/api` type-check、Lint、Format、测试和 build 全部通过。
- [x] Web/Admin 在 API 声明产物生成后能通过 type-check；删除 `apps/api/dist` 后，Turbo/项目命令能先生成声明再检查。
- [x] `--traceResolution` 或等效 probe 证明 Web/Admin 未解析 `apps/api/src` 和 `@api/*`；源码中只允许 `import type` 的 API 类型引用。
- [x] Turbo dry graph 显示 API declaration/build 是 Web/Admin 检查和构建的前置，且没有重复或隐式依赖。
- [x] `/doc`、`/reference`、API smoke tests 和 Better Auth/文件特殊接口回归通过，HTTP 响应行为不变。
- [x] 记录类型检查性能与 declaration 直接引用；没有未经评审的声明入口或 runtime 依赖扩散。

## 检查命令

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

## 回滚点

恢复 route factory 返回写法、response helper 类型和 `./rpc` exports 即可；API 的 HTTP route 仍可独立运行，Web/Admin 尚未迁移时继续使用旧 fetch。若只有某个消费端构建回归，只撤回该端的 type-only 依赖或声明消费配置，不回滚 API 行为。
