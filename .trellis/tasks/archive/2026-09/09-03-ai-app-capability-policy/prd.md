# D3：应用能力策略与事件交付

## Goal

限制 `product_app` 只能发现和调用管理员明确允许的当前 Agent revision 与 controls，并让终态 Webhook 和 SSE 断流具有稳定、可恢复的传输语义。

依赖：`09-03-ai-executable-manifest`、`09-03-ai-agent-runtime-port` 已完成并归档。两个前置任务发生接口变化时，本任务在启动前更新规划。

## Requirements

### Capability policy

- 应用凭据保存版本化 strict policy，第一版包含精确 `{ executableId, version }`、允许 controls 和最大 Tool 副作用等级。
- policy 默认不能解释成允许全部；新 credential 必须显式给出 policy。
- discovery、start、abort、steer 和 follow-up 都经 D2 的统一 port 检查。
- Agent revision 改变后，旧 policy 拒绝调用，不执行旧版本，也不自动升级。
- `product_app` 继续禁止内联 Agent config，并禁止绕过 Agent capability 调用无状态 completion。
- rotate 保留 policy，revoke 继续立即失效；policy 更新写审计记录。

### Terminal Webhook

- 继续只发送安全的终态通知，不订阅 message、thinking、Tool 参数或其他中间事件。
- payload 携带对应 terminal RunEvent 的 eventId、sequence、event protocol version、结果引用和受限 correlation metadata。
- 扫描使用不会跳过相同时间戳记录的稳定复合游标。
- 多实例 dispatcher 使用条件更新领取 delivery；协议保持 at-least-once，接收方按 identity 去重。

### SSE recovery

- SSE writer 未观察到 terminal RunEvent 就结束时，发送独立、版本化的 `stream.resume_required` transport frame，包含最后 sequence 和原因。
- transport frame 不写入 `ai_run_events`、Timeline 或 transcript。
- 正常 terminal 流不发送恢复 frame。
- flow 如果对外提供启动 SSE，补齐与 AI/chat 同等的已有 Run 恢复入口。

## Acceptance Criteria

- [x] policy schema、migration、CRUD、guard 上下文和审计完整，未知字段或重复 capability 返回 400。（contracts `aiApplicationPolicySchema` strict + superRefine；migration 0031；PATCH policy 端点 + `policy_updated` 审计；`ai-application-policy.test.ts` 断言 400 矩阵）
- [x] `product_app` 只能发现并启动 policy 中精确匹配当前 revision 的 Agent。（discovery 过滤 + `enforceStartPolicy`；同测试断言 revision 升级后 discovery 清空、详情 404、start 403）
- [x] 未授权 Agent、revision、control 或副作用等级在执行前返回稳定 403，跨 scope 继续返回 404。（`AI.APP_POLICY_FORBIDDEN`；controls 403 三例；跨 scope 404 由 `requireScopedRun` 前置保证）
- [x] policy 失败不创建 Run、不领取 lease、不消费 idempotency key。（`enforceStartPolicy` 在幂等预检查 / reserve / Run row 前；测试断言 0 Run 行、同 lane 可立即启动、同幂等键换合法请求成功）
- [x] terminal Webhook identity 与持久 terminal RunEvent 一致，重复扫描不重复建 delivery。（leftJoin `ai_run_events` 取 eventId/sequence；`(endpoint_id, run_id)` 唯一约束；端到端断言与插入事件行一致）
- [x] 相同时间戳超过单批上限时不漏发；两个 dispatcher 不同时领取同一 delivery。（`(finishedAt, runId)` 复合游标；201 条同时间戳两轮 tick 全部送达；claim 条件 UPDATE 互斥 + 过期重领测试）
- [x] SSE 正常终态无额外 frame，非终态结束返回可校验的恢复 frame，并能按 sequence 重连。（`streamResumeRequiredFrameSchema`；run-event-recovery 四类 frame 断言；flow 恢复端点从 sequence 1 连续收到终态）
- [x] Starter User 和现有 JSON/SSE/Timeline/Transcript 行为不受 app policy 影响。（全量 476 测试既有断言不变；policy 检查对 starter_user 三处短路）
- [x] migration、contracts、API 与全仓检查通过。（API check-types / lint / format / db:check / test 66 文件 476 用例、admin 112 用例、根级 format:check、`pnpm build` 5 任务、`git diff --check`）

## Out Of Scope

- 中间 RunEvent Webhook、任意事件订阅和手工 dead delivery 重投。
- 调用频率、预算和全局并发限额。
- 历史 Agent revision 执行、版本范围、自动升级。
- workflow、LangGraph、MCP/OpenAPI Tool。
