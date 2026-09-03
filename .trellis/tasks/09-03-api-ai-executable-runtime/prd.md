# 阶段 D：Executable Manifest 与窄运行端口

## Goal

把管理员发布的 Agent 变成可发现、可按执行版本校验并通过稳定运行端口调用的 capability。项目内 chat、flow 和第三方 `product_app` 不需要读取管理配置、repository 或 Pi 类型，也能判断调用输入、输出、controls 和事件协议。

本任务是阶段 D 的父任务，只管理来源需求、子任务顺序和最终集成检查，不直接修改产品代码。

## Confirmed Facts

- 阶段 A、B、C 已完成持久 lane lease、不可变资源 revision、resolved manifest、Run Attempt/Step、Tool 副作用声明和同步 retry。
- 当前 `AiRunResolvedManifest` 描述某次 Run 实际使用的资源，缺少调用输入、输出 schema、controls 和事件协议，不能直接作为公开 `ExecutableManifest`。
- Agent 的整数 `revision` 在执行配置或引用资源变化时递增；只改展示名称、描述或启停状态不递增。
- 当前只保存 Agent 的最新配置，历史 Run manifest 只能审计，不能按旧 Agent revision 再次执行。
- `/api/ai/agents` 已由 `requireRuntimePrincipal` 保护，`starter_user` 和 `product_app` 都能读取 enabled Agent summary。
- chat、flow 和 AI Run 路由重复实现 Accept 分流与 SSE 恢复，并直接依赖 concrete `AiServices`。
- 应用凭据只有 app、tenant、project 和 secret，没有 capability、版本、controls 或副作用限制。
- 当前 Webhook 只发送 Run 终态；中间 RunEvent 持久订阅属于后续外部集成阶段。

## Requirements

### R1：子任务拆分

按以下顺序独立规划、实现、验证和归档：

1. `09-03-ai-executable-manifest`：当前已发布 Agent 的 Manifest、发现接口和期望 revision 校验。
2. `09-03-ai-agent-runtime-port`：窄 `AgentRuntimePort` 和 AI/chat/flow 共享 transport。
3. `09-03-ai-app-capability-policy`：`product_app` 精确 capability policy、终态 Webhook identity 和 SSE 恢复提示。

父子关系不代替依赖声明；D2 必须在任务文件中写明依赖 D1，D3 必须写明依赖 D1、D2。

### R2：公开能力边界

- 第一版只发布 `kind='agent'` 的当前 enabled revision。
- 不支持发现或执行历史 Agent revision，不做版本范围解析。
- Manifest 只返回调用所需的公开信息，不返回 Prompt/Skill 正文、Provider 配置、secret、Tool handler 或内部网络地址。
- 新接口和旧 `/api/ai/agents`、Session、Run、JSON/SSE、Timeline、Transcript、Structured Output 行为并存，现有客户端不需要立即迁移。

### R3：运行边界

- `AgentRuntimePort` 不依赖 Hono、repository、Pi 类型或 concrete service return type。
- route 只负责鉴权、Zod/OpenAPI 校验和响应；运行规则继续由现有 service、RunEvent 和 repository 负责。
- policy 在统一运行入口和 control 入口执行，不能分散到 AI、chat、flow 三套路由。
- `AiRunResolvedManifest` 继续作为 Run 审计事实，`ExecutableManifest` 作为发布与调用契约，两者不能互相替代。

### R4：事件边界

- RunEvent 与 `ai_run_events` 继续是公开事件事实源。
- D3 只完善终态 Webhook 的 event identity、结果引用、游标和多实例领取，并增加 SSE 非终态结束后的恢复提示。
- 中间 RunEvent Webhook、任意事件订阅、远程 Tool 事件留后续阶段。

## Acceptance Criteria

- [ ] D1、D2、D3 均按依赖顺序完成各自验收并归档。
- [ ] 第三方能发现 policy 允许的当前 Agent capability，并能判断输入、输出、controls、副作用和事件协议。
- [ ] 版本检查失败发生在 lane lease 和 Run row 创建前，不执行错误版本，也不自动切换版本。
- [ ] chat、flow 和 AI Run 入口共用同一运行端口和 transport 规则，公开 URL 与现有响应保持兼容。
- [ ] `product_app` 的 Agent、版本、controls 和副作用权限由服务端 policy 强制执行。
- [ ] 终态 Webhook 可按稳定 event/delivery identity 去重，批量扫描和多实例 dispatcher 不漏发、不并发重复领取。
- [ ] SSE 正常终态不增加额外 frame；非终态结束返回可校验的恢复提示和最后 sequence。
- [ ] 每个子任务完成时运行自己的 API/contracts 检查；父任务归档前运行 `pnpm check`、`pnpm test` 和 `pnpm build`。
- [ ] 最终更新 `.trellis/spec/api/backend/` 中的 Agent Runtime、产品模块和事件交付规则。

## Out Of Scope

- 阶段 E 的 workflow、条件分支、并行子 Agent 和 map-reduce。
- 阶段 F 的 LangGraph、checkpoint、interrupt/resume 和 durable graph。
- 阶段 G 的 MCP/OpenAPI 远程 Tool 和中间 RunEvent 订阅。
- 任意第三方 graph JSON、内联 Prompt、Tool handler 或网络地址。
- 历史 Agent revision 的重新执行、semver range、自动升级或兼容层。
- 第一版调用频率、预算和全局并发限额；这些能力需要独立的原子计数设计。
