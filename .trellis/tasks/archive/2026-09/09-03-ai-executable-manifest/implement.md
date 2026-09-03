# D1 实施计划

## 1. Contracts

- [x] 在 `packages/contracts/src/ai.ts` 增加 executable control、调用输入、Output Contract schema、Manifest V1、列表和参数 schema。
- [x] 给 `startAgentRunSchema` 增加可选 `expectedAgentRevision`，校验它只与显式 `agentId` 配对。
- [x] 在 `packages/contracts/src/common.ts` 增加 `AI.AGENT_REVISION_CONFLICT`。
- [x] 运行 contracts type-check、lint、format:check 和 build。

检查点：schema 全部 strict；JSON Schema 字段只能接收 JSON 可序列化对象。

## 2. Manifest Presenter 与 Service

- [x] 新建 `agent/executable-manifest.presenter.ts`，生成调用 input/output JSON Schema、聚合 side effect 和稳定 hash。
- [x] `agent.service.ts` 增加 list/get Manifest 方法，查询 enabled Agent 后复用现有 resolve。
- [x] 确认展示 name/description 不进入执行 hash。
- [x] 确认公开 DTO 不含 Prompt/Skill hash、Provider/model 和 Tool 明细。

检查点：同一 Agent revision 的 Manifest 可重复计算；没有新增数据库写入方。

## 3. Route 与 OpenAPI

- [x] 在 `agent.openapi.ts` 定义 `/api/ai/executables` 列表和详情。
- [x] 在 `agent.route.ts` 使用现有 `requireRuntime` 挂载新 route。
- [x] 保留现有 `/api/ai/agents` route 和 DTO。

检查点：cookie 与 Bearer security 均进入 OpenAPI；draft/disabled 按 404/过滤处理。

## 4. Run 版本校验

- [x] 在 preset Agent resolve 后比较 `expectedAgentRevision`。
- [x] mismatch 抛出 409 `AI.AGENT_REVISION_CONFLICT`。
- [x] 保证校验位于附件、幂等、registry reserve、持久 lease 和 Run row 之前。

检查点：失败请求不创建 Run、不占 lease、不消费 idempotency key。

## 5. Tests

- [x] 新增 `ai-executable-manifest.test.ts`，覆盖 cookie/Bearer、列表/详情、disabled、schema 和敏感字段。
- [x] 覆盖 Manifest hash 稳定性、执行输入变化、Tool hash 变化和展示字段变化。
- [x] 覆盖 `expectedAgentRevision` 成功、冲突、非法组合和无副作用失败。
- [x] 回归 `ai-agent-definitions`、`ai-third-party-access`、`ai-agent-runs`、`ai-run-idempotency` 和 `ai-resolved-manifest`。

## 6. Verification

依次执行：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
pnpm check
pnpm test
```

不运行 migration 命令；D1 没有数据库变更。

## 7. Review 与回滚

- [x] 检查 diff 不包含 D2/D3、workflow、remote Tool 或中间事件订阅。
- [x] 检查新契约不导出运行时内部类型。
- [x] 运行 `trellis-check` 并处理范围内问题。
- [x] 更新相关 spec。
- [ ] 展示改动摘要，获得用户确认后提交。

回滚点：删除新增 route、presenter、schema 和可选版本检查；旧接口仍可运行。
