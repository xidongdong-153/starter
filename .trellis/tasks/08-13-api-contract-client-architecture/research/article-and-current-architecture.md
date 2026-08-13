# 文章方案与当前架构证据

## 调研来源

- https://aicompanion.usehook.cn/26-hono-with-nextjs
- https://aicompanion.usehook.cn/6-type-sharing
- 当前仓库源码与 `README.md`

## 文章的主要设计

### Hono 与 Next.js

文章给出两种模式：

- 模式 A：Hono 独立部署，Next.js 通过 Hono RPC 调用，monorepo 共享 schema 与 route 类型。该模式需要显式配置 CORS。
- 模式 B：Hono 作为 Next.js catch-all Route Handler，与 Next.js 一起部署。该模式使用同域相对路径，但 API 与 Next.js 一起发布和扩容。

文章认为多端共用 API、需要独立发布或扩缩容时应选择模式 A；只有一个前端且希望减少部署单元时可以选择模式 B。

### 类型共享

文章建议：

- Zod schema 是请求和响应的运行时真相来源，TypeScript 类型通过 `z.infer` 生成。
- `packages/contracts` 只保存跨端稳定约定，不保存业务实现。
- 成功、失败和元信息使用统一响应结构。
- Hono 导出 `AppType`，前端通过 `hc<AppType>()` 获得路径、method、请求和响应推导。
- 前端不手写与 Hono route 平行的接口类型。

## 当前仓库证据

### 部署与运行时

- `apps/api/src/index.ts` 使用 `@hono/node-server` 启动独立 Node.js 服务。
- `apps/api/src/bootstrap/create-runtime.ts` 创建 SQLite、Drizzle、本地文件存储、Nodemailer 和 Better Auth。
- `apps/web` 是 Next.js；`apps/admin` 是 Vite React SPA。两者都通过独立 API URL 调用服务。
- `apps/api/src/middleware/cors.middleware.ts` 允许配置来源并启用 Cookie credentials。

因此当前架构属于文章模式 A 的 Node.js 版本。把 API 嵌入 Next.js 会让 Admin 仍然面对跨应用调用，同时破坏独立发布边界。

### 已具备的契约与 RPC 能力

- `packages/contracts/src/index.ts` 提供错误码、响应 envelope、部分 Zod 输入 schema 和跨端 DTO。
- `apps/api/src/routes/index.ts` 通过链式 `.route()` 组合模块，并导出 `ApiRpcType`。
- `apps/api/src/rpc.ts` 将 `ApiRpcType` 导出为 `AppType`。
- `apps/api/package.json` 提供 `@starter/api/rpc` 子路径 exports。

RPC 类型出口已经存在，但客户端尚未使用：

- `apps/web/package.json` 和 `apps/admin/package.json` 不依赖 `@starter/api` 或 `hono`。
- Web 使用 `apps/web/lib/http.ts`；Admin 使用 `apps/admin/src/api/http.ts`。
- Admin 的 endpoint 函数手写路径、method 和 `apiRequest<TData>` 返回泛型。
- Web 的通用请求函数返回 `unknown`，部分 endpoint 再写手工 type guard。

### OpenAPI 与模块边界

- `apps/api/src/bootstrap/create-app.ts` 顺序注册 middleware、错误处理、routes 和 OpenAPI 插件。
- 各模块通过 `OpenAPIHono`、`createRoute` 和 `*.openapi.ts` 描述接口。
- `/doc` 输出 OpenAPI JSON，`/reference` 提供 Scalar 页面。
- API 业务遵循 route -> service -> repository，presenter 转换响应 DTO。

这部分比文章的最小 `app.ts` 示例更完整，优化不应退回单文件路由。

### schema 重复风险

以下模式已经出现：

- `userManagementQuerySchema` 同时存在于 `packages/contracts/src/index.ts` 与 `apps/api/src/modules/users/users.openapi.ts`。
- `PublicProfile` 在 contracts 中是 TypeScript 类型，API 在 `profile.openapi.ts` 再定义运行时 Zod schema。
- 多个用户、授权和日志响应 DTO 在 contracts 中使用 interface，在 API OpenAPI 文件中维护另一份 Zod schema。
- Web 又为部分 DTO维护手工 type guard。

当前 contracts 能统一编译期名称，但未完全成为请求、响应和客户端运行时校验的唯一来源。

### 不能统一为普通 JSON RPC 的接口

- `/api/auth/*` 由 Better Auth handler 直接响应，并由 Better Auth 客户端调用。
- 文件上传需要 `FormData` 与 multipart boundary。
- 文件下载和公开头像返回原始文件内容，不返回 JSON envelope。
- 某些 Better Auth 响应不使用项目自定义 envelope。

详细设计需要先分类接口，再选择客户端方式，不能把所有路径强制塞进同一个 JSON helper。

## 初步设计判断

建议保留独立 Node.js Hono API、OpenAPI、模块分层和特殊接口路径。需要用户确认的主要范围是：

1. 只消除 contracts 与 OpenAPI 的 schema 重复；或
2. 同时让 Web/Admin 普通 JSON 接口接入 `hc<AppType>()`；或
3. 进一步重新设计 contracts、RPC、OpenAPI 和客户端生成策略。

不建议在本任务中迁移 Next.js Route Handler、Cloudflare Workers、数据库或文件存储。
