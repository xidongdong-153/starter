# D2：窄运行端口与共享传输适配

## Goal

让 AI、chat、flow 通过一个不依赖 Hono、repository 或 Pi 类型的 `AgentRuntimePort` 调用现有 Run 能力，并共用 Accept、初始 SSE 和恢复 SSE 规则。

依赖：`09-03-ai-executable-manifest` 已完成并归档。D1 最终接口发生变化时，本任务在启动前更新规划。

## Requirements

- 定义窄 port：start、get、active、subscribe、abort、steer、follow-up、transcript、outputs。
- port 的 cursor 只接受 `afterSequence` 或 `lastEventId`，不把 `sequenceForEvent` 暴露给产品模块。
- `start` 直接返回现有 `startRun()` 的事件 iterable；初始 SSE 不再次 `subscribe(0)`。
- 提取共享 Hono transport helper，统一 AI/chat/flow 的 Accept 矩阵、Last-Event-ID 和 SSE writer。
- route 继续拥有 URL、middleware、OpenAPI 和 principal 构造；transport 不执行业务 policy。
- `AiServices` 可保留给 AI 管理路由，但 chat/flow 的运行行为只依赖窄 port 和必要的独立 Session/附件端口。
- 不修改 Run Service 状态机、RunEvent、公开 URL 或响应 DTO。

## Acceptance Criteria

- [ ] `AgentRuntimePort` 不 import Hono、repository、Pi 包或 concrete service return type。
- [ ] AI/chat/flow 的 JSON 与 SSE 启动使用同一 transport helper。
- [ ] 缺省、`*/*`、仅 SSE、仅 JSON 和同时包含两种 Accept 的行为与现有约定一致。
- [ ] 初始 SSE 使用 start 返回的 iterable，不创建第二个 sequence 0 订阅。
- [ ] `afterSequence > 0` 优先于 Last-Event-ID，未知 eventId 保持 400。
- [ ] 连接断开不 abort Run，终态后停止迭代。
- [ ] chat active/transcript 与 flow outputs 行为不变。
- [ ] product module 同构、SSE 恢复和全量 API 检查通过。

## Out Of Scope

- D3 capability policy、Webhook 和 SSE 恢复提示。
- Session CRUD、附件、completion 和管理配置的统一大 facade。
- 前端 SDK、公开 URL、RunEvent wire format 或数据库变更。
