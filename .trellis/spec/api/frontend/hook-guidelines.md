# API 的 Hook 边界

`@starter/api` 没有 React hook。请求生命周期由 Hono middleware 管理，顺序在 `apps/api/src/middleware/index.ts` 中定义：RequestContext、secure headers、request log、CORS、body limit、timing、timeout。

前端请求 hook 应留在各自应用：Admin 的 query/mutation hooks 位于 `apps/admin/src/api/<domain>/*.query.ts`，Web 的客户端请求函数位于 `apps/web/lib/api/`。API 新增 middleware 时应通过 `c.set` / `c.var` 定义明确的 Hono context 类型，不要模拟 React hook 生命周期。
