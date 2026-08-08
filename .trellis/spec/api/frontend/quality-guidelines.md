# API 前端边界质量检查

涉及客户端可见 API 的变更，至少检查：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
pnpm --filter @starter/admin check-types
pnpm --filter @starter/web check-types
```

还要确认：

- 成功响应含 `ok: true`、`data`、`meta`，失败响应含 `ok: false`、`error.code`、`error.message`、`meta`。
- 公共 DTO 不包含私有字段，例如 `PublicProfile` 不应有 account email。
- 文件 URL、状态码和 cookie 凭据设置与 Admin/Web 的 `apiRequest` 实现一致。
- OpenAPI 文档和 smoke test 与实际 route 同步。

API 包本身不需要 UI 组件测试；客户端视觉或交互变化在对应应用中验证。
