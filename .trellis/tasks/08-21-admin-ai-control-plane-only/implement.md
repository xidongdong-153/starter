# Admin AI 控制面执行计划

## 实施顺序

1. 读取 API 子任务产出的控制面/runtime 面说明。
2. 从 `apps/admin/src/features/ai/routes.tsx` 移除 Agent Sessions 路由和菜单。
3. 搜索 `AgentSessions`、`startAgentRun`、`harness` 的引用，区分页面专用代码和管理功能需要的代码。
4. 删除页面专用组件、query、SSE parser、reducer、时间线和测试；保留公共 contracts 和管理接口。
5. 更新中英文菜单文案和路由相关测试。
6. 验证管理页面仍能构建和访问。

## 验证

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test
pnpm --filter @starter/admin build
```

## 回滚点

- 如果协议仍需要 Admin 时间线作为参考，先保留 reducer 测试或迁移测试，再删除页面入口。
- 不删除 `packages/contracts/src/ai.ts` 的 HarnessEvent，除非 API 子任务已经提供替代公共契约。
