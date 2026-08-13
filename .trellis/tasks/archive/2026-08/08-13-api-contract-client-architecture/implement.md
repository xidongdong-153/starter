# 实现计划：API 契约与客户端架构

## 前置门槛

- 当前父任务保持 `planning`，三个子任务均保持 `planning`。
- 用户必须先评审并明确批准父任务最新 `prd.md`、`design.md` 和本文件；批准后再启动第一个子任务。
- 子任务必须按依赖顺序执行：`contracts-schema` -> `api-rpc-boundary` -> `client-rpc-migration`。
- 每个子任务在启动前补齐自己的 `implement.md`、必要 `design.md` 和 context manifest；每个子任务完成后先检查再进入下一项。
- 任何 HTTP 行为、数据库、认证规则或文件协议变化都暂停并回到规划阶段。

## 阶段 0：记录基线

目标：在改代码前保存可比较的类型、构建和产物基线。

步骤：

1. 记录当前 API、Web、Admin 的 check-types、build 时间和 `tsc --extendedDiagnostics`。
2. 记录 `apps/api/dist/rpc.d.ts` 的大小、直接引用声明文件和当前可见的 route 数量。
3. 运行 `pnpm turbo run build --dry=json` 和 `pnpm turbo run check-types --dry=json` 保存任务图。
4. 用临时 consumer probe 验证当前缺失 route 和宽泛响应，作为修复证明。
5. 确认工作区没有产品代码改动；只允许新增 Trellis 规划文件。

验证：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api build
pnpm --filter @starter/web check-types
pnpm --filter @starter/admin check-types
pnpm turbo run build --dry=json
pnpm turbo run check-types --dry=json
```

回滚点：无代码修改；删除临时 `/tmp` 探针即可。

## 阶段 1：`08-13-contracts-schema`

依赖：无。

目标：让 contracts 成为普通 JSON 请求/响应 schema 的唯一共享来源，同时保持根导出兼容。

实现清单：

1. 将 `packages/contracts/src/index.ts` 按 `common.ts`、`auth.ts`、`profile.ts`、`files.ts`、`users.ts`、`authorization.ts`、`system.ts` 拆分。
2. 在 `common.ts` 放 response envelope、meta、错误码 schema、builder 和通用基础 schema；各领域文件只放对应跨端协议。
3. 从 schema 生成请求和响应类型，移除重复 interface；保留现有公共名称和根入口导出。
4. 将 API 各模块 OpenAPI 文件改为引用 contracts schema，只保留 OpenAPI 名称、描述、tag 和 response status 映射。
5. 修复研究中列出的字段漂移：用户状态 `from`、审计状态事件、相对头像 URL、错误码 schema、query schema 重复和实际状态码声明。
6. 为响应 envelope 和代表性领域响应添加 schema parse 测试或扩展 API smoke helper；测试必须使用真实 `app.request()` JSON，不只使用 TypeScript cast。
7. 更新 Web/Admin 中依赖平行 interface 或手写 type guard 的位置；只保留确有边界价值的输入防御，不重复定义 DTO。
8. 保留 Better Auth、FormData File 字段和二进制响应的专用 schema/客户端边界。

完成门槛：

- contracts 根入口的现有 import 全部继续通过。
- contracts 自身 check-types、lint、format、build 通过。
- API route/OpenAPI schema 编译通过，现有 API smoke tests 通过。
- 至少一个成功和一个失败真实响应由共享 schema parse 通过。
- 没有把 Hono、Node 或 API runtime 依赖加入 contracts。

建议命令：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
```

回滚点：恢复 contracts 文件拆分和 API OpenAPI 引用，根导出保持旧版本；不改数据库 migration。

## 阶段 2：`08-13-api-rpc-boundary`

依赖：阶段 1 完成并通过门槛。

目标：让真实普通 JSON route 完整进入 `AppType`，保留具体响应类型，并让消费端稳定使用声明产物。

实现清单：

1. 修复 `auth`、`profile`、`files`、`users`、`authorization` 等 route factory 的 schema 保留方式。优先使用链式 `.openapi()`；需要普通 Hono 方法时按 Hono 官方方式使用 `$()` 恢复类型。
2. 保留 Better Auth catch-all 和文件/头像原始响应的运行时行为；不要为了 RPC 类型把二进制接口伪装成 JSON schema。
3. 泛型化 `apiSuccessSchema`、`apiSuccessResponse` 和必要的 failure helper，确保 `data` 保留具体 Zod schema 类型。
4. 让 `apps/api/src/routes/index.ts` 的直接 OpenAPIHono `.route()` 合并产生完整 `ApiRpcType`，不手写平行 route interface。
5. 调整 `apps/api/package.json` 的 `./rpc` exports，使 Web/Admin 公共消费不命中 API source；保留 API 自身开发流程所需的最小入口。
6. 在 Web/Admin package manifest 中声明 `@starter/api: workspace:*`（type-only）和 `hono`（adapter runtime），但不把 API 加入 Next `transpilePackages`。
7. 调整 Turbo task graph 或声明生成 task，使 API RPC declaration 在 Web/Admin check-types/build 前生成；先用 dry graph 确认实际依赖。
8. 写 consumer probes，覆盖 development/source 条件和 production/dist 声明条件；trace 不得出现消费端解析 API source 或 `@api/*` alias。
9. 写 `AppType` 完整性 probe，覆盖 28 个普通 JSON 候选接口，至少检查动态 path、query、JSON body、多个状态码和具体响应字段。
10. 记录 API declaration 图大小、Web/Admin `extendedDiagnostics` 和构建 bundle，确认没有 Node-only API runtime 进入前端。

完成门槛：

- `AppType` probe 覆盖 28 个普通 JSON route；失败即阻塞客户端迁移。
- `InferResponseType` 的代表性 data 不为 `JSONValue`/`unknown`。
- API build、check-types、lint、format、test 通过。
- Web/Admin 的 consumer type-check 能在 clean declaration build 后通过。
- Turbo dry graph 显示 API declaration 前置；无 `@api/*` source 解析。
- `/doc`、`/reference` 和 API smoke 行为不变。

建议命令：

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

回滚点：恢复 route factory 写法、response helper 和 exports；旧 Web/Admin fetch 不依赖完整 AppType，HTTP 服务仍可运行。

## 阶段 3：`08-13-client-rpc-migration`

依赖：阶段 1、阶段 2 完成并通过门槛。

目标：逐域迁移 Web/Admin 普通 JSON 请求到 app-local typed RPC adapter，同时保持例外接口。

实现清单：

1. Web 增加薄 RPC adapter，封装 `hc<AppType>()`、base URL、credentials、JSON envelope 解包、`ApiRequestError` 和 cache/signal 传递。
2. Admin 增加薄 RPC adapter，封装 `hc<AppType>()`、base URL、credentials、JSON envelope 解包、错误 status/code、401/403 listener 和原始 Response 边界。
3. 迁移 Web：`GET /api/config/auth`、`GET /api/profiles/{userId}`；保留 Better Auth client 和头像 URL。
4. 迁移 Admin system/auth/profile：health、auth config、logs、profile、JSON avatar 操作；保留 Better Auth client。
5. 迁移 Admin files：列表、重命名、删除；保留 FormData 上传和原始下载。
6. 迁移 Admin users：列表、详情、状态修改。
7. 迁移 Admin authorization：权限、用户、角色、影响查询、审计事件。
8. 保留领域请求函数和 React Query hooks 的公开 API；页面/组件不直接 import `hc`。
9. 删除普通 JSON endpoint 上的手写 `apiRequest<TData>` 响应泛型和重复 DTO；保留 FormData/原始 Response 所需的显式类型。
10. 逐域运行 API smoke、Admin tests、Web type/build；对 401、403、404、409、上传、下载和头像做回归。
11. 全部迁移通过后再删除无调用方的旧普通 JSON helper 分支；如果旧 helper 仍服务特殊接口，保留并重命名为清晰的 raw/special transport。
12. 用静态搜索阻止 `@starter/api/rpc` value import、页面直接 `hc`、新 endpoint 手写 URL 和 API runtime import。

完成门槛：

- 26 个已有前端普通 JSON endpoint 已使用 typed RPC adapter。
- Web/Admin 普通 JSON endpoint 不再靠手写 response generic 提供类型。
- Better Auth、FormData、文件下载和头像内容的现有行为通过测试。
- Admin 401 清 Query cache/跳登录、403 和 409 冲突处理不变。
- Web Server Component 公开资料读取和错误/404 行为不变。
- Web/Admin check-types、lint、format、相关 tests 和 build 通过。

建议命令：

```bash
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

回滚点：按 app 或领域恢复旧请求函数；不回滚 API schema、HTTP route 或数据库。

## 阶段 4：父任务集成检查

依赖：三个子任务均完成并各自归档前的检查通过。

1. 检查根导出、package exports、Turbo graph、consumer probes 和 static import rules。
2. 运行仓库级检查，严格按类型、Lint、Format 顺序执行；前一项失败先修复再进入下一项。
3. 运行完整 API smoke、Admin Vitest 和必要的 Web build。
4. 读取 `/doc` 并检查普通 JSON route、错误状态、tags、security scheme；运行代表性真实响应 schema parse。
5. 对特殊接口执行回归：Better Auth 登录/注册/session、multipart 上传、文件下载、头像、Scalar。
6. 检查 `git diff` 只包含本任务范围；不提交、不推送，等待用户明确提交授权。
7. 更新相关 `.trellis/spec/`，仅记录本次确认的新长期规则：RPC declaration export 不能命中 API source、contracts 根导出兼容、特殊接口分类和 response schema test 边界。

最终命令顺序：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

若仓库级命令因缓存或环境失败，记录原始错误并停在失败点；不要私自改用另一种实现。

## 阶段 5：完成门槛

- 子任务实现和检查结果写回各自任务文件。
- 父任务 PRD、design、implement 与研究文件全部保留。
- 规划文件不再有未解决的用户决策。
- 用户明确批准最新设计后才启动实现；实现完成后先运行 `trellis-check`，再更新 spec。
- 未获提交授权前不执行 `git commit`、`git push` 或 merge。
