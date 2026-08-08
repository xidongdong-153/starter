# Contracts 的 Hook 边界

共享契约包不定义 React hook，也不维护请求缓存。Admin 的 query/mutation hook 位于 `apps/admin/src/api/<domain>/*.query.ts`，Web 的 session hook 来自 Better Auth client，主题 hook 位于 `apps/web/hooks/use-theme.ts`。

如果组件需要把表单值转换成 `UpdateProfileInput`，在组件或应用 API adapter 中实现显式转换；不要在 schema 文件中读取 React state 或执行异步请求。
