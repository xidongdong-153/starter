# API 对前端的类型安全

HTTP 边界的共享类型来自 `@starter/contracts`。输入使用 Zod schema，例如 `updateProfileSchema`、`setAvatarSchema` 和 `renameFileSchema`；输出使用 `AccountProfile`、`PublicProfile`、`FileItem` 与 `ApiSuccess/ApiFailure`。

OpenAPI route 的 request schema、contracts schema 和 presenter DTO 必须表达同一组字段。API 内部的 Drizzle `ProfileRecord`、`FileRecord` 不应导出到客户端。

新增 API error code 时在 `ApiErrorCodes` 中增加字面量，再让服务端 `AppError`、OpenAPI failure response、Admin/Web parser 和测试使用同一个 code；不要让客户端根据中文 message 判断业务分支。

## Hono RPC 客户端边界

### 1. 适用范围

普通 JSON route 同时生成 OpenAPI 和 Hono `AppType`。Web/Admin 通过各自的 RPC adapter 调用这些 route；Better Auth、multipart、文件下载、头像和文档路由不走普通 JSON adapter。

新增普通 JSON route、修改请求或响应 schema、调整 `@starter/api/rpc` exports、修改 Web/Admin 请求函数时，都要检查本节。

### 2. 签名

API 类型入口：

```ts
export type AppType = OpenAPIHono<Env, ApiSchema>
```

客户端只能 type-only 引用 API：

```ts
import type { AppType } from '@starter/api/rpc'
import { hc } from 'hono/client'

const apiRpc = hc<AppType>(apiBaseUrl, {
  init: { credentials: 'include' },
  headers: { accept: 'application/json' },
})
```

`apps/api/package.json` 的 `./rpc` 公共入口指向构建产物：

```json
{
  "types": "./dist/rpc.d.ts",
  "import": "./dist/rpc.js"
}
```

Web/Admin 的 `package.json` 必须声明 `@starter/api: workspace:*` 和运行时 `hono`。Turbo 的 `check-types` 和 `build` 必须先执行依赖包 build，确保 `dist/rpc.d.ts` 已生成。

### 3. 契约

普通 JSON route：

- request schema 来自 `@starter/contracts`，由 OpenAPIHono 在 path、query、JSON body 边界运行时校验。
- success body 是 `{ ok: true, data, meta }`。
- failure body 是 `{ ok: false, error: { code, message, details? }, meta }`。
- Web/Admin adapter 发送 `credentials: 'include'`，解包 success data，并把网络错误、非 2xx、failure envelope、无效 JSON 和无效 envelope 转为各自的 `ApiRequestError`。
- Admin 的 `ApiRequestError` 保留 `status` 和 `code`；401/403 继续通知 access-error listener。
- 生产客户端不对每个 data DTO 运行 Zod parse。Web 已有的公开数据 guard 可以保留；真实 response schema parse 放在 API contract/smoke tests。

特殊 route：

| 接口 | 客户端边界 |
| --- | --- |
| `/api/auth/*` | Better Auth client，保留 Cookie、重定向和非 envelope 响应 |
| `POST /api/files` | 专用 `FormData` 请求，不手写 multipart `Content-Type` |
| 文件 content | 原始 `Response` / `Blob`，保留 MIME、长度和下载 header |
| 公开头像 | 原始图片 URL/Response，保留 MIME、长度和 `Cache-Control` |
| `/doc`、`/reference` | 文档直接访问，不进入业务 adapter |

`packages/contracts/src/index.ts` 继续重导所有领域文件。应用从 `@starter/contracts` 根入口导入，不依赖 `src/auth.ts` 等内部路径。

### 4. 校验与错误

| 条件 | 预期结果 |
| --- | --- |
| RPC 网络失败 | `ApiRequestError.status === 0` |
| 非 2xx failure envelope | 保留 HTTP status、error message；Admin 同时保留 error code |
| 401/403 | Admin 先通知 access-error listener，再抛出 `ApiRequestError` |
| 2xx failure envelope | 仍抛出 `ApiRequestError`，不能当成 data 返回 |
| 2xx body 缺少 `ok/data/meta` | 抛出“API 返回的数据格式不正确” |
| body 不是 JSON | 抛出“API 没有返回有效的 JSON 数据” |
| path/query/json 输入无效 | API 按共享 schema 返回 400 failure envelope |
| UUID path | 使用 `uuidSchema` 的 UUID v7 约束 |

### 5. 用例

- Good：领域请求函数调用 `apiRpc.api.users[':userId'].$get({ param })`，页面和 query hook 不知道 path。
- Base：`GET /health` 没有输入，adapter 返回具体 `{ ok: true }` data。
- Bad：页面直接 `hc<AppType>()`、拼 `/api/users/${id}` 或写 `apiRequest<UserDetail>(path)`。
- Bad：把 Better Auth、FormData 或文件二进制响应交给普通 envelope parser。
- Bad：在 Web/Admin 配置 API 私有 `@api/*` alias，或让 `@starter/api/rpc` 解析到 `apps/api/src`。

### 6. 必须检查

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm turbo run build --dry=json
pnpm turbo run check-types --dry=json
```

还要断言：

- `apps/api/src/test/rpc-type.probe.ts` 覆盖全部普通 JSON operation、动态 param、query、JSON body、状态码和具体 data 字段。
- TypeScript `--traceResolution` 将 Web/Admin 的 `@starter/api/rpc` 解析到 `apps/api/dist/rpc.d.ts`，没有 `apps/api/src` 或 `@api/*`。
- `contract.smoke.test.ts` 用共享 schema parse 真实 success/failure envelope。
- auth/files/profile/openapi smoke tests覆盖 Better Auth、multipart、文件 MIME/长度/下载 header、头像 MIME/长度/cache header、`/doc` 和 `/reference`。
- Web/Admin 构建产物不包含 `better-sqlite3`、Drizzle SQLite driver、Nodemailer、Pino 或 API route/runtime 实现。

### 7. 错误与正确写法

错误：

```ts
import { AppType } from '@starter/api/rpc'

export function getUser(id: string) {
  return apiRequest<UserDetail>(`/api/users/${id}`)
}
```

这会把类型入口当成运行时依赖，并重新手写 path 和响应类型。

正确：

```ts
import type { AppType } from '@starter/api/rpc'
import { hc } from 'hono/client'

const apiRpc = hc<AppType>(apiBaseUrl)

export function getUser(id: string) {
  return unwrapApiData(
    apiRpc.api.users[':userId'].$get({
      param: { userId: encodeURIComponent(id) },
    }),
  )
}
```
