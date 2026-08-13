# 迁移 Web Admin RPC 客户端：需求

## 目标

在 `apps/web` 和 `apps/admin` 内分别实现薄的 Hono RPC adapter，把现有普通 JSON 请求迁移到 `hc<AppType>()` 类型约束下，同时保留 Better Auth、multipart、文件下载和头像二进制的专用客户端。

领域请求函数和 React Query hooks 的公开调用方式保持不变；页面和组件不直接创建 RPC client，也不拼接 API URL。

## 前置条件

- `08-13-contracts-schema` 已完成并通过检查。
- `08-13-api-rpc-boundary` 已完成，28 个普通 JSON route 的 `AppType`、具体响应类型、exports 和声明构建 probe 全部通过。
- API HTTP 行为已经固定；本子任务不能通过修改服务端来迁移客户端。
- 用户授权并执行 `task.py start` 后进入实现。

## 要求

1. Web 在 `apps/web/lib/` 内维护 app-local RPC adapter，负责 `hc<AppType>()`、API base URL、credentials、JSON envelope 解包、网络错误和现有 `ApiRequestError` 转换。
2. Admin 在 `apps/admin/src/api/` 内维护 app-local RPC adapter，负责 base URL、credentials、JSON envelope 解包、status/code、401/403 listener 和原始 `Response` 边界。
3. 迁移 Web 的两个普通 JSON operation：`GET /api/config/auth`、`GET /api/profiles/{userId}`；`authClient` 和头像 URL 保持原实现。
4. 迁移 Admin 的 25 个普通 JSON operation：health、system logs、auth config、profile、JSON avatar 操作、files JSON 操作、users 和 authorization 全部普通 JSON 调用。去重后两端共 26 个 endpoint operation。
5. 保留 `apps/web/lib/api/`、`apps/admin/src/api/` 中领域请求函数的文件归属和公开函数签名；页面、组件、query hook 不直接 import `hc` 或拼接路径。
6. 删除普通 JSON endpoint 上依赖手写 `apiRequest<TData>` 的响应泛型和重复 DTO；FormData、Blob、图片 URL、Better Auth 仍可使用明确的专用类型和原始 fetch/客户端。
7. 保持请求的 URL、method、path/query/json 参数、headers、credentials、cache/signal、状态码处理和返回 DTO 与迁移前一致。
8. 保持 Admin 的 401 清理 Query cache/跳登录、403 权限提示、409 冲突提示及现有错误 code 分支；保持 Web 的网络错误、无效 envelope、404 和公开资料行为。
9. 对特殊接口做回归：Better Auth session/sign-in/sign-out、multipart boundary、文件下载 Blob、头像内容 MIME/缓存行为和 OpenAPI 文档访问。
10. 每个迁移域完成后再删除旧 helper 中无调用方的普通 JSON 分支；若 helper 仍服务特殊接口，保留清晰的 raw/special transport。
11. 用静态检查确认 API 类型入口只作 `import type`，页面没有直接 `hc`，且新旧 endpoint 没有重复的手写 URL。

## 兼容边界

必须保持：

- 所有 path、method、状态码、Cookie/credentials 和 JSON envelope。
- Better Auth 的非 envelope 响应、Cookie、重定向和错误处理。
- multipart 的浏览器 boundary、文件大小/类型错误处理。
- 文件下载和头像的原始 Response、MIME、长度、缓存/下载 header。
- Web Server Component 与 Client Component 的现有调用环境；Admin React Query key、mutation、路由和权限 guard。
- Web/Admin 可以分别发布；旧端在迁移期间仍能调用 API。

## 不做的事

- 不修改 API route、service、repository、数据库和认证/权限规则。
- 不新增共享 `packages/api-client`。
- 不把特殊接口强行套普通 JSON RPC adapter。
- 不改变页面 UI、交互、路由、缓存 key 或业务功能。
- 不让页面或组件直接拥有 API transport 细节。

## 验收条件

- [x] Web 和 Admin 各有一个薄 RPC adapter，运行时 `hc` 来自本应用的 `hono` 依赖，`AppType` 只 type-only 引用。
- [x] 去重后的 26 个普通 JSON operation 已经由领域函数通过 typed RPC 调用；没有普通 JSON 请求继续使用手写 `apiRequest<TData>` 来定义响应结构。
- [x] 页面、组件和 React Query hook 的公开调用边界不变，未出现页面直接 `hc` 或手写 API URL。
- [x] Web 的网络错误、无效 envelope、公开资料 404/头像 URL 行为不变；Admin 的 401、403、404、409 状态与全局副作用不变。
- [x] Better Auth、multipart 上传、文件下载、头像二进制和 OpenAPI/Scalar 回归检查通过。
- [x] Web/Admin type-check、Lint、Format、相关测试和 build 通过；API smoke tests 仍通过。
- [x] 静态搜索确认没有 API RPC value import、API runtime import 或因迁移产生的重复 endpoint 路径。
- [x] 子任务可以在前两个子任务的产物上独立复现检查结果，并记录按域迁移和回滚点。

## 检查命令

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

## 回滚点

按应用或业务域恢复原领域请求函数到旧 HTTP helper；保留 API/contracts 的兼容改动。特殊接口不随普通 JSON 回滚而改变。只有在全部回归通过后，才删除没有特殊用途的旧普通 JSON helper 分支。
