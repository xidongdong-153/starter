# API 包的前端边界

## 适用范围

`@starter/api` 不包含 React 组件、页面或浏览器状态。这里的“frontend”只描述 API 对 Admin/Web 的可消费边界；实际 UI 代码放在 `apps/admin` 和 `apps/web`。

## 开发前检查

涉及客户端消费的 API 变更时，同时读取：

- `packages/contracts/src/index.ts`：DTO、Zod 输入 schema 和 error code。
- `apps/admin/src/api/http.ts`：Admin 对响应 wrapper 和状态码的处理。
- `apps/web/lib/http.ts`：Web 对 `ok/data/meta` 和失败响应的处理。
- `apps/api/src/rpc.ts`：Hono RPC 类型导出。

不要在 API 包新增 React hook、UI 组件或浏览器 localStorage 逻辑。

## 质量检查

## 文件索引

- `directory-structure.md`：API 对 RPC、contracts 和 OpenAPI 的客户端边界。
- `component-guidelines.md`：JSON DTO、文件 Response 和 UI 代码边界。
- `hook-guidelines.md`：Hono middleware 与前端 React hook 的边界。
- `state-management.md`：request context、持久状态和浏览器状态的归属。
- `type-safety.md`：contracts、OpenAPI 和客户端 error code 的一致性。
- `quality-guidelines.md`：客户端可见 API 的跨应用检查。
