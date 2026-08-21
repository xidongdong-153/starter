# 跨产品运行契约验证计划

## 验证矩阵

1. 正常：app credential -> Session -> Run -> SSE -> terminal -> Transcript。
2. 断线：收到部分事件后断开 -> GET Run live -> terminal -> Transcript。
3. 身份：错误/撤销 credential、错误 externalUserId、跨 project/session/run 访问。
4. 并发：同 session/lane busy；不同 scope 不互相占用资源。
5. 错误：invalid Agent、Provider timeout、Tool invalid/forbidden/timeout、Pi storage failure。
6. 安全：响应、日志、DB、events 不含 Provider secret、App secret、arguments、model result、原始错误。
7. 兼容：Starter Cookie 运行路径继续通过原有 smoke tests。

## 实施步骤

- [x] 新建 product app HTTP 调用 fixture/helper，不引用 Admin 源码。
- [x] 用 `eventsource-parser` 处理任意 chunk 和 heartbeat，每个 data 通过 `harnessEventSchema`。
- [x] 记录 sequence、runId 和 terminal，验证 terminal event 唯一且字段通过公共 schema。
- [x] 模拟 reader 断开，查询 `GET Run`，终态后读取 Transcript。
- [x] 执行 scope/credential/secret marker 表驱动测试。
- [x] 输出给 Web 子任务的最小接入说明和错误/恢复规则。

## Verification

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-cross-product-runtime.test.ts --config vitest.config.ts
pnpm --filter @starter/api test
pnpm check-types
pnpm lint
pnpm format:check
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

## Completion Gate

只有验证矩阵全部通过，API 父任务才可标记完成，Admin/Web 子任务才可以启动。任何失败先回到拥有该 contract 的前置子任务修正，不能在验证 helper 中增加私有 fallback。
