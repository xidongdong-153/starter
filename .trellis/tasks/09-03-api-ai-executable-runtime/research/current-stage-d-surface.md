# 阶段 D 当前代码面与最小实现边界

## 结论

阶段 D 可以建立在现有 Agent revision、Run resolved manifest、RunEvent、product_app principal 和 Webhook delivery 上，不需要重写执行器。

最小实现应按 D1 -> D2 -> D3 排序：

1. D1 先定义“当前已发布 Agent 的可执行清单”。第一版只支持当前 `agentRevision` 的精确调用，不承诺历史版本还能执行。
2. D2 提取只包含运行面动作的 `AgentRuntimePort`，并把 Accept 分流、初始 SSE、恢复 SSE 放进共享 transport adapter。
3. D3 在 D2 的统一入口执行 product_app policy，再把 Webhook 从“每个 Run 一条终态通知”扩展为有 event identity 的持久投递；SSE 增加非终态断流的恢复提示。

当前最重要的边界是：`AiRunResolvedManifest` 是“一次 Run 实际用了什么”的审计快照，不是“客户端可以调用什么”的发布清单。它不能直接改名后作为 D1 交付。

## 当前基础

| 已有事实 | 代码证据 | 阶段 D 可复用方式 |
| --- | --- | --- |
| Agent 有 `draft/enabled/disabled` 和单调递增的整数 `revision` | `packages/contracts/src/ai.ts:603-604`、`packages/contracts/src/ai.ts:710-726`、`apps/api/src/modules/ai/ai.schema.ts:343-370` | `enabled` 作为当前发布状态，`revision` 作为 executable version |
| config 变化才直接增加 Agent revision；展示名称、描述和状态变化不增加 | `apps/api/src/modules/ai/agent/agent.service.ts:163-181`、`apps/api/src/modules/ai/agent/agent.service.ts:199-214`、`apps/api/src/test/ai-agent-definitions.test.ts:91-96`、`apps/api/src/test/ai-agent-definitions.test.ts:174-201` | version 表示执行输入版本，不表示展示元数据版本或启停次数 |
| Prompt 内容更新、Skill 内容/名称/描述更新会增加引用 Agent 的 revision | `apps/api/src/modules/ai/prompt/prompt.repository.ts:243-269`、`apps/api/src/modules/ai/skill/skill.repository.ts:26-30`、`apps/api/src/modules/ai/skill/skill.repository.ts:84-114` | 当前 Agent revision 已覆盖主要间接执行输入变化 |
| resolve 已产出模型、Prompt/Skill hash、精确 Tool、Output Contract 和执行参数 | `apps/api/src/modules/ai/agent/agent.service.ts:35-62`、`apps/api/src/modules/ai/agent/agent.service.ts:232-272`、`apps/api/src/modules/ai/agent/agent.service.ts:321-402` | D1 presenter 可复用，不再另写一套资源解析 |
| Run manifest 已有 canonical JSON 和 SHA-256 | `apps/api/src/modules/ai/run/resolved-manifest.ts:7-20`、`apps/api/src/modules/ai/run/resolved-manifest.ts:22-66` | D1 manifest hash 复用同一序列化和 hash 规则 |
| Tool 有精确 semver ref、JSON Schema、timeout、side effect 和 manifest hash | `packages/contracts/src/ai.ts:543-574`、`apps/api/src/modules/ai/tool/tool-registry.ts:51-81`、`apps/api/src/modules/ai/tool/tool-registry.ts:94-130`、`apps/api/src/modules/ai/tool/tool-registry.ts:216-219` | D1 可投影 Tool 契约，不导出 handler 或 mutable Zod 对象 |
| Output Contract 有 semver、schemaHash、render/visibility/mode，并在 define 时保存 schema JSON | `packages/contracts/src/ai.ts:630-652`、`apps/api/src/modules/ai/output/output-contract-registry.ts:17-40`、`apps/api/src/modules/ai/output/output-contract-registry.ts:68-83`、`apps/api/src/modules/ai/ai.schema.ts:648-665` | D1 输出 schema 应读 snapshot/current registry，不从历史 Run 反推 |
| RunEvent 已有 eventId、run 内 sequence、时间和完整关联 envelope | `packages/contracts/src/ai.ts:1274-1282`、`packages/contracts/src/ai.ts:1330-1510`、`apps/api/src/modules/ai/run/run-event.repository.ts:27-48` | D1 声明 event protocol，D2/D3 继续以 RunEvent 为业务事件 |
| product_app principal 已绑定 app、tenant、project、external user 和可选 subject | `apps/api/src/modules/ai/application/application.guard.ts:12-40`、`apps/api/src/modules/ai/principal.ts:1-20` | D3 policy 可在认证后随 access context 进入运行入口 |
| Webhook 已有 URL guard、HMAC、重试、dead 状态、payload 快照和管理接口 | `apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:19-46`、`apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:147-228`、`apps/api/src/modules/ai/ai.schema.ts:777-835` | 保留投递执行器，只替换事件入队标识与扫描游标 |

## D1：Executable Manifest

### 1. 可复用数据

D1 可以直接复用以下执行事实：

- `agentId + agentRevision`：来自 `ai_agent_definitions`。Run 启动也把这两个值固化到 Run 和 snapshot，见 `packages/contracts/src/ai.ts:1001-1032`、`apps/api/src/modules/ai/run/run.service.ts:266-267`。
- 模型引用：`resolve()` 已保证模型存在且允许，见 `apps/api/src/modules/ai/agent/agent.service.ts:232-266`。
- Prompt/Skill 的 pinned revision 和 content hash：`ResolvedAgentManifestFacts` 已经提供，见 `apps/api/src/modules/ai/agent/agent.service.ts:35-43`、`apps/api/src/modules/ai/agent/agent.service.ts:347-381`。
- Tool 的精确 `name/version`、`manifestHash`、`sideEffect`、`timeoutMs` 和输入 JSON Schema：注册表已经计算这些值，见 `apps/api/src/modules/ai/tool/tool-registry.ts:68-81`、`apps/api/src/modules/ai/tool/tool-registry.ts:120-130`、`apps/api/src/modules/ai/tool/tool-registry.ts:216-219`。
- Output Contract 的 `name/version/schemaHash/renderKind/visibility/mode` 和 schema JSON：当前 registry 有运行时对象，快照表已有不可覆盖的 `(name, version)` 记录，见 `apps/api/src/modules/ai/output/output-contract-snapshot.repository.ts:5-27`。当前缺少 snapshot 的读取方法。
- manifest hash：`canonicalJson()` 和 `sha256Hex()` 已用于 Run manifest，见 `apps/api/src/modules/ai/run/resolved-manifest.ts:12-20`。

不应复用成公开 manifest 的内容：

- Prompt 正文、Skill 正文、Provider credential、Tool `execute` handler。
- `AiRunResolvedManifest` 的整份 DTO。它描述具体 Run，包含 Prompt/Skill 内容 hash，但不含 typed input、输出 schema、controls 或协议版本，见 `packages/contracts/src/ai.ts:1035-1088`。
- `AgentDefinitionDetail.config`。它是管理面编辑结构，不是第三方执行契约，而且公开路由当前只返回 summary，见 `apps/api/src/modules/ai/agent/agent.openapi.ts:34-61`、`apps/api/src/modules/ai/agent/agent.route.ts:32-36`。

### 2. 版本语义

第一版建议明确四种互不混用的版本：

- `manifestSchemaVersion = 1`：Executable Manifest DTO 自身的结构版本。
- `version = agentRevision`：某 Agent 当前执行输入的整数版本。它不是 semver，也不因启用、停用或只改展示描述而变化。
- `eventProtocolVersion = 1`：`RunEvent` 事件族的协议版本。当前 event envelope 没有 version 字段，而且严格 schema 会拒绝额外 `version`，见 `apps/api/src/test/ai-run-event-contracts.test.ts:144-153`。D1 先在 manifest 中声明，不必给每个 RunEvent 加字段。
- Tool 与 Output Contract 的 `version`：继续使用各自的 semver，不转换成 Agent revision。

最小兼容承诺：

- 对外只列出每个 enabled Agent 的当前 version。
- 调用只接受 policy 允许的精确 `{ agentId, version }`；请求到达时如果当前 revision 已变化，拒绝调用，不回退到旧 revision。
- 不提供 version range，不承诺按旧 revision 重新执行。当前没有 Agent config revision 表，只有当前 `config_json`，见 `apps/api/src/modules/ai/ai.schema.ts:343-370`；历史 Run manifest 也只按 `runId` 读取，见 `apps/api/src/modules/ai/run/run-resolved-manifest.repository.ts:8-35`。
- 同一 `{ agentId, version }` 的执行字段必须产生同一 `manifestHash`。Prompt/Skill 已有传播机制；Tool 和 Output Contract 还需要约束“同名同版本定义不可变”。Tool 当前只在单次进程注册时查重，跨部署没有持久冲突检查，见 `apps/api/src/modules/ai/tool/tool-registry.ts:132-160`。D1 至少应把 Tool `manifestHash` 纳入 executable hash，并在文档和测试中把版本漂移视为定义错误。

展示用 `name/description` 可以随当前 Agent 行变化，但不应进入“执行字段 hash”；否则现有“只改描述不增 revision”会破坏同版本 hash。若产品要求名称和描述也完全不可变，就不能使用当前最小方案，必须增加按 Agent revision 保存的发布快照。

### 3. 最小 Manifest 形状

建议第一版只发布 `kind = agent`：

```ts
interface ExecutableManifestV1 {
  manifestSchemaVersion: 1
  id: string
  version: number
  kind: 'agent'
  name: string
  description: string
  inputSchema: JsonSchema
  outputContract: {
    name: string
    version: string
    schemaHash: string
    schema: JsonSchema
    renderKind: AiOutputRenderKind
    visibility: AiOutputVisibility
    mode: AiOutputMode
  } | null
  eventProtocolVersion: 1
  controls: Array<'abort' | 'steer' | 'follow_up'>
  sideEffect: AiToolSideEffect
  manifestHash: string
}
```

`inputSchema` 只描述一次已选定 Agent 的调用输入：`input`、`lane?`、`idempotencyKey?`、`attachmentIds?`。不要复用完整 `startAgentRunSchema`，因为它还包含 `agentId` 和管理员/Starter User 才能用的内联 `config`，见 `packages/contracts/src/ai.ts:1188-1240`。

`sideEffect` 按 Tool 集合取最强等级：`non_idempotent_write > idempotent_write > read_only`。它是调用方和 policy 的保守提示，不替代每个 Tool 自己的 side effect。

当前没有 `capabilityTags`、`deprecatedAt` 或 per-Agent timeout 的事实源。第一版不要返回虚构默认值。需要这些字段时，应先把它们加入 Agent 发布数据并定义 revision 变化规则。

### 4. 建议文件范围

- `packages/contracts/src/ai.ts`：新增 executable input、manifest、列表和查询 schema。
- `apps/api/src/modules/ai/agent/agent.service.ts`：新增 `listExecutableManifests/getExecutableManifest`，复用现有 `resolve()`。
- `apps/api/src/modules/ai/agent/agent.presenter.ts` 或新建 `apps/api/src/modules/ai/agent/executable-manifest.presenter.ts`：只做无敏感信息投影与 hash。
- `apps/api/src/modules/ai/agent/agent.openapi.ts`、`agent.route.ts`、`index.ts`：新增 discovery 路由。建议路径为 `/api/ai/executables` 和 `/api/ai/executables/{agentId}`，继续使用 runtime principal。
- `apps/api/src/modules/ai/output/output-contract-snapshot.repository.ts`：只有 manifest 必须从持久 snapshot 读完整 schema 时才加 `find(name, version)`；不要新建第二张 contract 表。
- `apps/api/src/test/ai-executable-manifest.test.ts`：新增独立集成测试。

最小当前版本方案不需要修改 `ai.schema.ts` 或新增 migration。若验收要求“旧版本仍可发现或执行”，则必须增加 Agent revision/published manifest 快照表，这已经超出上述最小范围。

### 5. 验收测试

- product_app 和 starter_user 都能读取 enabled Agent manifest；draft/disabled 不出现且按 id 返回 404。
- manifest 能通过 contracts schema，输入 schema 不包含 `agentId`、`config`、Prompt 正文、credential 或 handler。
- 相同 Agent revision 连续读取的 `manifestHash` 相同。
- config、Prompt 内容、Skill 内容/名称/描述变化后 Agent revision 和 manifest hash 都变化；只改 Agent 展示描述时 version 与执行字段 hash 不变。
- Tool 定义相同则 hash 相同，Tool manifest hash 变化会改变 executable hash。
- Output Contract schema 来自相同 `name/version/schemaHash`，admin visibility 只影响结果值可见性，不隐藏 schema。
- manifest 声明的 controls 和 `eventProtocolVersion` 与实际 runtime/SSE 契约一致。

### 6. 明确非目标

- 不发布 `tool` 或 `workflow` 类型 executable。
- 不支持任意 workflow JSON、MCP/OpenAPI Tool 注册或第三方 Tool handler。
- 不执行历史 Agent revision，不做 semver range 选择。
- 不公开 Prompt/Skill 正文、Provider 信息或 Tool handler。
- 不在 D1 引入 app credential policy；D1 只建立可发现的当前发布清单。

## D2：AgentRuntimePort 与共享 transport

### 1. 当前依赖过宽与重复

`AiServices` 把 application、webhook、configuration、prompt、skill、agent、session、run、completion、attachment、tool 和 invocation 全部 concrete service 暴露给产品模块，见 `apps/api/src/modules/ai/ai.services.ts:45-65`。chat/flow 直接依赖整个 `AiServices`，见 `apps/api/src/modules/chat/chat.route.ts:9-10`、`apps/api/src/modules/flow/flow.route.ts:7-8`。

Accept 和 SSE 恢复规则已经出现三份：

- AI：`apps/api/src/modules/ai/run/run.route.ts:43-72`
- chat：`apps/api/src/modules/chat/chat.route.ts:107-136`
- flow：`apps/api/src/modules/flow/flow.route.ts:66-83`

三处启动 handler 都忽略 `startRun()` 已返回的 `events`，再调用一次 `subscribe(..., 0)`。`StartRunResult.events` 已存在，见 `apps/api/src/modules/ai/run/run.service.ts:69-72`。

### 2. 最窄 port

按当前产品真正需要的运行行为，建议 port 只包含：

```ts
interface AgentRuntimePort {
  start(input): Promise<{ runId: string; events: AsyncIterable<RunEvent> }>
  get(access, sessionId, runId): AgentRun
  active(access, sessionId, lane): AgentRun | null
  subscribe(access, sessionId, runId, cursor): AsyncIterable<RunEvent>
  abort(access, sessionId, runId): AgentRun
  steer(access, sessionId, runId, input): Promise<AgentRun>
  followUp(access, sessionId, runId, input): Promise<AgentRun>
  transcript(access, sessionId, query, requestId?): Promise<AgentTranscript>
  outputs(access, sessionId, runId): StructuredOutputList
}
```

`cursor` 建议定义成 `{ afterSequence: number } | { lastEventId: string }`，由 adapter 内部调用现有 `sequenceForEvent()`。这样 `sequenceForEvent` 不成为产品 API。

保留 `active`，因为 chat 已用它做刷新恢复，见 `apps/api/src/modules/chat/chat.route.ts:145-152`。不把以下方法放进 port：

- `trace`、`adminStructuredOutputs`、`describeResolvedManifest`、`recoverInterrupted`：它们是管理或启动维护动作。
- repository、Pi executor、registry、lane lease、readiness：它们都是实现细节。
- Hono `Context`、Response、OpenAPI route：port 是应用层接口，不是 HTTP helper。

Session CRUD、Agent discovery 和附件上传可以继续是独立窄 port；不要为了让产品只收一个参数，把所有 AI service 再包装成另一个大对象。D2 只要求先把共同的 Run 调用、transcript 和 outputs 从 `AiServices` 中切出。

### 3. 共享 transport 边界

建议新增两个共享 handler helper：

- `startRunTransport(context, port, input)`：调用 `port.start`；Accept 明确含 `application/json` 且不含 `text/event-stream` 时返回统一 JSON；其他情况直接把 `result.events` 交给 SSE writer。
- `resumeRunTransport(context, port, input)`：`afterSequence !== 0` 时优先用 query；否则可用 `Last-Event-ID`；解析 cursor 后订阅并写 SSE。

继续复用 `writeRunEventStream()` 的既有协议：15 秒 heartbeat、按 sequence 去重、唯一终态停止、连接断开只结束订阅，见 `apps/api/src/modules/ai/run/run-sse.ts:7-49`。

共享 transport 不处理：

- auth middleware 和 `RuntimeAccessContext` 构造；各 route 已有自己的 principal 入口。
- URL、tags、OpenAPI response 描述；AI/chat/flow 的公开路径仍各自维护。
- policy；D3 在 port 的调用入口检查，transport 只做 HTTP/SSE 映射。
- RunEvent 生产、持久化或状态机。

### 4. 建议文件范围

- 新建 `apps/api/src/modules/ai/runtime/agent-runtime.port.ts`：接口与 concrete adapter。
- 新建 `apps/api/src/modules/ai/run/run-transport.ts`：共享 Accept、初始流、恢复流逻辑。
- `apps/api/src/modules/ai/ai.services.ts`、`apps/api/src/modules/ai/index.ts`：装配并导出窄 port；保留内部 service 给 AI 管理路由。
- `apps/api/src/modules/ai/run/run.route.ts`、`apps/api/src/modules/chat/chat.route.ts`、`apps/api/src/modules/flow/flow.route.ts`：改用共享 transport；chat/flow 不再直接调用 concrete run/session service 的上述运行方法。
- `apps/api/src/modules/ai/run/run-sse.ts`：只在 helper 需要导出明确 transport 类型时调整，不改变业务事件。
- `apps/api/src/test/run-transport.test.ts`：新增 transport 单测。
- `apps/api/src/test/product-modules.smoke.test.ts`、`run-event-recovery.test.ts`：补跨路由同构与恢复回归。

### 5. 验收测试

- Accept 矩阵在 AI/chat/flow 一致：缺省、`*/*`、仅 `text/event-stream` 返回 SSE；仅 `application/json` 返回 JSON；同时包含两者返回 SSE。
- 初始 SSE 使用 `start()` 返回的 iterable，不做第二次 `subscribe(0)`。
- `afterSequence > 0` 优先于 `Last-Event-ID`；只有 query 为 0 时才解析 header；未知 eventId 仍返回 400。
- AI、chat、flow 对同一 fake port 的 JSON envelope、SSE id/event/data 和错误状态一致。
- transport 断开不调用 `abort`；终态事件后停止迭代并调用 iterator `return()`。
- chat 的 `active`、transcript 和 flow 的 structured outputs 行为不变。
- 静态边界检查：`AgentRuntimePort` 不 import Hono、repository、`@earendil-works/*` 或 concrete service return type。

### 6. 明确非目标

- 不重构 `AiAgentRunService` 内部状态机、lease、attempt、retry 或 executor。
- 不合并 AI/chat/flow 的 OpenAPI 文件，也不改现有 URL。
- 不把 Session CRUD、附件、completion、管理配置全部塞进一个新 facade。
- 不做客户端 SDK 或前端迁移。
- 不改变 RunEvent 或 SSE wire 格式；非终态 EOF 恢复信号留 D3。

## D3：应用能力策略与事件交付

### 1. 现有 credential 缺少的 policy

当前应用凭据只有名称、tenant、project、secret hash/prefix 和 active/revoked 时间，见 `packages/contracts/src/ai.ts:256-281`、`apps/api/src/modules/ai/ai.schema.ts:8-36`。认证成功后 guard 直接生成 product_app principal，没有任何 capability 数据，见 `apps/api/src/modules/ai/application/application.guard.ts:20-39`。

因此当前缺少：

- 允许的 Agent/capability ID。
- 允许的 Agent revision；现在任意 enabled Agent 的当前 revision 都能启动。
- `abort`、`steer`、`follow_up` 控制权限；现有控制方法只检查 Run scope 和 active handle，见 `apps/api/src/modules/ai/run/run.service.ts:833-877`。
- Tool side-effect 等级限制；当前只检查 Tool tenant/project scope，带 Starter permission 的 Tool 对 product_app 会被拒绝，见 `apps/api/src/modules/ai/agent/agent.service.ts:391-400`、`apps/api/src/infra/agent/pi-tool-adapter.ts:348-383`。
- 调用频率、并发数或预算上限。
- policy revision、更新时间和 policy 变更审计。现有 credential audit 只有 create/rotate/revoke，见 `apps/api/src/modules/ai/application/application.repository.ts:8-107`。

还有两个绕过点要明确处理：

- Session 的 `defaultAgentId` 只检查 Agent 是否 enabled，不检查应用 policy，见 `apps/api/src/modules/ai/session/session.service.ts:64-72`。可以允许保存但必须在 start 时拒绝，也可以在创建/更新 Session 时提前拒绝；至少 start 是强制检查点。
- product_app 可以调用 `/api/ai/completions` 并提交 model、systemPrompt 和 input，见 `apps/api/src/modules/ai/ai.route.ts:87-92`、`packages/contracts/src/ai.ts:1781-1797`。若 D3 的承诺是“第三方第一版只能调用管理员发布 Agent”，必须对 product_app 禁用 completion，不能只拦 inline Run config。inline config 已经在 `apps/api/src/modules/ai/agent/agent.service.ts:274-280` 拒绝。

### 2. 最小 policy 语义

建议 credential 保存版本化 strict JSON：

```ts
interface AiApplicationPolicyV1 {
  schemaVersion: 1
  executables: Array<{ id: string; version: number }>
  controls: Array<'abort' | 'steer' | 'follow_up'>
  maxSideEffect: 'read_only' | 'idempotent_write' | 'non_idempotent_write'
}
```

第一版只做精确 version，不做范围。调用顺序固定：

1. guard 验证 secret 并解析 policy，放入 product_app access context。
2. discovery 只返回 policy 允许且当前仍 enabled、revision 完全匹配的 manifest。
3. start 先 resolve 当前 Agent，再检查 `{id, revision}` 和 executable 聚合 side effect；检查失败发生在 reserve/Run row 前。现有 start 在 lease 前 resolve，位置合适，见 `apps/api/src/modules/ai/run/run.service.ts:227-267`。
4. abort/steer/follow-up 在查到 scoped Run 后、操作 active handle 前检查 controls。
5. rotate secret 不改变 policy；revoke 继续立即让认证失败。

policy 默认值不能是“允许全部”。对新建 credential 应要求显式 policy；存量 migration 若必须兼容，可保存当时明确选定的 Agent 列表，而不是运行时把缺省解释成 wildcard。

调用限额不应塞进上述静态 JSON 后就算完成。真正的 rate/concurrency/budget 还需要原子计数、时间窗和多实例一致性。若 D3 PRD 要求限额，建议另列可验收子项；最小 capability policy 先只做 allowlist、精确版本、controls 和 side effect。

### 3. Webhook 还缺什么

已有能力：

- body 入队后固定，签名覆盖 timestamp 和原始 body，见 `apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:43-49`、`apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:147-177`。
- 2xx 成功，失败退避，达到上限 dead，URL guard 配置错误直接 dead，见 `apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:177-228`。
- 重启后会重新扫描终态 product_app Run，唯一键避免同 endpoint/run 重复建记录，见 `apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:51-56`、`apps/api/src/modules/ai/ai.schema.ts:832-833`。

缺口：

- 只支持 `run.terminal`，不读取 `ai_run_events`。payload 没有 `eventId`、`sequence`、event protocol version、structured output reference 或 source，见 `packages/contracts/src/ai.ts:1821-1839`。
- delivery 唯一键是 `(endpointId, runId)`，同一 Run 无法投递多条订阅事件，见 `apps/api/src/modules/ai/ai.schema.ts:803-833`。
- endpoint 没有 event type 订阅字段，所有 enabled endpoint 接收同一种终态事件。
- 扫描水位只有 `finishedAt` 毫秒，查询使用严格 `>`，batch limit 为 200，见 `apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:15-16`、`apps/api/src/modules/ai/webhook/webhook.dispatcher.ts:63-124`、`apps/api/src/modules/ai/webhook/webhook.repository.ts:194-218`。如果超过 200 条 Run 共享同一 `finishedAt`，第一批推进水位后剩余记录会被跳过。游标至少要改成 `(finishedAt, runId)`。
- delivery 没有 claim/lease。多个 API 实例的 dispatcher 可能同时读取同一 pending row 并重复 POST。若部署允许多实例，需用条件更新领取 delivery；接收方仍按 delivery/event ID 做幂等。
- 没有手动 redrive dead delivery；这可以后置，不影响第一版持久事件投递。

最小事件交付建议：

- endpoint 配置允许的安全事件类型。先支持 terminal RunEvent、`structured_output.available` 和 `source.available`；不另外发模型内部原始事件。
- delivery 保存 `eventId`、`runId`、`sequence`、`eventProtocolVersion` 和 payload snapshot，唯一键改为 `(endpointId, eventId)`。
- 从 `ai_run_events` 读取已持久事件，不订阅进程内 queue；这样重启补登仍成立。`ai_run_events` 已有主键 eventId 和 `(runId, sequence)` 唯一约束，见 `apps/api/src/modules/ai/ai.schema.ts:599-614`。
- Webhook 保持 at-least-once；请求头增加稳定 delivery/event ID，第三方按它去重。
- 对 `structured_output.available` 继续使用现有 product visibility 打码。事件生成处已经在 admin visibility 时发 `value: null`，见 `apps/api/src/modules/ai/output/structured-output.tool.ts:58-69`。

### 4. SSE 还缺什么

当前 SSE writer 在 iterator 非终态结束时直接关闭，见 `apps/api/src/modules/ai/run/run-sse.ts:31-45`。subscriber queue 上限是 1024，满后关闭 transport、不 abort Run，见 `apps/api/src/modules/ai/run/run.service.ts:60-61`、`apps/api/src/modules/ai/run/run.service.ts:757-771`。客户端无法区分正常网络断开、队列 overflow 和服务端非终态 EOF。

最小修正：

- 业务事件仍是 RunEvent，不把 transport overflow 伪装成持久业务事件。
- writer 记录最后 sequence；如果 iterator 结束且没见到 terminal event，发送一个版本化 transport frame，例如 `event: stream.resume_required`，包含 `afterSequence` 和 `reason: transport_closed`，然后关闭。
- manifest 声明 `eventProtocolVersion = 1`，SSE response 同时返回协议版本 header；transport frame 使用独立 schema。
- AI/chat/flow 共用 D2 adapter 后一次实现；客户端收到该 frame 或非终态 EOF 都按 `afterSequence` 重连，无法重连时轮询 Run/live/transcript。
- flow 当前没有 `/events/stream` 恢复路由；若 flow 对外承诺 SSE 恢复，D3 应补与 AI/chat 相同的恢复端点。

### 5. 建议文件范围

Policy：

- `packages/contracts/src/ai.ts`、`packages/contracts/src/common.ts`：policy schema、DTO 和稳定 forbidden/conflict error code。
- `apps/api/src/modules/ai/ai.schema.ts`、新 Drizzle migration：credential `policy_json`；如需要独立 policy revision，再加整数列。
- `apps/api/src/modules/ai/application/application.repository.ts`、`application.service.ts`、`application.guard.ts`、`application.openapi.ts`、`application.route.ts`：保存、读取、更新和审计 policy。
- D2 新增的 `apps/api/src/modules/ai/runtime/agent-runtime.port.ts`：统一执行 allowlist/version/controls/side-effect 检查。
- `apps/api/src/modules/ai/agent/agent.service.ts`：discovery 按 policy 过滤。
- `apps/api/src/modules/ai/session/session.service.ts`：可选提前校验 defaultAgentId；start 入口仍必须再次校验。
- `apps/api/src/modules/ai/completion/completion.route.ts` 或 runtime principal guard：明确 product_app completion 禁用规则。

事件交付：

- `packages/contracts/src/ai.ts`：Webhook event envelope、endpoint subscription、delivery event identity、SSE transport frame schema。
- `apps/api/src/modules/ai/ai.schema.ts`、新 migration：endpoint event types、delivery eventId/sequence/protocol version、唯一索引和可选 claim 字段。
- `apps/api/src/modules/ai/webhook/webhook.repository.ts`、`webhook.dispatcher.ts`、`webhook.service.ts`、`webhook.openapi.ts`、`webhook.route.ts`：事件扫描、复合游标、订阅过滤和投递领取。
- `apps/api/src/modules/ai/run/run-sse.ts`、D2 的 `run-transport.ts`：协议 header 和非终态恢复提示。
- `apps/api/src/modules/flow/flow.openapi.ts`、`flow.route.ts`：只有决定补 flow 恢复端点时修改。

测试：

- `apps/api/src/test/ai-app-credentials.test.ts`
- `apps/api/src/test/ai-third-party-access.test.ts`
- `apps/api/src/test/ai-webhook.test.ts`
- `apps/api/src/test/run-event-recovery.test.ts`
- `apps/api/src/test/product-modules.smoke.test.ts`
- 建议新增 `apps/api/src/test/ai-application-policy.test.ts`，避免把所有 policy 组合继续塞进第三方大用例。

### 6. 验收测试

Policy：

- 新建/更新 credential 的 policy strict parse；未知字段、重复 executable、空版本和非法 control 返回 400。
- product_app 只能发现 policy 内且当前 revision 精确匹配的 manifest。
- 允许版本能启动；Agent revision 增加后旧 policy 在 Run row/lease 创建前返回稳定 403，不执行旧版本也不自动升级。
- 未授权 Agent、超过 `maxSideEffect` 的 Agent、未授权 abort/steer/follow-up 均返回稳定 403；同 scope 的资源存在性不向跨 scope 主体泄漏。
- Starter User 行为不受 app policy 影响。
- rotate 保留 policy，revoke 仍返回 401；policy 更新有独立审计记录。
- product_app 的 inline config 继续 403；若承诺 Agent-only，`/api/ai/completions` 对 product_app 也必须 403。

Webhook/SSE：

- endpoint 只接收订阅事件；同一 Run 的多条 event 各生成一条 delivery，重复扫描不重复插入。
- payload 的 `eventId/sequence/runId` 与 `ai_run_events` 完全一致，签名仍按原始 body 验证。
- 超过 200 条、相同时间戳的事件经过多批扫描后不丢失。
- 两个 dispatcher 并发 tick 时一条 delivery 只由一个 owner 发送；失败释放/过期后可重试。
- admin visibility structured output 的 Webhook value 为 null。
- SSE 正常 terminal 不发送 `stream.resume_required`；非终态 iterator EOF 发送恢复 frame 和最后 sequence；客户端用该 sequence 恢复后不丢不重。
- AI/chat/flow 对同一 transport 结束原因行为一致。

### 7. 明确非目标

- 不实现任意 capability 组合、workflow DSL 或远程 Tool。
- 不执行旧 Agent revision，也不做 semver/range resolver。
- 不把 policy 放进 Prompt 让模型自行遵守；所有检查都在运行入口和 controls 入口执行。
- 不承诺 exactly-once Webhook。协议是持久 at-least-once，接收方按 event/delivery ID 幂等。
- 不在第一版实现消息正文、thinking delta 或原始 Tool 参数的 Webhook 推送。
- 不在没有原子计数设计的情况下宣称已实现频率、预算或全局并发限额。
- 不修改 RunEvent 的持久化事实源，也不让 Webhook dispatcher 直接订阅进程内 Run queue。

## 依赖与交付顺序

- D1 给 D3 提供稳定 `{ executableId, version, manifestHash, controls, sideEffect }`。
- D2 给 D3 提供一个 policy 的强制检查入口，并先消除 AI/chat/flow 的 transport 重复。
- D3 不应绕过 D2 再在三个 route 各写一份 policy 判断。
- D1/D2 完成后，D3 才能用同一 manifest 和 port 同时约束第三方 HTTP、项目内产品调用和事件交付。
