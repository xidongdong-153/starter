# Web 消费 AI 运行协议

## 1. Scope / Trigger

Web 作为产品前端消费 AI 运行时能力时用本规范。chat 和 flow 页面的运行时调用（Run 启动、事件流、transcript、Session）全部走产品面 `/api/chat/*`、`/api/flow/*`（独立 typed client），不直调 `/api/ai/*`；`/api/ai/*` 的运行时端点保留给 product_app + Bearer 和 Admin。静态资源清单是例外：`GET /api/ai/models`、`GET /api/ai/tools`、`GET /api/ai/skills` 直接走主 AppType `apiRpc`（`lib/api/ai-resources.api.ts`），这些端点本身就是 requireAuth 的用户可用面，不携带敏感数据。控制面（Provider、模型目录管理、Prompt、Skill 管理、Agent、凭据、用量）不在 Web，归 `apps/admin`。

参考实现：`app/(site)/chat/`、`app/(site)/_components/chat/`、`hooks/use-chat-run.ts`、`lib/ai/`、`lib/api/chat.api.ts`、`lib/api/flow.api.ts`。产品面服务端约定见 `.trellis/spec/api/backend/product-module-guidelines.md`。

## 2. Signatures

```ts
// lib/ai/chat-events.ts —— 纯函数，不 import React、不碰 DOM
export function createChatRunState(maxTurns?: number): ChatRunState;
export function applyRunEvent(
  state: ChatRunState,
  event: RunEvent,
): ChatRunState; // 返回新对象
export function toLiveSnapshot(state: ChatRunState): AgentRunLiveSnapshot;

// lib/ai/run-event-stream.ts
export function startRunStream(input: {
  product: 'chat' | 'flow'; // 决定走 chatRpc 还是 flowRpc
  sessionId: string;
  agentId: string;
  input: string;
  signal: AbortSignal;
}): AsyncGenerator<RunEvent>;
export function resumeRunStream(input: {
  sessionId: string;
  runId: string;
  /** 只要更大的 sequence；0 表示从 run.started 开始全量回放。 */
  afterSequence: number;
  signal: AbortSignal;
}): AsyncGenerator<RunEvent>; // 只有 Chat 页面需要接回旧流，固定走 chat 面
```

接口归属：JSON 请求放 `lib/api/chat.api.ts`、`lib/api/flow.api.ts`（各走各的 client），创建 Run 的 SSE 放 `lib/ai/run-event-stream.ts`，Run 编排放 `hooks/`，纯协议逻辑放 `lib/ai/`。已有 Run 的恢复流使用 `/events/stream` 入口，客户端不得重新 POST 创建 Run。

client 约定（`lib/rpc.ts`）：`apiRpc`（主 AppType，`@starter/api/rpc`）、`chatRpc`（`@starter/api/rpc/chat`）、`flowRpc`（`@starter/api/rpc/flow`）三个独立 client，初始化参数一致。产品面的响应 data 在类型层是 unknown，领域 API 函数用 contracts schema `safeParse` 解析（`parseApiData` 模式）；请求参数（query/param/json）有精确类型。产品路由不并入主 AppType（API 侧 TS 类型上限），所以不要用 `apiRpc` 访问 `/api/chat/*`。

## 3. Contracts

运行面认证用浏览器已有的 Better Auth Cookie（`credentials: 'include'`）。没有 `Authorization: Bearer` 头时 API 按 Starter 用户鉴权。应用凭据 secret 不进前端。

| 动作         | 接口                                                   | 响应形态                  |
| ------------ | ------------------------------------------------------ | ------------------------- |
| 可用 Agent   | `GET /api/chat/agents`（flow 页走 `/api/flow/agents`）  | 服务端已过滤 `enabled`    |
| Session 列表 | `GET /api/chat/sessions`（flow 面不暴露）              | 默认不含归档              |
| 创建 Session | `POST /api/chat/sessions`（flow 同）                   | `AgentSession`            |
| 改名 Session | `PATCH /api/chat/sessions/{sessionId}`                 | `AgentSession`，`title` trim 后 1-120 字符，至少传一个字段 |
| 归档 Session | `DELETE /api/chat/sessions/{sessionId}`                | `AgentSession`，只写 `archivedAt`，不物理删除 |
| 历史         | `GET /api/chat/sessions/{sessionId}/transcript`（flow 带 `?lane=`） | 默认最新一页，items 时间正序 |
| 进行中的 Run | `GET /api/chat/sessions/{sessionId}/active-run`         | `AgentRun \| null`，只报 `starting` / `running`，`lane` 默认 `main` |
| 启动 Run     | `POST /api/chat/sessions/{sessionId}/runs`（flow 同）   | `text/event-stream`       |
| 恢复 Run     | `GET /api/chat/sessions/{sessionId}/runs/{runId}/events/stream`（flow 面不暴露） | `text/event-stream`，支持 `afterSequence` 或 `Last-Event-ID` |
| Run 状态     | `GET /api/chat/sessions/{sessionId}/runs/{runId}`       | `AgentRun`，含可选 `live` |
| 停止生成     | `POST /api/chat/sessions/{sessionId}/runs/{runId}/abort` | `AgentRun`                |
| 结构化输出   | `GET /api/flow/sessions/{sessionId}/runs/{runId}/structured-outputs`（仅 flow） | `StructuredOutputList`    |

产品面与对应 `/api/ai/*` 端点同构（同一 service 产出），但鉴权只认 starter_user cookie，不支持 product_app Bearer。transcript 里 `images[].url` 由服务端 presenter 生成，仍是 `/api/ai/attachments/...` 路径——这是运行时数据不是前端字面量，同源策略下 Cookie 自动携带，不需要改写；`<img>` 的 src 拼接用 `attachmentContentUrl`（`/api/chat/attachments/...`）与之等价指向同一份内容。

启动 Run 的响应不是 `{ ok, data, meta }` envelope，不能过 `unwrapApiData`，它会把整个流当 JSON 读掉。因为是 POST，`EventSource` 也用不了：拿 `Response` 后自己读 `response.body`。

已有 Run 的恢复请求使用 `GET /api/chat/sessions/{sessionId}/runs/{runId}/events/stream`，可传 `afterSequence` 或 `Last-Event-ID`。恢复请求不能再次 POST 创建 Run；未知 `Last-Event-ID` 按 400 请求错误处理。

SSE 帧解析规则：

- 按空行切帧，同时兼容 `\n\n` 和 `\r\n\r\n`；`split` 后保留最后一段残帧，等下一个 chunk 拼上。
- 只取 `data:` 行，跳过 `id:`、`event:` 和以 `:` 开头的注释。API 心跳是 `": heartbeat\n\n"`，见 `apps/api/src/modules/ai/run/run.route.ts`。
- 每帧 `JSON.parse` 后用 `runEventSchema.safeParse`，失败只丢该帧，不中断整个流。
- 流结束前要能区分「收到过事件但断了」和「一个事件都没收到」。

## 4. Validation & Error Matrix

| 条件                               | 页面行为                                                          |
| ---------------------------------- | ----------------------------------------------------------------- |
| 挂载或切回会话时 `active-run` 返回 Run | 进运行中状态，连 `events/stream?afterSequence=0` 全量回放并接实时增量；不设 `pendingUserText`，这一轮的用户提问已经在 transcript 里 |
| `active-run` 返回 null             | 保持静态历史。进程重启后 Run 已被标 `interrupted`，这一轮只有用户提问没有回复 |
| 恢复流一个事件都没收到             | 不按启动失败报错，Run 刚查到还在跑，转轮询 `GET /runs/{runId}`      |
| 恢复流还没拿到响应头就被停止        | 按已中止处理并转轮询，不显示请求失败。`runId` 在查到 Run 时就已就位，这个窗口里停止按钮是可用的 |
| 收到终态事件                       | 读 transcript 最新一页替换流式视图                                |
| 流提前结束且收到过事件             | 不报错、不清空已有内容，转轮询 `GET /runs/{runId}`                 |
| 流提前结束且一个事件都没收到       | 按启动失败报错                                                    |
| 轮询拿到 `live`                    | 用 `live` 覆盖本地 timeline，API 的折叠是权威结果                  |
| 轮询拿到终态且 `live` 为 null      | 判据是 `AgentRun.status`，直接读 transcript                        |
| 用户点停止                         | 先 `abort` 接口，再 abort 本地流；不显示「事件流已断开」这类错误归因 |
| `run.started` 还没到               | 停止按钮禁用。此时 abort 没有目标，只中断读流会让服务端 Run 继续跑 |
| transcript 读取失败                | 保留流式视图，已产生的输出不清空                                  |
| 401                                | 提示重新登录并给登录入口，不清 session 之外的状态                 |
| 404（读历史 / 发送）               | 当作 Session 失效，清本地 session 引用，重新发送会新建            |
| 404（改名 / 归档）                 | 会话已不存在或被归档，从本地列表移除该条目，提示「这个对话已经不存在」 |
| 409 `AI.SESSION_BUSY`              | 换成产品文案。API 原文带「Session lane」这类内部概念              |
| `run.failed`                       | `runEventErrorSchema` 只有 `code`/`category`/`retryable`，无 message 字段：主文案用错误码组装，`terminalNotice` 支持的 `errorMessage` 参数当前恒为 null                |

错误分支按 `ApiRequestError.status` 和 contracts error code 判断，不按中文 message。需要 error code 时用 `lib/http.ts` 的 `ApiRequestError.code`。

## 5. 事件归并

折叠规则以 `apps/api/src/modules/ai/run/run.live-snapshot.ts` 为准，产出结构与 `agentRunLiveSnapshotSchema` 的 timeline 同构。两侧用 `test-fixtures/run-event-timeline-isomorphism.json` 双向校验。

必须一致的规则：

- `sequence <= lastSequence` 的事件丢弃，用于重连去重。
- `message.delta` 追加到最后一个 text 块，没有就新建。
- `thinking.*` 按 `blockIndex` 定位块，`thinking.completed` 只结束该块并保留已累积正文，不用完成事件重排或覆盖前面的增量。
- `message.completed`：只有一个 text 块就用 `content` 覆盖；没有 text 块且 `content` 非空就追加；有多个 text 块时保留 delta 累积出的顺序，不重排也不合并。
- `tool.*` 按 `toolCallId` upsert 同一个元素。
- timeline 上限 128，单条 message 的块上限 64，超限丢最旧。

允许的差异：Web 返回新对象而不是就地更新（React 需要新引用）；Web 状态额外带 `status`、`errorCode` 和 `errorMessage`，终态事件只改这三个字段，不进 timeline；`maxTurns` 从 `turn.started` 事件补齐，因为 Web 手上没有 Run snapshot。

## 6. 副作用与状态归属

- Run 相关状态全是组件或 hook 局部 state，不进全局 store、不写 localStorage。`live` 只是视图，持久事实是 `AgentRun.status`、Pi transcript 和主库记录。
- 轮询用 `setTimeout` 链式调度，不用 `setInterval`：请求慢于间隔时 tick 会重叠，重复读 transcript 和重复提示。
- 卸载、切换 session、重新发送前都要 abort 上一个流并停掉轮询。
- 会话切换 / 归档的异步操作：目标 session id 先用 ref 更新，再读 transcript；切换前 abort 旧流、停轮询，用递增 token 作废晚到的 transcript 响应；会话操作期间用互斥位（`sessionBusy`）禁住入口，结束时 `finally` 复位。
- 异步回调回来后先校验身份（`streamRef.current === controller`、轮询 token），不靠时序保证正确。
- 跨渲染读的 session id 用 ref，不从 memo 闭包读。
- 恢复入口和发送入口共用同一段事件消费逻辑，只把事件来源和「零事件怎么算」参数化。恢复走 `resumeRunStream`，发送走 `startRunStream`，两边都用 `streamRef` 存 controller，卸载、切会话、点停止的 abort 路径不分叉。
- 恢复请求放在 transcript 之后：挂载时两个请求并行发出，切会话时先渲染历史再查 `active-run`，两处都要先过失效令牌校验，再把查到的 Run 交给恢复入口。

## 7. Tests Required

`apps/web` 用 vitest，配置在 `apps/web/vitest.config.ts`，`environment: 'node'`，测试放 `apps/web/test/`。不装 jsdom 和 testing-library，不测页面渲染。

归并测试至少覆盖：

- fixture 同构：`run-event-timeline-isomorphism.json` 的完整 RunEvent 序列 apply 后与 fixture 中的 `liveSnapshot` 深度相等。
- 重复和更小的 sequence 被丢弃。
- 终态事件不进 timeline，`run.failed` 的错误码被保留（事件错误对象没有 message 字段）。
- timeline 128 上限、单条 message 64 块上限。
- fixture 覆盖不到的规则自己构造事件：`content` 与 delta 累积不一致时以 content 为准、一条 message 内两个 `blockIndex` 的 thinking 块各自累积、无 text 块时追加、`tool.progress` 写进同一个 tool。

> **Warning**: fixture 主断言只验证一份完整执行样本。delta 与完成内容不一致、多个 thinking block、重复 sequence 和 Tool progress 等边界仍需由独立用例覆盖。
>
> 判断断言强度的方法是逐条改坏 `chat-events.ts` 的规则，确认对应用例会红。

SSE 解析测试至少覆盖：心跳注释行、坏帧丢弃、`\r\n\r\n` 分隔、跨 chunk 的半帧、末帧没有结尾空行、非 2xx 错误。恢复流额外覆盖：`afterSequence` 进 query、从 sequence 1 产出到终态事件、非 2xx 抛出带 status 的错误。

## 8. Wrong vs Correct

### Wrong

```ts
const data = await unwrapApiData(chatRpc.api.chat.sessions[':sessionId'].runs.$post(...))
```

启动 Run 返回的是 SSE 流，`unwrapApiData` 会把整个流当 JSON 读掉，页面拿不到任何增量。

### Correct

```ts
const response = await chatRpc.api.chat.sessions[":sessionId"].runs.$post(
  { param: { sessionId }, json: { agentId, input } },
  { init: { headers: { accept: "text/event-stream" }, signal } },
);
if (!response.ok) throw await toApiRequestError(response);
for await (const event of startRunStream({ product: "chat", sessionId, agentId, input, signal })) {
  /* 折叠 */
}
```

### Wrong

```ts
if (!terminal) setError("运行失败，请重试");
```

流提前结束不代表 Run 失败，Run 还在后台跑。这样会把正常的断线显示成失败并丢掉已产生的内容。

### Correct

```ts
if (received > 0 && runId) {
  beginRunPolling(sessionId, runId); // 轮询 Run 状态，保留现有 timeline
  return;
}
throw new Error("Agent Run 没有产生任何事件，请稍后重试。");
```

## 9. 共享包在 dev 下的解析

`@starter/contracts` 和 `@starter/theme` 的 exports 把 `development` 条件指向 `src/index.ts`，源码内部按 NodeNext 写成 `export * from './ai.js'`。Turbopack 不把 `.js` 映射到同名 `.ts`（Next 16.2.4 没有 webpack 的 `resolve.extensionAlias`），解析结果是一个没有任何导出的模块，dev 下整站都会被 Build Error 遮住。

所以 `apps/web/next.config.ts` 用 `turbopack.resolveAlias` 把这两个包指向各自的 `dist/index.js`。改完共享包要先 `pnpm --filter @starter/contracts build`，web 的 dev 才能看到。

不要试图去掉源码里的 `.js` 扩展：`apps/api` 的 tsc 直接按 NodeNext 编译 contracts 源码（`tsc --traceResolution` 能看到它解析到 `packages/contracts/src/index.ts`），NodeNext 要求显式扩展名，去掉会让 `pnpm --filter @starter/api check-types` 报一百多个 TS2305。

> **Warning**: 这类问题五条常规命令都抓不到。`pnpm build` 走 production 条件读 `dist`，`tsc` 和 vitest 会做 `.js` 到 `.ts` 的扩展名替换，只有 `pnpm dev` 会炸。web 第一次从共享包做值导入（而不是 `import type`）时必须起一次 dev 页面验证。

## 10. 边界

- 会话列表、切换、改名、归档已支持（`lib/ai/chat-session-view.ts` 负责列表纯函数，`use-chat-run.ts` 负责状态与异步编排）。steer、follow-up、transcript 翻页、多 lane 视图仍不在范围内。
- Thinking 折叠展示，Tool 显示名称、状态和 `safeSummary`，Compaction 显示一行说明。不引 Markdown 渲染器和 Chat SDK。
- 刷新页面时这一轮还在跑，页面会用 `GET /active-run` 找回 runId 并接回事件流继续渲染。会话列表不标记哪个会话在跑，进终态的 Run 也没有重新回放入口。
- 多节点客户端编排已由 `/flow` 页面承担（`app/(site)/_components/flow/`、`lib/flow/`、`hooks/use-flow-run.ts`）：画布定义存 localStorage（`web-agent-flow/v1`），运行时新建 Session，每步用 lane `flow-<序号>` 启动 Run，幂等键 `flowRunId-序号`，从失败节点重试时追加 `-rN` 换新 key（failed Run 同 key 会命中旧 Run）。flow 页的 HTTP 调用全部走 `/api/flow/*`（`lib/api/flow.api.ts`，`flowRpc` client，transcript 按 lane 读取）；flow 面没有 active-run 和 events/stream 恢复入口，页面刷新即丢运行态；画布运行态不持久化，服务端 Session/transcript 是持久事实。模型/工具/技能清单例外，走 `apiRpc`（见第 1 节）。
- flow 画布的 Agent 节点有两种模式（`flow-document.ts` 的 `FlowAgentNodeData`）：预设模式存 `agentId`，自定义模式存 `config`（`FlowAgentInlineConfig`，字段对齐契约 `InlineAgentRunConfig`）。`config` 字段存在即自定义模式。运行时 `use-flow-run.ts` 的 `FlowChainStep.target` 二选一：`{ agentId }` 或 `{ config }`，透传给 `startRunStream`；两者都缺时由 `flow-workspace.tsx` 运行前校验拦截（自定义节点必须有 model 和非空 systemPrompt）。
- Agent 节点有必填展示名 `name`（trim 后最长 60，空串合法）：非空时画布节点标题、Inspector 标题和模板编辑器变量标签（`flow-prompt-editor.tsx`，`stepNames` 按链上序号传入，标签显示「XXX 产出」）显示名称，空串回落 `Agent <链上序号>`；`flow-validate.ts` 报错用 `节点"XXX"` 定位。`name` 纯展示，不进 `startRunStream` 请求体。schema 是 `strictObject`，节点缺 `name` 的旧 localStorage 文档整体丢弃（`load()` 返回空列表），与 `config` 的 optional 软兼容不同，这是 09-01 任务确认的破坏性改造，无迁移。新增 agent 节点的构造点共三处：`createFlowDocument`、`flow-canvas.tsx` 快捷追加与工具栏新增、`flow-templates.ts` 模板节点（模板节点带语义名）。

## 11. 图片附件（Chat 输入）

### Signatures

```ts
// lib/api/chat-attachments.api.ts
export async function uploadAiAttachment(file: File, sessionId?: string): Promise<AiAttachment>;
export function attachmentContentUrl(attachmentId: string): string;

// lib/ai/attachment-input.ts —— 纯逻辑，MIME 白名单读 contracts 的 aiAttachmentMimeTypeSchema.options
export function selectUploadableImages(files: File[]): { accepted: File[]; rejected: File[] };

// hooks/use-chat-attachments.ts —— 待发送附件状态：预校验 → 上传 → 缩略图，失败移除并提示
```

### Contracts

- 上传走 `apiRequest`（multipart `POST /api/chat/attachments`，带当前 sessionId）；鉴权是 Cookie 会话，与 run 请求一致，`Authorization: Bearer` 不进前端
- 预校验规则与服务端同源：MIME 白名单四种、单张 5MB、待发送最多 4 张；超限前端直接提示，不发请求
- 发送：`startRunStream` 请求体带 `attachmentIds`（contracts schema 已有该字段）；不传时请求体与纯文本现状一致
- 图片显示：`<img src={attachmentContentUrl(id)}>` 直连 content 端点，同站 Cookie 自动携带；transcript 的 `images[].url` 与该构造点拼出同一字符串
- Web Chat 只调 startRun，steer / followUp 不在 Web 范围（见第 10 节）

### 状态归属

- 待发送附件是 composer 局部状态（hook），发送成功清空；`send` 返回 false 时回填，用户重试不用重新上传
- 切换、新建、归档会话时显式清空待发送附件，避免跨会话越权引用（挂旧 session 的附件在新 session 的 startRun 会被 API 404）
- `canSend` = 非 running + 无上传中 + 有文本 + 有 agent

### Tests Required

`apps/web/test/attachment-input.test.ts`（预校验规则）与 `apps/web/test/chat-attachments.test.ts`（上传表单组装、错误码透传、`startRunStream` 请求体含/不含 `attachmentIds`）。只测纯逻辑，不测 DOM（同第 7 节约束）。

### Wrong vs Correct

Wrong（前端手写白名单，与服务端漂移）：

```ts
const ALLOWED = ["image/jpeg", "image/png"] // 少了 webp/gif，服务端收得到前端却拒绝
```

Correct（单一事实源）：

```ts
import { aiAttachmentMimeTypeSchema } from "@starter/contracts";
const allowed = aiAttachmentMimeTypeSchema.options;
```

Wrong（切会话后沿用旧附件）：

```ts
// session 切换只清空文本，附件留在待发送区，下一次 startRun 引用旧 session 的附件
```

Correct（切会话同步清空附件）：

```ts
// 切换 / 新建 / 归档会话时调用 attachments.clear()
```
