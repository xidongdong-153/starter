# API 后端目录结构

## 基础设施与装配

- `bootstrap/`：`createRuntime` 和 `createApp`，只负责依赖装配和应用注册。
- `infra/db/`：better-sqlite3 client、Drizzle schema 和 migrations。
- `infra/log/`：Pino logger 和子 logger。
- `infra/storage/`：`StorageDriver` 接口与 `LocalStorage` 文件实现。
- `middleware/`：request context、secure headers、CORS、body limit、timing、timeout、request log。
- `openapi/`：API 文档、通用响应 schema 和文档 UI。
- `shared/`：`AppError`、env parser、Hono context 类型、request meta、response 和 validator。

## 业务模块

`modules/<domain>/` 内聚一个领域的 route、service、repository、schema、presenter 和 OpenAPI 描述。当前模块是 `auth`、`system`、`profile` 和 `files`。

```text
apps/api/src/modules/profile/
├── profile.openapi.ts
├── profile.presenter.ts
├── profile.repository.ts
├── profile.route.ts
├── profile.schema.ts
└── profile.service.ts
```

复杂业务模块可以在一级模块目录内按业务子域分目录。子目录使用单数业务名称，文件使用 `<subdomain>.<layer>.ts`；每个有数据访问的子域继续按 `route -> service -> repository` 组织，需要 DTO 转换时保留同子域 presenter。不要建立跨子域的 `services/`、`repositories/` 或 `presenters/` 横向目录。一级模块根路由负责共享依赖装配，并用显式链式 `.route()` 组合子路由；子路由不自行创建 runtime。模块公共 schema 可以留在根目录，避免跨子域 relations 引入循环依赖。

AI 模块采用以下子域目录：

```text
apps/api/src/modules/ai/
├── ai.route.ts
├── ai.schema.ts
├── agent/
├── configuration/
├── conversation/
├── prompt/
├── skill/
├── tool/
└── usage-audit/
```

`routes/index.ts` 仍只挂载 `createAiRoute(runtime)`。AI 根路由显式组合 agent、configuration、usage-audit、conversation、prompt 和 skill 子路由；tool 目录只放工具注册、编排和测试工具。

业务模块通过 `routes/index.ts` 注册，不要在 `create-app.ts` 里直接写业务 handler。`profile` 和 `files` 的 route 在创建 service 时注入 runtime 依赖，便于测试替换数据库和文件目录。

## 导入和边界

API 使用 `@api/*` 路径别名，并在 NodeNext 下保留 `.js` 扩展名。共享请求/响应类型从 `@starter/contracts` 导入。repository 不直接返回给 HTTP 层，presenter 负责把数据库的 `Date`、JSON 字符串和存储路径转换为 DTO。

## 测试目录

`src/test/` 只放 Vitest smoke tests 和共享 helper。测试通过 `createTestApp` 构造独立 runtime，不读取开发数据库。
