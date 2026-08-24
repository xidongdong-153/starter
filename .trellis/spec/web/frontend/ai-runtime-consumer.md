# Web 消费 AI 运行协议

## 1. Scope / Trigger

Web 作为产品前端调用 AI Runtime API（Agent Session、Agent Run、HarnessEvent SSE、Transcript）时用本规范。控制面（Provider、模型、Prompt、Skill、Agent、凭据、用量）不在 Web，归 `apps/admin`。

参考实现：`app/(site)/chat/`、`app/(site)/_components/chat/`、`hooks/use-chat-run.ts`、`lib/ai/`、`lib/api/ai-chat.api.ts`。

## 2. Signatures

```ts
// lib/ai/chat-events.ts —— 纯函数，不 import React、不碰 DOM
export function createChatRunState(maxTurns?: number): ChatRunState;
export function applyHarnessEvent(
  state: ChatRunState,
  event: HarnessEvent,
): ChatRunState; // 返回新对象
export function toLiveSnapshot(state: ChatRunState): AgentRunLiveSnapshot;

// lib/ai/harness-stream.ts
export function startRunStream(input: {
  sessionId: string;
  agentId: string;
  input: string;
  signal: AbortSignal;
}): AsyncGenerator<HarnessEvent>;
```

接口归属：JSON 请求放 `lib/api/*.api.ts`，SSE 放 `lib/ai/harness-stream.ts`，Run 编排放 `hooks/`，纯协议逻辑放 `lib/ai/`。

## 3. Contracts

运行面认证用浏览器已有的 Better Auth Cookie（`credentials: 'include'`）。没有 `Authorization: Bearer` 头时 API 按 Starter 用户鉴权。应用凭据 secret 不进前端。

| 动作         | 接口                                                   | 响应形态                  |
| ------------ | ------------------------------------------------------ | ------------------------- |
| 可用 Agent   | `GET /api/ai/agents`                                   | 服务端已过滤 `enabled`    |
| Session 列表 | `GET /api/ai/sessions`                                 | 默认不含归档              |
| 创建 Session | `POST /api/ai/sessions`                                | `AgentSession`            |
| 改名 Session | `PATCH /api/ai/sessions/{sessionId}`                   | `AgentSession`，`title` trim 后 1-120 字符，至少传一个字段 |
| 归档 Session | `DELETE /api/ai/sessions/{sessionId}`                  | `AgentSession`，只写 `archivedAt`，不物理删除 |
| 历史         | `GET /api/ai/sessions/{sessionId}/transcript`          | 默认最新一页，items 时间正序 |
| 启动 Run     | `POST /api/ai/sessions/{sessionId}/runs`               | `text/event-stream`       |
| Run 状态     | `GET /api/ai/sessions/{sessionId}/runs/{runId}`         | `AgentRun`，含可选 `live` |
| 停止生成     | `POST /api/ai/sessions/{sessionId}/runs/{runId}/abort`  | `AgentRun`                |

启动 Run 的响应不是 `{ ok, data, meta }` envelope，不能过 `unwrapApiData`，它会把整个流当 JSON 读掉。因为是 POST，`EventSource` 也用不了：拿 `Response` 后自己读 `response.body`。

SSE 帧解析规则：

- 按空行切帧，同时兼容 `\n\n` 和 `\r\n\r\n`；`split` 后保留最后一段残帧，等下一个 chunk 拼上。
- 只取 `data:` 行，跳过 `id:`、`event:` 和以 `:` 开头的注释。API 心跳是 `": heartbeat\n\n"`，见 `apps/api/src/modules/ai/run/run.route.ts`。
- 每帧 `JSON.parse` 后用 `harnessEventSchema.safeParse`，失败只丢该帧，不中断整个流。
- 流结束前要能区分「收到过事件但断了」和「一个事件都没收到」。

## 4. Validation & Error Matrix

| 条件                               | 页面行为                                                          |
| ---------------------------------- | ----------------------------------------------------------------- |
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
| `run.failed`                       | 透传 `data.error.message` 当主文案，错误码作为附注                |

错误分支按 `ApiRequestError.status` 和 contracts error code 判断，不按中文 message。需要 error code 时用 `lib/http.ts` 的 `ApiRequestError.code`。

## 5. 事件归并

折叠规则以 `apps/api/src/modules/ai/run/run.live-snapshot.ts` 为准，产出结构与 `agentRunLiveSnapshotSchema` 的 timeline 同构。两侧用 `test-fixtures/harness-timeline-isomorphism.json` 双向校验。

必须一致的规则：

- `sequence <= lastSequence` 的事件丢弃，用于重连去重。
- `message.delta` 追加到最后一个 text 块，没有就新建。
- `thinking.*` 按 `blockIndex` 定位块，`thinking.completed` 用 `content` 覆盖。
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

## 7. Tests Required

`apps/web` 用 vitest，配置在 `apps/web/vitest.config.ts`，`environment: 'node'`，测试放 `apps/web/test/`。不装 jsdom 和 testing-library，不测页面渲染。

归并测试至少覆盖：

- fixture 同构：18 个事件 apply 后与 `liveSnapshot` 深度相等。
- 重复和更小的 sequence 被丢弃。
- 终态事件不进 timeline，`run.failed` 的 message 被保留。
- timeline 128 上限、单条 message 64 块上限。
- fixture 覆盖不到的规则自己构造事件：`content` 与 delta 累积不一致时以 content 为准、一条 message 内两个 `blockIndex` 的 thinking 块各自累积、无 text 块时追加、`tool.progress` 写进同一个 tool。

> **Warning**: 只写 fixture 那一条主断言是不够的。fixture 里 `message.completed` 的 content 和 delta 恰好相同、每条 message 只有一个 thinking 块、没有 `tool.progress`，所以五类折叠漂移都不会被测出来。
>
> 判断断言强度的方法是逐条改坏 `chat-events.ts` 的规则，确认对应用例会红。

SSE 解析测试至少覆盖：心跳注释行、坏帧丢弃、`\r\n\r\n` 分隔、跨 chunk 的半帧、末帧没有结尾空行、非 2xx 错误。

## 8. Wrong vs Correct

### Wrong

```ts
const data = await unwrapApiData(apiRpc.api.ai.sessions[':sessionId'].runs.$post(...))
```

启动 Run 返回的是 SSE 流，`unwrapApiData` 会把整个流当 JSON 读掉，页面拿不到任何增量。

### Correct

```ts
const response = await apiRpc.api.ai.sessions[":sessionId"].runs.$post(
  { param: { sessionId }, json: { agentId, input } },
  { init: { headers: { accept: "text/event-stream" }, signal } },
);
if (!response.ok) throw await toApiRequestError(response);
for await (const event of readHarnessEvents(response.body)) {
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

## 9. 边界

- 会话列表、切换、改名、归档已支持（`lib/ai/chat-session-view.ts` 负责列表纯函数，`use-chat-run.ts` 负责状态与异步编排）。steer、follow-up、transcript 翻页、多 lane 视图仍不在范围内。
- Thinking 折叠展示，Tool 显示名称、状态和 `safeSummary`，Compaction 显示一行说明。不引 Markdown 渲染器和 Chat SDK。
- 刷新页面时如果 Run 还在跑，只能读 transcript，看不到进行中的输出。运行面没有「列出某 Session 的 Run」接口，接回需要先改 API。
