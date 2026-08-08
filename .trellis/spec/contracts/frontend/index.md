# @starter/contracts 前端规范

## 适用范围

浏览器应用从 `@starter/contracts` 读取 DTO、输入 schema 类型和 API error code。该包不包含 React 组件、hook 或 UI 状态；它只定义浏览器与 API 之间的可序列化契约。

## 开发前检查

1. 检查 Admin 的 `apps/admin/src/api/` 和 Web 的 `apps/web/lib/api/` 如何读取现有 DTO。
2. 修改字段时确认 API presenter、OpenAPI schema 和两个客户端的运行时校验。
3. 保留 `import type`，不要让浏览器 bundle 引入数据库或 Node-only 依赖。
4. 检查 package exports 的 development/types/import 三个入口。

## 质量检查

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/admin check-types
pnpm --filter @starter/web check-types
```

## 客户端使用

Admin 直接使用 `FileItem`、`AccountProfile` 和 `UpdateProfileInput`；Web 对 `PublicProfile`、`AuthConfig` 先进行运行时校验再渲染。不要把 `unknown` response 直接断言成 DTO。

## 文件索引

- `directory-structure.md`：浏览器应用的共享入口和请求代码边界。
- `component-guidelines.md`：DTO 与 React 组件的边界。
- `hook-guidelines.md`：共享包与应用 hook 的边界。
- `state-management.md`：contracts 无状态和应用状态归属。
- `type-safety.md`：Zod schema、DTO、运行时校验和兼容性。
- `quality-guidelines.md`：两个客户端和 API 的联合检查。
