# AI 公共协议实施计划

## 1. 盘点和冻结

- [ ] 对照源码读取所有 `*.openapi.ts`，生成 Control/Runtime/Compatibility 接口表。
- [ ] 对照 `packages/contracts/src/ai.ts`，标出 Admin-only、Runtime-public、Starter-compatibility schema。
- [ ] 对照 `ai-system-design.md` 和测试，记录事件生产、持久化和恢复事实。

## 2. OpenAPI 分类

- [ ] 给 AI route 的 OpenAPI 定义增加准确 tags。
- [ ] 更新 `apps/api/src/openapi/api-docs.ts` 的 tags、title 和 description。
- [ ] 为运行接口补齐实际 response/error 文档，不新增未实现 endpoint。

## 3. 契约测试和文档

- [ ] 补充 HarnessEvent、Run snapshot、Transcript、敏感字段和事件顺序测试。
- [ ] 补充一份 API 内部契约说明，作为 Principal/Scope 和 Web 接入的输入。
- [ ] 检查 Admin/Web 不需要导入 Admin 私有 reducer 才能解析运行协议。

## 验证命令

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-harness-contracts.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api build
pnpm --filter @starter/api db:check
```

## 回滚点

- OpenAPI tag 和文档变更可单独回滚，不应影响 route 行为。
- contracts 字段变更必须先同步测试和消费者；失败时回退 contracts、producer、consumer 三者，不保留半套 schema。
