# 处理 Agent transcript custom entry 日志噪声

## Goal

读取 Agent Session transcript 时，不再把系统主动写入且按设计过滤的 `starter.run.v1` 终态 entry 记录成 WARN，同时保留真正异常 entry 的告警，避免正常请求反复刷日志。

## Background

- `apps/api/src/infra/agent/pi-session-store.ts` 通过 `appendRunTerminalEntry()` 将 Run 终态写成 `customType = starter.run.v1` 的 `custom` entry。
- 这些 entry 用于 Run 启动恢复和一致性判断，不属于面向前端的 transcript item。
- `apps/api/src/modules/ai/session/session.presenter.ts` 当前按设计过滤该 entry，但仍以 `unknown_entry_type` 回调 `onSkipped`。
- `apps/api/src/modules/ai/session/session.service.ts` 将所有 skipped 回调逐条记录为 WARN，因此每次读取包含历史 Run 的 Session 都会重复输出告警。

## Requirements

- transcript 继续过滤 `starter.run.v1`，不得加入 API 返回的 `items`。
- 已知的 `starter.run.v1` 被过滤时不得记录 WARN。
- 真正未知的 entry 类型或 message role 仍通过现有 skipped 回调记录 WARN。
- 不修改 transcript 对外契约、分页语义、Run 终态写入、启动恢复和一致性检查行为。
- 不删除或迁移现有 Agent Session Store 数据。

## Acceptance Criteria

- [x] 读取包含一个或多个 `starter.run.v1` entry 的 transcript 时，接口返回 200，终态 entry 不出现在 `items` 中，logger 不产生对应 WARN。
- [x] 读取包含真正未知 entry 的 transcript 时，该 entry 不出现在 `items` 中，logger 仍产生一条带 `entryType`、`entryId`、`reason`、`sessionId` 和 `requestId` 的 WARN。
- [x] 现有 transcript 排序、cursor、limit 和安全字段过滤测试继续通过。
- [x] 依次通过 `pnpm check-types`、`pnpm lint`、`pnpm format:check` 和相关 API 测试。

## Out Of Scope

- 将 `starter.run.v1` 投影成新的 transcript item。
- 清理现有 Session 或 Pi Session Store entry。
- 调整其他日志级别或聚合所有 skipped entry。
