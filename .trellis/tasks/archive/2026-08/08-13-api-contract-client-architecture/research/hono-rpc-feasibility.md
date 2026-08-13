# Hono RPC 可行性研究

## 结论

Hono RPC 对本项目的普通 JSON 接口可行。`@hono/zod-openapi` 1.5.1 的 `OpenAPIHono.openapi()` 会同时把 route 的 path、method、输入 schema 和响应状态/格式写入 Hono schema；`hono/client` 的 `hc<AppType>()` 可据此推导动态 path、query、JSON body、响应状态码和 JSON 返回值。

当前仓库的 `AppType` 还不能直接作为完整客户端契约使用，有两个原因：

1. 大多数模块 route 工厂把 `OpenAPIHono` 保存到 `const app` 后调用 `app.openapi(...)`，再 `return app`。TypeScript 返回的是调用前的 `OpenAPIHono<..., {}>`，后续注册的 schema 不会回写到变量类型。`system.route.ts` 使用链式 `.openapi()`，所以它的路由类型被保留；`routes/index.ts` 再通过 `.route()` 组合时，只能看到 System 的 schema。
2. `apps/api/src/openapi/responses.ts` 的 `apiSuccessSchema(dataSchema: ZodType, ...)` 和 `apiSuccessResponse(dataSchema: ZodType, ...)` 把具体 schema 擦成了宽泛 `ZodType`。当前生成声明中的 System 成功响应因此只有 `data: JSONValue`，没有 `serviceInfoSchema`、`healthSchema` 或 `systemLogsResponseSchema` 的具体结构。

因此建议：先修复各模块 route 工厂的返回类型保留方式和成功响应 helper 的泛型，再让 Web/Admin 的普通 JSON adapter 使用 `hc<AppType>()`。Better Auth catch-all、文件上传、文件下载和头像内容继续使用专用客户端。

## 当前代码证据

- `apps/api/src/rpc.ts:1` 已导出 `ApiRpcType` 为 `AppType`。
- `apps/api/src/routes/index.ts:12-19` 使用 `new OpenAPIHono<HonoEnv>().route("/", ...)` 组合六个模块；`apps/api/src/routes/index.ts:26` 使用 `ReturnType<typeof createRoutes>` 作为 `ApiRpcType`。
- `apps/api/src/modules/system/system.route.ts:71-88` 链式返回 `new OpenAPIHono().openapi(...)`。生成声明中的 `createSystemRoute` 含 `/`、`/health` 和 `/api/system/logs` schema。
- `apps/api/src/modules/auth/auth.route.ts:50-92`、`apps/api/src/modules/profile/profile.route.ts:137-204`、`apps/api/src/modules/files/files.route.ts:139-241`、`apps/api/src/modules/users/users.route.ts:102-162`、`apps/api/src/modules/authorization/authorization.route.ts:323-544` 都是 `const app = new OpenAPIHono()`，多次调用 `app.openapi()`，最后 `return app`。
- 对应的源码声明探针 `/tmp/hono-rpc-probe/source-probe.ts` 编译时只看到 `client.api.system.logs`，访问 `client.api.profile`、`client.api.files`、`client.api.auth`、`client.api.profiles` 均报属性不存在。
- API 类型检查 `pnpm --filter @starter/api check-types` 当前通过，说明现有检查不会发现 route schema 丢失或成功响应退化为 `JSONValue`。
- `pnpm --filter @starter/api build` 当前通过，并生成 `apps/api/dist/rpc.d.ts`。本次构建后该入口引用 `rpc-BEF89cjH.d.ts`，其中仍只有 System 路由，且成功响应的 `data` 为 `JSONValue`。`dist` 中其他 hashed 声明文件是未清理的旧产物，不是当前 package export 的证据。
- 当前 `rpc-BEF89cjH.d.ts` 还导入 `pino`、`better-sqlite3`、`drizzle-orm/better-sqlite3`、`better-auth` 和 `zod`。这不会自动进入浏览器运行时代码，但会扩大 Web/Admin 类型检查需要解析的声明图。

## 已安装版本与官方文档

本地依赖：

- `hono@4.13.0`
- `@hono/zod-openapi@1.5.1`
- `@hono/zod-validator@0.8.0`

本地官方包文档为 `apps/api/node_modules/@hono/zod-openapi/README.md`，相关证据：

- README 的 `RPC Mode` 小节（约 380 行）明确示例：先用 `app.openapi(route, handler)`，再用 `hc<typeof appRoutes>(...)`。
- README 的 Type utilities 小节（约 480 行）说明 `get()`、`post()`、`use()` 等方法会返回 `Hono` 类型；需要恢复 OpenAPIHono 类型时可使用 `$()` 或 `HonoToOpenAPIHono`。
- README 的 Limitations 小节（约 572 行）说明 OpenAPIHono 只能合并直接挂载的子 OpenAPIHono；普通 Hono 不会保留 OpenAPI schema。当前仓库直接挂载子 `OpenAPIHono`，方向正确，但子应用自身必须先保留 schema 类型。
- README 的路径参数说明要求父 `.route()` 使用 Hono 的 `:param` 语法，不要在挂载路径中使用 OpenAPI 的 `{param}` 语法。当前父挂载路径是 `/`，没有触发该限制。

类型源码证据：

- `apps/api/node_modules/@hono/zod-openapi/dist/index.d.mts:215-231`：`openapi()` 返回 `OpenAPIHono<E, S & ToSchema<...>>`，即注册一次就扩展 schema。
- `apps/api/node_modules/@hono/zod-openapi/dist/index.d.mts:31-39`：JSON 和 form body 从 route content schema 分别推导到 `c.req.valid("json")` / `c.req.valid("form")` 和客户端输入。
- `apps/api/node_modules/@hono/zod-openapi/dist/index.d.mts:43-47`：path、query、header 和 cookie 输入都从 request schema 的 `z.input` 推导。
- `apps/api/node_modules/@hono/zod-openapi/dist/index.d.mts:62-76`：响应 content schema 和状态码生成 typed response；OpenAPI `{id}` path 会转换为 Hono 客户端使用的 `:id`。
- `apps/api/node_modules/hono/dist/types/client/client.d.ts:4`：`hc<T>()` 接受 Hono app 类型。
- `apps/api/node_modules/hono/dist/types/client/types.d.ts:56-104`：客户端方法按 `$get`、`$post` 等生成，并把 endpoint 输入映射为 `param`、`query`、`header`、`json`、`form`；响应按状态码和格式映射为 `ClientResponse`。
- `apps/api/node_modules/hono/dist/client/client.js`：运行时会把 `param` 替换到 URL，把 `query` 序列化，把 `header` 合并到 Headers，把 `json` 序列化并设置 `Content-Type`，把 `form` 转成 `FormData`。

## 最小探针结果

探针文件只放在 `/tmp/hono-rpc-probe/`，没有进入仓库：

- `/tmp/hono-rpc-probe/minimal.ts` + `tsconfig.minimal.json`：通过 `tsc`。验证了动态 path `/items/{id}` 在客户端使用 `client.items[":id"].$get({ param, query })`；JSON body 使用 `{ json }`；multipart 使用 `{ form }`；201 与 404 响应类型可用 `InferResponseType<..., status>` 获取；普通 `app.get()` 原始响应可以调用 `$get()`，但只得到宽泛原始 Response 类型。
- `/tmp/hono-rpc-probe/route-return.ts` + `tsconfig.route-return.json`：通过 `tsc`。链式返回的 route 能被 `hc` 发现；`const app` 后单独调用 `app.openapi()` 再返回的版本没有把 route 类型暴露给客户端。该结果直接复现了当前仓库的模块问题。
- `/tmp/hono-rpc-probe/any-form.ts` + `tsconfig.any-form.json`：通过 `tsc`，包括把字符串和数字传给 `form.file`。当前 `uploadFileSchema = z.object({ file: z.any() })` 因而不能给客户端提供 File 字段约束。它仍可由 Hono RPC 运行时序列化成 FormData，但不应当作为普通 JSON RPC 处理。
- `/tmp/hono-rpc-probe/source-probe.ts` + `tsconfig.source.json`：预期失败，错误集中在当前 API `AppType` 缺少 `profile`、`files`、`auth` 等路径；另外该独立配置直接纳入 API 全源码时会暴露当前 Node 26/DOM 类型下已有的 `Uint8Array` BodyInit 错误，这些错误与本次 RPC 研究无关。
- `/tmp/hono-rpc-probe/probe.ts`：使用当前 `dist/rpc.d.ts`，预期失败，原因同样是入口只含 System 路由，而不是 `hc` API 不支持这些路径。

最小探针直接使用具体响应 schema，所以能得到具体 DTO；当前项目 helper 擦除泛型后只能得到 `JSONValue`。这两项结果不矛盾，前者证明 Hono 能力，后者定位项目封装造成的类型损失。

## 接口分类结论

| 接口类别 | `hc<AppType>()` 可行性 | 编译期类型来源 | API 运行时校验/客户端处理 |
| --- | --- | --- | --- |
| 普通 JSON 成功/失败接口 | 可行，前提是 route schema 和响应 helper 泛型未丢失 | API `createRoute` + `app.openapi` 的 request/response schema；客户端从 `AppType` 推导 | API 继续在 path/query/header/body 上由 OpenAPIHono/Zod 校验；客户端生产环境只消费 `Response`，不重复 Zod parse |
| 动态 path | 可行 | `createRoute` 的 OpenAPI `{userId}` 由 Hono 类型转换为客户端 `:userId`，输入字段来自 `request.params` | API 继续校验 param schema；adapter 只把参数传给 RPC |
| query | 可行，但输入类型必须与 schema 的 input 形态一致 | `request.query` 的 Zod input 类型；`z.coerce` 可能让客户端看到 `unknown`，当前用户管理/日志查询已出现这一点 | API 继续把 URL query 解析并校验；客户端 adapter 不负责强转 query |
| header | 可行 | `request.headers` 的 Zod input 类型 | API 继续校验 header schema；客户端通过 `{ header }` 传值或由 adapter options 统一设置 Cookie 外的通用 header |
| JSON body | 可行 | `request.body.content["application/json"].schema` | API 由 OpenAPIHono 校验 `c.req.valid("json")`；客户端通过 `{ json }` 发送 |
| JSON 上传 | 可行，仍属于普通 JSON | JSON body schema | API 继续校验 JSON；adapter 复用普通 RPC 请求 |
| 文件上传 multipart | 可发送，但不建议纳入普通 JSON adapter | `request.body.content["multipart/form-data"].schema` 可推导 `form`；当前 `z.any()` 会弱化 `file` 类型 | API 继续校验 multipart/form；保留专用上传函数，用原始 `File`/`FormData` 和状态码处理，避免普通 JSON envelope 假设 |
| 文件下载/头像内容 | 不适合普通 JSON adapter | 当前 `app.get()` 返回原始 `Response`，客户端得到 `unknown` body/宽泛 status；不能从 route 自动得到文件 MIME/内容类型 | API 继续返回原始文件 `Response`；保留专用下载/头像函数，调用 `blob()`/`arrayBuffer()` 或直接返回原始 Response |
| Better Auth `/api/auth/*` catch-all | 不适合普通 JSON adapter | 当前 `app.on(["GET", "POST"], "/api/auth/*", ...)` 无 request/response schema，声明是 GET/POST + `Response` 宽类型 | Better Auth handler/client 继续负责请求 body、Cookie、重定向和响应；不要用项目普通 envelope parser |
| `/api/me` 等普通 JSON auth 读取接口 | 可行 | `createRoute` 的 JSON response schema；认证 middleware 只影响环境，不改变客户端输入 | API 继续 Cookie session 校验；Web/Admin adapter 发送 credentials 并统一处理 401 |

## 错误状态与响应解析

`createRoute` 的多个 response status 会形成客户端响应联合类型。例如最小探针中 200 和 404 都出现在同一个 `$get()` 的 `ClientResponse` 联合中；`InferResponseType<Fn, 200>` 和 `InferResponseType<Fn, 404>` 可分别提取响应 DTO。

这只提供编译期信息，不会让 `hc` 自动解析项目的 `{ ok, data/error, meta }` envelope，也不会把非 2xx 自动转换成项目的 `ApiRequestError`。Web/Admin adapter 仍应：

1. 传入 `credentials: "include"` 或等效 Cookie 处理，保持当前 session 行为。
2. 读取原始 `Response`，先按 HTTP status 和 `ok` 判断成功/失败。
3. 对普通 JSON 响应调用现有 envelope 处理和错误转换；生产请求不对每个响应再次执行 Zod parse。
4. 只在 contract/smoke tests 中用共享响应 schema 解析代表性 2xx、400、401、403、404 等响应。
5. 对下载、头像和 Better Auth 返回原始 `Response` 的例外，不套普通 JSON envelope 解析。

## 当前问题与实现建议

### 1. 修复模块 route 工厂的 schema 保留

候选方式按侵入性从低到高排列：

- 从已有 `app` 直接返回链式 `.openapi(...)` 结果。需要预先注册 OpenAPI components 的模块可先操作 `app.openAPIRegistry`，再 `return app.openapi(...).openapi(...)`。业务 handler、route/service/repository/presenter 分层不变。
- 把非 OpenAPI `app.get()` / `app.on()` 放到链尾。它们会返回普通 Hono 类型，因此后面不能继续直接调用 `.openapi()`；必须改变顺序时，使用 `@hono/zod-openapi` 的 `$()` 恢复 OpenAPIHono 类型。
- 使用官方 `defineOpenAPIRoute` + `openapiRoutes([... ] as const)` 批量注册。类型清晰，但对现有大量 middleware 和闭包 handler 的改动更大，不建议作为本任务第一步。

不建议直接给 `ApiRpcType` 手工补全路径类型。这会重新产生与真实 route 平行的类型定义，违背 R2/R9。

### 2. 保留响应 helper 的 schema 泛型

`apiSuccessSchema` 和 `apiSuccessResponse` 必须以传入的具体 Zod schema 为泛型，而不是把参数固定为 `ZodType` 后返回宽类型。修复后应检查 `/health`、`/api/system/logs` 和至少一个 profile/users 响应的 `InferResponseType`，确保 `data` 是具体 DTO，不是 `JSONValue` 或 `unknown`。

失败响应当前由固定的 `apiFailureSchema` 生成，能保留 `{ ok: false, error, meta }` 结构；错误 `code` 仍是 `string`。如果设计要求客户端按共享错误码穷举处理，应让该 schema 复用 contracts 的 error code schema，而不是在 adapter 手写联合类型。

### 3. 验证声明构建出口

`apps/api/package.json` 的 `@starter/api/rpc` 在 development 条件导出 `src/rpc.ts`，types/import 导出 `dist/rpc.d.ts` / `dist/rpc.js`。本次本地构建后入口 `dist/rpc.d.ts` 通过 `rpc-BEF89cjH.d.ts` 间接声明，只有 System 路由。验证必须从 package export 或当前 `dist/rpc.d.ts` 开始，不能扫描并误用 `dist` 中未被引用的旧 hashed 文件。

实现阶段应在 API build 后用一个不启动数据库的 consumer probe 导入 `@starter/api/rpc`，编译 `hc<AppType>()` 的代表性 Web/Admin 调用，确保 production declaration 入口和 development source 入口都暴露相同路径和具体响应 DTO。若 tsup declaration bundle 在修复模块返回类型后仍不完整，应调整构建/入口产物，但应以最小改动为准。

### 4. 普通 JSON adapter 边界

Web 和 Admin 各自安装 `hono`，各自导入 `AppType`，在 app 内创建薄 `hc<AppType>()` adapter。领域 API 函数保留在各自 `lib/api/` 或 `src/api/`，页面/组件不直接使用 `hc`。

- Web：adapter 负责 Next.js server/browser base URL、Cookie/credentials 和 `ApiRequestError` 转换。
- Admin：adapter 负责 Vite API base URL、Cookie/credentials、401/403 通知，并保留原始 `Response` 例外。
- contracts 不新增通用 API client package，也不导入 API 业务实现。

### 5. 查询参数的 `z.coerce` 风险

Hono 的客户端输入使用 Zod schema 的 `z.input`。当前 `z.coerce.number()` 会让 RPC 输入看到 `unknown`，这会减弱 query 的编译期约束；API 运行时仍会按 schema 校验和输出 number。实现设计应明确：

- 对客户端需要严格传参的 query，让共享 request schema 表达 URL 输入形态和服务端转换规则；或
- 接受当前 `unknown`，依靠 domain request function 的参数类型和 contract/smoke tests 限制调用方。

不要在 adapter 里对 query 重新定义另一套路径/参数类型。

### 6. 类型检查和客户端 bundle 风险

当前 dts bundle 把 `AppRuntime` 相关的服务端声明一起带入 RPC 类型文件。实现阶段至少记录以下基线和结果：

- API build 后 `apps/api/dist/rpc.d.ts` 及其直接引用声明的字节数。
- Web 与 Admin 在接入前后的 `tsc --extendedDiagnostics` 总耗时、类型实例数和内存占用。
- `pnpm --filter @starter/web build` 与 `pnpm --filter @starter/admin build` 的产物中不包含 `better-sqlite3`、Drizzle、Better Auth server、Pino 或 Nodemailer 代码。

客户端必须使用 `import type { AppType } from "@starter/api/rpc"`；`hc` 的运行时代码来自各 app 的直接 `hono` 依赖。只有类型检查或 bundle 明显退化时，再考虑缩小 RPC 声明入口，不要预先新增通用 client package。

## 验证命令

已运行：

- `python3 ./.trellis/scripts/task.py current --source`：确认当前任务。
- `pnpm --filter @starter/api build`：通过；生成 API 声明并暴露了部分路由和宽泛成功响应问题。
- `pnpm --filter @starter/api check-types`：通过；未发现 route schema 或响应 DTO 类型丢失。
- `/tmp/hono-rpc-probe/minimal.ts` 的 TypeScript 探针：通过。
- `/tmp/hono-rpc-probe/route-return.ts` 的 TypeScript 探针：通过，证明链式返回与 `const app` 返回的差异。
- `/tmp/hono-rpc-probe/any-form.ts` 的 TypeScript 探针：通过，但字符串/数字也被 `z.any()` 接受，证明上传字段当前没有编译期约束。
- `/tmp/hono-rpc-probe/probe.ts`：按预期失败，证明当前 `dist` 的 `AppType` 入口不完整。
- `/tmp/hono-rpc-probe/source-probe.ts`：按预期失败，证明当前源码 `AppType` 也不完整；同时暴露已有的 Node 26 DOM `Uint8Array` 类型错误，未修改。
- `pnpm exec prettier --check .trellis/tasks/08-13-api-contract-client-architecture/research/hono-rpc-feasibility.md`：通过。

## 最终判断

可以采用 Hono RPC，但只把它用于普通 JSON route。先把模块 route factory 的类型注册方式、成功响应 helper 泛型和 `@starter/api/rpc` 生产声明产物修到完整且可验证，再迁移 Web 与 Admin 的普通 JSON 调用。Better Auth catch-all、multipart 文件上传、文件下载和头像内容保留专用客户端；其中上传可以底层使用 `hc` 的 `form` 机制，但不能假设它拥有普通 JSON envelope、完整文件字段类型或统一响应解析能力。
