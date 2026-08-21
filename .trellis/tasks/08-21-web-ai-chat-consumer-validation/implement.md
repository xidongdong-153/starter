# Web Chat 接入验证执行计划

## 实施顺序

1. 读取 API 子任务的公开运行协议和调用样例。
2. 在 `apps/web/app/(site)/` 增加 Chat 页面和导航入口。
3. 在 `apps/web/lib/api/` 增加 Chat/Agent Run 请求函数，使用 Web 自己的 HTTP/RPC 边界。
4. 增加产品侧最小事件状态：输入、连接中、assistant 增量、完成、失败、断线恢复。
5. 用现有登录状态验证 Session/Run 访问；未登录和权限错误给出页面级状态。
6. 增加组件测试或可执行的页面验证，并完成 Web 质量检查。

## 验证

```bash
pnpm --filter @starter/web check-types
pnpm --filter @starter/web lint
pnpm --filter @starter/web format:check
pnpm --filter @starter/web build
```

## 回滚点

- 如果需要调整运行协议，回到 API 子任务修改公开 contracts，不从 Web 侧复制 Admin 实现。
- 如果 SSE 在 Next.js 页面边界不适合直接消费，增加 Web 自己的 server/client 适配层，不把浏览器凭据或平台应用凭据放进前端。
