# API 后端质量规范

## 检查命令

提交 API 变更前依次运行：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
```

全仓库检查使用 `pnpm check`，构建使用 `pnpm build`。数据库变更额外运行 `pnpm --filter @starter/api db:check`。

## Endpoint 检查表

- route 有 OpenAPI method/path/request/responses 定义。
- JSON body、param、query 都用 Zod schema 校验，并从 `c.req.valid(...)` 读取，不直接读取未校验输入。
- 需要登录的 route 使用 `createRequireAuth(runtime.auth)`；资源查询还要验证当前用户所有权。
- JSON 响应使用 `createSuccessResponse`，状态码与 OpenAPI 定义一致；文件内容响应明确 Content-Type、Content-Length 和缓存/下载头。
- service 负责业务规则，repository 负责数据库操作，presenter 负责 DTO 转换。
- 成功、未登录、校验失败、404、跨用户访问和异常分支都有测试断言。

## 现有测试风格

测试使用 `app.request()` 直接请求 Hono app，先通过 `register` 获取 cookie，再用 `readSuccess`/`readFailure` 读取响应。文件 smoke test 覆盖上传、列表、下载、重命名、删除和所有权隔离；profile smoke test 覆盖私有 DTO 不泄露 email、公开 DTO 和头像流程。

## 安全边界

不要把 `BETTER_AUTH_SECRET`、cookie、数据库文件、上传目录或真实环境文件提交到仓库。上传大小由 service 的 10 MiB 检查和 middleware 限制共同保护；文件删除必须先按 owner 查询并在数据库事务中清理头像引用。
