# 统一 contracts 与响应 schema：需求

## 目标

把普通 JSON 接口共用的请求、响应和错误 schema 收回 `packages/contracts`，按业务域拆分源码文件，同时保留 `@starter/contracts` 根入口的现有公共导出。

本子任务不改变 API 路径、method、状态码、Cookie、响应 envelope、业务结果或数据库结构。完成后，API 可以直接引用共享 schema，Web/Admin 仍能从根入口导入现有 DTO。

## 前置条件

- 启动实现前，父任务 `08-13-api-contract-client-architecture` 处于 `planning`。
- 本子任务不依赖其他子任务。
- `api-rpc-boundary` 只有在本子任务的检查全部通过后才能开始。
- 用户授权实现并执行 `task.py start` 后才修改 `apps/` 或 `packages/` 产品代码。

## 要求

1. 将 `packages/contracts/src/index.ts` 拆分为 `common.ts`、`auth.ts`、`profile.ts`、`files.ts`、`users.ts`、`authorization.ts`、`system.ts` 和根入口 `index.ts`。
2. `common.ts` 统一维护 `ok/data/error/meta` envelope、错误码 schema、通用 UUID/日期/成功响应 schema 和 builder；领域文件只维护对应的跨端可序列化请求与响应协议。
3. 每个共享 DTO 的 TypeScript 类型从对应 Zod schema 派生；现有公共类型名和从 `@starter/contracts` 根入口导入的路径保持可用。
4. API 模块的 OpenAPI 文件引用 contracts schema，不再复制响应字段或请求约束；API 层仍负责 operation 名称、描述、tag、状态码和权限文档。
5. 按当前真实响应修正已经确认的漂移：用户状态响应的 `from` 字段、`user.status_changed` 审计事件、相对头像 URL、错误码联合、用户/日志 query schema 和实际可触发的错误状态声明。不得为了修 schema 改业务结果。
6. 共享 schema 不依赖 Hono、OpenAPI、Node.js、数据库、文件系统、Better Auth server 或前端框架；运行时依赖保持为 `zod`。
7. 增加真实响应契约检查：从 API `app.request()` 获取至少一个成功 envelope 和一个失败 envelope，用共享 schema 解析；测试不能只用 TypeScript cast 或 `readSuccess<T>`。
8. 检查 Web/Admin 的重复 DTO、平行 type guard 和输入类型引用，迁移能直接复用 contracts 的地方；页面 view model、表单转换和 UI 状态仍归应用所有。
9. 明确特殊接口边界：Better Auth、multipart 的 `File` 字段、文件下载和头像二进制不被强行改造成普通 JSON schema；仅共享其中实际跨端需要的 JSON DTO。
10. 保留成功和失败响应中的 `meta`，不把 token、Cookie、数据库行、内部文件路径或 secret 放进共享契约。

## 兼容边界

必须保持：

- `@starter/contracts` 现有根导出名称和 import 路径。
- 所有 API 现有请求/响应字段、默认值、nullable 行为和序列化格式。
- `{ ok: true, data, meta }` 与 `{ ok: false, error, meta }` envelope。
- API 错误 code 的现有字符串值；客户端按 code 分支，不按中文 message 分支。
- Better Auth、FormData、文件 Response 和头像 URL 的客户端边界。

允许的变更仅限于：contracts 文件组织、schema 的唯一来源、OpenAPI schema 引用和测试覆盖。若发现真实行为与文档冲突，优先让共享 schema 描述真实行为，并在测试中固定它。

## 不做的事

- 不修复 Hono route factory 的 `AppType` 注册问题。
- 不调整 API package exports、Turbo 任务图或 API 声明生成。
- 不创建 `packages/api-client`。
- 不迁移 Web/Admin 的 fetch 调用到 `hc`。
- 不修改数据库 migration、认证规则、权限规则、页面交互或业务逻辑。

## 验收条件

- [x] `packages/contracts/src/` 完成按域拆分，`index.ts` 仅作为稳定根入口重导，现有公共 import 全部通过。
- [x] 普通 JSON 请求/响应字段在 contracts 与 API OpenAPI 定义之间只有一个 schema 来源；重复定义已删除或明确属于 API 文档元数据。
- [x] 所有跨端 DTO 的类型由 Zod schema 派生，contracts 不含数据库或 Node-only import。
- [x] 用户状态、审计事件、头像 URL、错误码、query 和错误状态的已确认漂移有对应 schema/test 证据。
- [x] 至少一个真实成功响应和一个真实失败响应通过共享 schema parse；测试失败时能指出字段或 envelope 漂移。
- [x] API 的现有 smoke tests、OpenAPI 检查和两个客户端的类型检查通过，且 HTTP 行为没有改变。
- [x] 按项目顺序通过 contracts 类型检查、Lint、Format 检查；没有新增未请求的抽象或公共入口。
- [x] 本子任务完成后，`api-rpc-boundary` 可以只依赖本子任务产物和仓库源码继续执行。

## 检查命令

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
pnpm --filter @starter/web check-types
pnpm --filter @starter/admin check-types
```

## 回滚点

只恢复 contracts 文件拆分、根入口重导和 API OpenAPI schema 引用即可。不得回滚或生成数据库 migration；旧 API route 和旧 Web/Admin 客户端应继续使用相同 HTTP 合同。
