# 优化 API 契约与客户端架构：需求

## 目标

优化 `apps/api`、`apps/web`、`apps/admin` 与 `packages/contracts` 之间的契约和客户端边界，减少接口路径、请求参数、响应 DTO 与运行时 schema 的重复定义，同时保留当前脚手架的独立部署能力和特殊接口行为。

本任务交付范围确认、研究记录和详细设计。规划文件经用户评审并再次明确授权后，才进入实现阶段。

## 背景与当前事实

- `apps/web`、`apps/admin` 和 `apps/api` 是三个独立应用；API 使用 Node.js Hono，不是 Next.js Route Handler。
- API 依赖 `better-sqlite3`、本地文件存储、Nodemailer 和 Node.js 进程生命周期。本任务不迁移这些运行时。
- `packages/contracts` 已共享部分 Zod 请求 schema、TypeScript DTO、错误码和 `{ ok, data/error, meta }` 响应结构。
- API 使用 `OpenAPIHono` 描述接口，并通过 `/doc` 和 `/reference` 提供 OpenAPI 文档。
- API 已从 `@starter/api/rpc` 导出 `AppType`，但 Web 和 Admin 当前通过手写 `fetch` 客户端调用接口。
- 部分请求或响应在 `packages/contracts` 与 `apps/api/src/modules/*.openapi.ts` 中存在平行定义。
- Better Auth 的 `/api/auth/*`、文件上传、文件下载和头像内容不是统一 JSON envelope 的普通接口。

研究确认的约束：

- 多数模块 route factory 先保存 `const app = new OpenAPIHono()`，再单独调用 `.openapi()`，返回类型没有保留后来注册的路由 schema；当前 `AppType` 不能覆盖全部普通 JSON 路由。
- `apiSuccessSchema` 和 `apiSuccessResponse` 的参数类型过宽，部分 RPC 成功响应退化为 `JSONValue`。
- Web/Admin 的 `customConditions: ["development"]` 会通过 package exports 命中 `apps/api/src/rpc.ts`，随后遇到 API 私有的 `@api/*` alias。公共消费路径需要稳定指向 API 声明产物。
- Web/Admin 对 `@starter/api` 的 type-only 依赖必须写入 package manifest，Turbo 才能建立 API 声明生成前置。
- 当前 API 有 28 个普通 JSON RPC 候选接口，其中 26 个已被 Web/Admin 调用；另有 Better Auth、1 个 multipart 上传、2 个二进制接口和 `/doc`、`/reference`。
- 已发现成功响应字段、相对/绝对 URL、审计事件联合、OpenAPI 错误码范围和未声明状态码等漂移，必须先处理契约再迁移客户端。

研究文件：

- `research/article-and-current-architecture.md`
- `research/hono-rpc-feasibility.md`
- `research/rpc-build-boundary.md`
- `research/endpoint-inventory.md`

## 已确认范围

### 必须做

- 普通 JSON 接口的请求和响应 schema 统一到共享 contracts，并从 schema 派生 TypeScript 类型。
- 按 `common`、`auth`、`profile`、`files`、`users`、`authorization`、`system` 拆分 `packages/contracts`；根 `index.ts` 继续重导所有现有公共名称。
- 修复 API route factory 的类型注册方式，使普通 JSON route 完整进入 `AppType`。
- 修复响应 schema helper 的泛型保留，使 RPC 响应携带具体数据结构。
- Web 和 Admin 的普通 JSON 请求使用 Hono RPC 类型约束路径、method、参数和响应。
- Web/Admin 各自在 app 内维护薄 RPC adapter，不新增 `packages/api-client`。
- 保留各 app 内的领域请求函数；页面和组件不直接创建 `hc` client 或拼 API URL。
- API 继续在运行时校验 path、query、header、JSON body 和 form 输入。
- 使用共享响应 schema 在 contract/smoke tests 中解析代表性成功和失败响应。
- 记录 API declaration build、consumer type-check、Turbo 任务图和客户端 bundle 的验证结果。

### 必须保持兼容

- 所有现有 HTTP 路径和 method。
- 所有现有 HTTP 状态码、Cookie/credentials 行为和 `{ ok, data/error, meta }` envelope。
- Better Auth 的响应、重定向、Cookie 和 `/api/auth/*` catch-all。
- multipart 上传的 `FormData` 行为和浏览器 multipart boundary。
- 文件下载和头像内容的原始 `Response`、MIME、长度和缓存/下载 header。
- `/doc`、`/reference` 的开关和现有可访问行为。
- Web、Admin、API 可以分别发布；不要求原子发布。

### 明确不做

- 不把 Hono 嵌入 Next.js Route Handler。
- 不迁移 Node.js、SQLite、本地文件存储、Nodemailer、Better Auth server 或日志实现到 Cloudflare Workers、D1、R2 等运行时。
- 不修改业务功能、页面交互、认证产品规则或权限模型。
- 不发布外部 SDK，不引入 OpenAPI 生成客户端。
- 不把 Better Auth、multipart 上传、文件下载或头像内容改成普通 JSON RPC。
- 不新增通用 API client package。
- 不把数据库 record、service 内部类型、页面 view model、组件 props 或环境变量解析移入 contracts。

## 技术约束与决策

- `packages/contracts` 只依赖 `zod`，不依赖 Hono、OpenAPI、Node 或任何 app。
- API 的 OpenAPI 文件引用 contracts 的共享 schema，并只在 API 层补充 `.openapi()` 名称、标签、描述和 HTTP response 映射；不再复制字段结构。
- `@starter/api/rpc` 是类型消费入口。Web/Admin 只能 `import type { AppType }`，不能做 value import 或 side-effect import。
- Web/Admin 的 `hono` 是各自 adapter 的运行时依赖；adapter 负责 base URL、credentials、JSON envelope 解包、错误转换和各 app 特有副作用。
- Web adapter 兼容 Next.js Server Component、Server-side request 和 Client Component；Admin adapter 保留 401/403 监听、Query cache 清理、路由跳转和原始 `Response` 处理。
- 普通 JSON adapter 不在生产环境对每个响应执行 Zod parse。API 请求入口继续运行时校验；共享 response schema 同时驱动 RPC/OpenAPI 类型，并在测试中解析真实响应。
- 迁移先做 contracts，再修 API RPC 类型和声明边界，最后迁移客户端。每一步都必须保持旧客户端可调用。
- 如果完整 `AppType` 的声明图导致消费端类型检查出现明显回归，先记录基线和 trace，再采用最小的声明入口收窄；不能复制一份手工 route 类型作为替代。

## 子任务

| 子任务 | 依赖 | 交付 |
| --- | --- | --- |
| `08-13-contracts-schema` | 无 | contracts 分域、共享请求/响应 schema、根导出兼容、漂移修正与 schema 测试 |
| `08-13-api-rpc-boundary` | `contracts-schema` 完成并通过检查 | 完整 `AppType`、具体响应推导、exports/声明产物、Turbo 前置和 consumer probe |
| `08-13-client-rpc-migration` | `contracts-schema` 与 `api-rpc-boundary` 完成并通过检查 | Web/Admin 薄 adapter、26 个普通 JSON 调用迁移、例外客户端回归 |

父任务不直接修改产品代码；子任务完成后执行父任务级集成检查。

## 验收条件

- [x] 用户确认的优化范围、兼容边界、运行时校验策略、客户端归属和任务拆分全部写入本 PRD。
- [x] `prd.md` 不包含阻塞设计的开放问题。
- [x] 父任务 `design.md` 明确当前架构、目标架构、依赖方向、接口分类、请求/响应数据流、schema 所有权、错误流、迁移、兼容、性能和回滚。
- [x] `design.md` 的架构和数据流图使用暗色主题 Mermaid，图与文字一致。
- [x] 父任务 `implement.md` 将实现拆成可逐步验证、可回滚的阶段，并引用三个子任务的验收门槛。
- [x] contracts 根入口保持现有公共导入路径；业务域内部文件不成为应用公共依赖。
- [x] 普通 JSON route 的 `AppType` 覆盖 28 个候选接口，且代表性动态 path、query、JSON body、状态码和具体响应 DTO 有编译期 probe。
- [x] Web/Admin 迁移后的普通 JSON 请求不再使用手写 `apiRequest<TData>` 返回泛型来定义 endpoint 响应；页面仍只调用领域请求函数。
- [x] Better Auth、multipart、文件下载、头像内容和 OpenAPI/Scalar 的现有行为保持不变并有回归检查。
- [x] contract/smoke tests 使用共享响应 schema 解析代表性成功和失败真实响应，能发现字段或 envelope 漂移。
- [x] API、Web、Admin 的 type-check、lint、format、相关 tests 和必要 build 全部通过；性能与 bundle 检查有记录。
- [x] 用户评审并明确批准最新规划后，才执行 `task.py start`。

## 规划与验收状态

父任务规划已由用户批准，三个子任务按 `contracts-schema`、`api-rpc-boundary`、`client-rpc-migration` 顺序完成。父任务集成检查通过，验收证据记录在 workspace journal；任务归档时由 `task.py archive` 写入最终 `completed` 状态。
