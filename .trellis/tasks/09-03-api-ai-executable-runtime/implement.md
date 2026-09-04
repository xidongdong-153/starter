# 阶段 D 执行计划

父任务不直接启动实现。按顺序启动并归档三个子任务，最后回到父任务执行集成检查。

## 1. D1：Executable Manifest

- [x] 完成 D1 的 `prd.md`、`design.md`、`implement.md` 和 context manifests。
- [x] 用户审阅后启动 D1。
- [x] 实现公开 Manifest、发现接口和期望 revision 校验。
- [x] 运行 D1 的 contracts/API 检查与测试。
- [x] 更新相关 spec，获得提交确认后提交并归档 D1（`a38cef8` + 归档 `d803274`）。

回滚点：D1 不做 migration；删除新路由、schema 和 presenter即可恢复原行为。

## 2. D2：AgentRuntimePort

依赖 D1 已归档。

- [x] 根据 D1 的最终契约细化 D2 规划文件。
- [x] 提取窄 port 和 concrete adapter。
- [x] 提取 Accept、初始 SSE 和恢复 SSE transport helper。
- [x] 依次迁移 AI、chat、flow route，保持 URL 和 OpenAPI schema。
- [x] 运行 port 静态边界、Accept 矩阵、SSE 恢复和产品同构测试。
- [x] 更新相关 spec，获得提交确认后提交并归档 D2（`a2f8636` + 归档 `6ee4dff`）。

回滚点：每个产品 route 可单独切回现有 service 调用；不能保留两套都能决定运行规则的主路径。

## 3. D3：应用策略与事件交付

依赖 D1、D2 已归档。

- [x] 根据 D1/D2 实际接口细化 D3 规划文件和 migration。
- [x] 增加 strict capability policy、policy revision 和审计记录。
- [x] 在统一 port 检查 Agent、精确 revision、controls 和副作用等级。
- [x] 禁止 `product_app` 绕过 Agent capability 使用内联配置或 completion。
- [x] 让终态 Webhook 携带 terminal event identity、结果引用和受限 correlation metadata。
- [x] 修正 Webhook 复合扫描游标和多实例 delivery claim。
- [x] 增加 SSE 非终态结束恢复 frame，并补齐 flow 恢复入口。
- [x] 运行 policy、Webhook、SSE、跨 scope 和多实例测试。
- [x] 更新相关 spec，获得提交确认后提交并归档 D3（`be24217` + 归档 `130f51c`）。

回滚点：先关闭新版 policy/transport 行为，再回滚调用入口；保留 migration 产生的历史 policy 和 delivery identity。

## 4. 父任务集成检查

- [x] 读取三个子任务的最终 PRD、偏差记录和验证结果。
- [x] 验证公开 Manifest、Runtime Port、policy、RunEvent、Webhook 和 SSE 使用同一版本与 identity 语义。
- [x] 检查 chat/flow 没有重新导入 repository、Pi 类型或复制 policy 判断。
- [x] 确认中间事件订阅、远程 Tool、workflow 和 LangGraph 没有进入阶段 D。
- [x] 运行：

```bash
pnpm check
pnpm test
pnpm build
```

- [x] 检查 Git diff 只包含阶段 D 和 Trellis/spec 记录。
- [x] 获得提交确认后提交父任务记录并归档。

## 集成审查记录（2026-09-03，trellis-check 子代理 + 主会话全量命令）

范围：`cea9540..HEAD`，86 文件 +10153/-262，全部位于 apps/api、apps/admin、packages/contracts 和 .trellis 内。

### 结论

父任务 9 条验收、R2/R3/R4 边界、Out of Scope 全部核查通过，无 blocker、无 major。

- 主会话全量命令：`pnpm check`（eslint + prettier 全绿）、`pnpm test`（turbo 3 任务）、`pnpm build`（5 任务）、`git diff --check` 全部通过。
- 跨子任务集成专项 5 项通过：manifest controls（全量声明）与 policy controls（可用子集）语义互补且共用 `executableControlSchema` 枚举源；`eventProtocolVersion` 在 manifest / resume frame / webhook payload 三处均为 `z.literal(1)` 且写点过 strict parse；policy 判定只在 agent.service（discovery）与 run.service（start/controls），chat/flow/run-transport 零 policy 引用；discovery 两条路径（list/get）对 product_app 统一 404 不泄漏；guard 对 policy_json 解析失败按 null fail closed。
- 静态边界：port 只依赖 contracts DTO 与 `RuntimeAccessContext`（含既有静态断言测试）；`modules/ai` 不 import chat/flow；webhook dispatcher 不 import run.service / RunEventPublisher；resume frame 只经 `stream.writeSSE` 不落库；manifest 输出无 Prompt 正文 / Provider / secret / handler / 网络地址。
- Out of Scope：diff 新增行 grep workflow / langgraph / checkpoint / mcp / remote tool / semver range / rate limit / budget / concurrency 关键词零命中。
- 旧接口兼容：contracts 全量 diff 仅 6 行删除且均为等价重构（schema 位置移动、refine 形式变化）；新字段全部 optional / nullable。

### 集成层面 minor（记录在案，不阻塞）

- `eventProtocolVersion` 无单一常量源：contracts 3 处 `z.literal(1)` + API 4 处字面量。当前无漂移且 strict parse 兜底，建议后续阶段从 contracts 导出共享常量。
- `aiWebhookDeliverySchema` 未投影 `eventId` / `sequence` / `eventProtocolVersion` 新列：admin 当前无投递记录展示页，不构成三层不对齐；补管理面展示时同步投影。

### 已知残余风险（三个子任务归档 implement.md 汇总，均不阻塞）

- run-sse 客户端主动断开分支（onAbort 置位后 finally 不发 frame）无直接单测；断开时写 frame 必然失败且被静默忽略。
- `DELIVERY_CLAIM_TTL_MS`（60s）与 `AI_WEBHOOK_TIMEOUT_MS`（默认 10s，env 可调大）无程序化联动；已在 dispatcher 常量旁加注释，接收方按 `X-Starter-Delivery-Id` 去重。
- `finalizeRun` 中 `listByRun` 抛错 unhandled rejection（D2 遗留）。
- JSON 模式幂等命中丢弃 iterable 后 subscriber queue 挂到终态（1024 上界，D2 遗留）。
- 多实例 dispatcher 真实多进程并发未实测：测试以双 dispatcher 实例模拟，单机 SQLite 部署下单语句条件更新语义等价。
