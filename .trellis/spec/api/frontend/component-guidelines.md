# API 前端组件边界

`@starter/api` 不定义 UI 组件。页面组件和交互组件分别位于 `apps/admin/src/features/`、`apps/admin/src/components/` 与 `apps/web/app/`、`apps/web/components/`。

API 端只返回可序列化的 DTO 或文件 `Response`：

- JSON 通过 `createSuccessResponse` / `createFailureResponse` 返回。
- 文件内容通过 `Response` 返回，并设置 Content-Type、Content-Length 等响应头。
- presenter 将数据库 `Date` 转成 ISO 字符串，将相对内容路径转成 `contentUrl` 或 `avatarUrl`。

不要在 API response 中返回数据库行、Drizzle 类型、File 对象或包含内部路径的对象。前端展示组件应根据 `@starter/contracts` 的 DTO 工作。
