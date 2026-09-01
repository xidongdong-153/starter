# 对齐 Pi 超时配置：放宽单次请求超时上限，暴露 Run 级超时入口

## 背景

当前 AI 超时配置与 Pi 官方（`@earendil-works/pi-coding-agent` docs/settings.md）差距：

1. `AI_REQUEST_TIMEOUT_MS` schema 上限 300_000（5 分钟）。Pi 官方对 provider 请求超时（`retry.provider.timeoutMs`）的长任务示例值是 3_600_000（1 小时）。
2. Agent Run 总时长 `maxRunMs` 在 `agent-executor.ts:331` 写死默认 120_000（2 分钟），无环境变量入口。多轮长任务（大量工具调用）跑满 2 分钟即终态 `AI_UPSTREAM_TIMEOUT`，且每次模型调用实际超时被 Run 剩余预算压缩（`usage-audit.service.ts:35`）。`.trellis/spec/api/backend/ai-system-design.md:516` 已记录该现状。

## 需求

1. `AI_REQUEST_TIMEOUT_MS` schema 上限从 300_000 放宽到 3_600_000，默认值保持 60_000 不变。
2. 新增环境变量 `AI_RUN_MAX_MS`（Agent Run 总时长上限），透传给 `createPiAgentExecutor` 的 `maxRunMs` 选项：
   - 默认 120_000（与 executor 现有默认一致，不改变现有行为）
   - 范围 1_000 ~ 3_600_000
3. `apps/api/.env.example` 补充两个变量的说明和示例值。

## 不做的事

- 不改超时语义（墙钟硬超时 → 空闲超时）：流式与非流式保持现有实现。
- 不改 completion.service、gateway 的逻辑，它们复用同一个 env 值，上限放宽自动受益。
- 不给 DB `timeout_ms` 字段加读取路径（另一个遗留问题，不在本次范围）。

## 验收标准

1. `apps/api/src/shared/env.ts`：`AI_REQUEST_TIMEOUT_MS` max=3_600_000；新增 `AI_RUN_MAX_MS`（min 1_000 / max 3_600_000 / default 120_000）。
2. `apps/api/src/modules/ai/ai.services.ts` 创建 executor 时传入 `maxRunMs: runtime.env.AI_RUN_MAX_MS`。
3. `.env.example` 更新两个变量的注释（含范围说明），文案遵守 xdd-plain-docs。
4. 有一条测试覆盖 `AI_RUN_MAX_MS` 透传到 executor 的 `maxRunMs`（env 解析或 services 层任一层）。
5. `pnpm check`（类型、Lint、Format）全过；`pnpm test` 全过。
6. `.trellis/spec/api/backend/ai-system-design.md` 中关于 `maxRunMs` "不传也不读环境变量" 的记录更新为新入口。
