# API 对前端的目录边界

API 的客户端消费边界由三个导出位置组成：

- `apps/api/src/rpc.ts` 导出 `ApiType`，供类型安全的 Hono RPC 使用。
- `packages/contracts/src/index.ts` 导出跨应用的输入 schema、DTO 和 error code。
- `apps/api/src/openapi/` 描述可生成的 HTTP 文档响应。

业务实现仍放在 `apps/api/src/modules/<domain>/`。不要为了让前端更方便而把数据库 schema、repository 或内部 runtime 类型导出给浏览器；前端只依赖 contracts 和 HTTP/RPC 边界。

新增字段时从 route schema、presenter、contracts 到客户端读取代码逐层检查，不能只修改某一端的 TypeScript interface。
