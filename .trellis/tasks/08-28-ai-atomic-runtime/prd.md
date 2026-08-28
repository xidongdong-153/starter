# AI Runtime API 原子化调整（父任务）

## Goal

把 AI Runtime 收敛为原子 API：移除平台内嵌的 pipeline 编排，补齐第三方自编排需要的两个基础能力——Run 终态 Webhook 推送和 startRun 幂等键。做完后，第三方调用方用「启动 Run + 事件流/轮询 + 终态回调 + 幂等重试」就能自己实现任意控制流，不需要平台提供编排。

## 背景与决策依据

- `apps/api/src/modules/ai/pipeline/` 是单进程 fire-and-forget 编排（无重试、无续跑、重启即 failed），天花板低，与原子 API 定位冲突。
- admin / web 前端对 pipeline 零消费，无真实使用，删除成本处于最低点。
- 第三方（product_app）自编排的料已齐：Run 启动、SSE、事件持久化、轮询都有；缺推送（webhook）和幂等键。

## 子任务地图

| 子任务 | 交付物 | 依赖 |
| --- | --- | --- |
| `08-28-remove-ai-pipeline` | 删 pipeline 模块、contracts schema、错误码、测试、两张 DB 表、docs/spec 引用 | 无 |
| `08-28-ai-run-webhook` | Webhook 端点管理（admin CRUD）、投递器（HMAC 签名、重试退避、死信）、deliveries 查询、集成文档 | 无（在子任务 1 之后做，diff 更干净） |
| `08-28-run-idempotency-key` | startRun 接受 idempotencyKey，同 scope 同 key 幂等返回既有 Run | 无 |

执行顺序固定：remove-ai-pipeline → ai-run-webhook → run-idempotency-key。顺序约束来自工程整洁（先删后建），不是功能依赖。

## 跨子任务验收标准

- [ ] 三个子任务各自归档，`pnpm check`、`pnpm test`、`pnpm --filter @starter/api db:check` 全绿。
- [ ] 仓库内不再有 pipeline 运行时代码：`rg -i "pipeline" apps/api/src packages/contracts/src` 只允许命中无关词（无）或零命中；docs/ai 与 .trellis/spec 中 pipeline 章节同步删除。
- [ ] 第三方视角能力闭环（写在 docs/ai/integration.md）：启动 Run（可带幂等键）→ SSE 或轮询 → 进程挂了靠幂等键安全重试 → 终态 Webhook 回调（带签名与重试）。
- [ ] OpenAPI 面保持分类：webhook 管理归 AI Control，幂等键参数出现在 AI Runtime 的 startRun 定义里。
- [ ] 父任务不做直接代码改动；最终集成复查由父任务收尾（对照本文件逐项勾选）。

## 约束

- 不改 run.service 的终态顺序契约（见 .trellis/spec/api/backend/agent-run-guidelines.md）；webhook 不得侵入 Run 终态事务路径。
- secret 边界照旧：webhook 签名 secret 加密存储、只在创建/轮换响应里返回一次，不进日志、不进 DTO 列表。
- 所有新端点带 OpenAPI 定义和 smoke test；DB 变更走 drizzle migration，不用手写 DDL。
