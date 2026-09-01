# 产品模块规范（chat / flow 薄代理）

## 1. Scope / Trigger

以下改动先读本规范：

- 新建或修改 `apps/api/src/modules/chat/`、`apps/api/src/modules/flow/`，或新增其他产品模块（`/api/<product>/*` 挂 AI 运行时）。
- 修改 `apps/api/src/routes/index.ts` 的路由挂载或 `createAiServices` 调用点。
- 修改 `apps/api/src/rpc/chat.ts`、`src/rpc/flow.ts`，或为新产品模块导出 RPC 类型。
- 修改 `apps/api/package.json` 的 `exports` 或 tsup 构建入口。

`modules/ai` 是产品无关的中立运行时；产品模块是它的消费方，依赖只能单向：产品模块 import `modules/ai`，反向禁止（`grep -rn "modules/chat\|modules/flow" apps/api/src/modules/ai/` 必须无输出）。

## 2. Signatures

服务层入口（`modules/ai/ai.services.ts`）：

```ts
export function createAiServices(runtime: AppRuntime): AiServices;
// AiServices 字段：applicationService、webhookService、usageAuditService、
// configurationService、promptService、skillService、agentDefinitionService、
// sessionService、runService、completionService、attachmentService、
// toolRegistry、invocationRunner
```

产品模块入口（以 chat 为例）：

```ts
// modules/chat/chat.route.ts
export function createChatRoute(runtime: AppRuntime, services: AiServices);
// modules/chat/index.ts 只导出 createChatRoute
```

RPC 类型（`src/rpc/<product>.ts`）：

```ts
type ChatSchema =
  ReturnType<typeof createChatRoute> extends OpenAPIHono<infer _Env, infer S> ? S : never;
export type ChatAppType = OpenAPIHono<Env, ChatSchema>;
```

配套两处缺一不可：`apps/api/package.json` 的 `exports` 加 `"./rpc/chat"`；`build` 脚本的 tsup 入口加 `src/rpc/chat.ts`。

## 3. Contracts

### 装配

`routes/index.ts` 里 `createAiServices(runtime)` 只调用一次，结果传给 `createAiRoute`、`createChatRoute`、`createFlowRoute`。webhook dispatcher 启动、session 一致性检查、run 恢复扫描三个副作用在 `createAiServices` 内部触发，恰好一次。

产品路由挂载必须做类型断言，不并入主 `ApiRpcType`：

```ts
.route("/", createChatRoute(runtime, aiServices) as unknown as Hono<HonoEnv>)
```

原因：`ApiRpcType` 的 OpenAPI schema 链已接近 TS 声明序列化上限（约 1e6 字符）。chat + flow 并入后 `pnpm --filter @starter/api build` 的 dts 报 TS7056，web 的 `hc<AppType>` 推断退化为 unknown。运行时行为和 OpenAPI 文档不受断言影响（文档由 `app.doc()` 运行时遍历生成）。

### 端点定义

- 鉴权一律 `createRequireAuth(runtime.auth)`（starter_user cookie），不用 `requireRuntimePrincipal`（那是 /api/ai 对 product_app + Bearer 的路径）。
- 请求 schema（query、param、json、form）直接复用 `@starter/contracts` 的现有 schema，产品侧不新造。
- 响应 data 用 `genericSuccessResponse`（`@api/openapi/responses`，data 为 unknown）：同一 service 产出，与对应 `/api/ai/*` 端点同构；复制完整响应 schema 会放大类型体积（见上面的 TS7056）。
- handler 与 ai 侧对齐：`toRuntimeAccessContext(c.var.principal, c.var.resourceScope)` 构造上下文，`createSuccessResponse(data, c.var.requestId)` 包装，状态码一致。
- SSE 端点用 `writeRunEventStream(c, events)`（`modules/ai/run/run-sse.ts`），不要自己写心跳和去重。
- 暴露哪些端点由产品需要决定，映射表见 `.trellis/tasks/08-31-ai-service-layer-split/design.md`（chat 13 个、flow 7 个）。新增端点先确认对应 AI service 方法存在。

### middleware

产品面新增附件类端点时，同步两处：`body-limit.middleware.ts` 加 POST 限额分支、`secure-headers.middleware.ts` 加 content 端点跨域 embed 白名单，规则与 `/api/ai` 版本一致。

## 4. Validation & Error Matrix

| 条件                       | 行为                                                     |
| -------------------------- | -------------------------------------------------------- |
| 未带 starter_user cookie   | 401，走统一 error envelope                                |
| 请求参数不符合 contracts   | 400 `COMMON.INVALID_REQUEST`，与 ai 侧 zValidator 一致    |
| session / run / 附件不存在 | 与 ai 侧同 code：404 `AI_*_NOT_FOUND` 等                  |
| run 启动 Accept 分流       | 显式 `application/json` 且不含 `text/event-stream` 走 JSON 响应，否则 SSE；与 `run.route.ts` 逐行一致 |

## 5. Good/Base/Bad Cases

- Good：产品 handler 直接调 `services.sessionService.xxx(access(c), ...)`，响应结构由 service 决定，产品层零判断逻辑。
- Base：新产品模块照抄 chat 的目录结构（`xxx.openapi.ts` + `xxx.route.ts` + `index.ts`），不建 service/repository/presenter。
- Bad：产品 handler 里自建 DTO、复制 ai 侧响应 schema、或调 `fetch('/api/ai/...')` 自调 HTTP。

## 6. Tests Required

`apps/api/src/test/product-modules.smoke.test.ts`，每个产品面至少覆盖：

- `GET /api/<product>/agents` 与 `GET /api/ai/agents` 的 `data` 用 `toEqual` 断言同构。
- session 创建 → transcript 读取全链路（flow 加 `?lane=` 断言）。
- 未登录 401。

现有 `/api/ai` 测试不允许改断言语义；`rpc-type.probe.ts` 零改动是「产品路由不入 AppType」的守护断言。

## 7. Wrong vs Correct

### Wrong：链式调用以普通 `.get()` 结尾

```ts
return new OpenAPIHono<HonoEnv>()
  .openapi(...)
  .get("/api/chat/attachments/:id/content", handler); // 返回类型降级成 HonoBase
```

`rpc/chat.ts` 的 `extends OpenAPIHono<infer _Env, infer S>` 提取失败，`ChatSchema = never`，web 的 `hc<ChatAppType>` 整个塌成 `unknown`，而且没有任何报错指向真正的源头。

### Correct：非 OpenAPI 路由用语句式注册

```ts
const app = new OpenAPIHono<HonoEnv>()
  .openapi(...)
  .openapi(...); // 链尾保持 openapi()，app 类型仍是 OpenAPIHono

app.get("/api/chat/attachments/:id/content", handler); // 丢弃返回值
return app;
```

### Wrong：新产品路由直接 `.route()` 进主链

```ts
return new OpenAPIHono<HonoEnv>()
  .route("/", createAiRoute(runtime, aiServices))
  .route("/", createNewProductRoute(runtime, aiServices)); // ApiRpcType 超限
```

### Correct：断言挂载 + 独立 RPC 类型

```ts
.route("/", createNewProductRoute(runtime, aiServices) as unknown as Hono<HonoEnv>)
// 新建 src/rpc/<new-product>.ts 导出 XxxAppType，package.json exports + tsup 入口同步
```
