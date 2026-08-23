# Web Chat 接入验证执行计划

分三段：先把协议逻辑和测试底座做出来，再接页面，最后跑验证。协议逻辑先做是因为它是纯函数，出错能被 fixture 立刻测出来，不用等页面能跑。

## 阶段一：测试底座与事件归并

- [x] `apps/web/package.json` 加 devDependency `vitest`（`catalog:`）和 `"test": "vitest run"` 脚本。
- [x] 新增 `apps/web/vitest.config.ts`：`environment: 'node'`、`globals: false`、`restoreMocks: true`、别名 `@web` 指向包根。
- [x] 新增 `apps/web/lib/ai/chat-events.ts`：状态形状 `{ lastSequence, turn, maxTurns, timeline, status, errorCode }`，导出 `createChatRunState(maxTurns)` 和 `applyHarnessEvent(state, event)`，返回新对象。
- [x] 折叠规则逐条对齐 `apps/api/src/modules/ai/run/run.live-snapshot.ts`，包括 128 条 timeline 和 64 块上限。
- [x] 新增 `apps/web/test/chat-events.test.ts`：fixture 同构、乱序去重、终态不进 timeline、超限丢最旧。
- [x] 修 `apps/api/src/modules/ai/run/run.live-snapshot.ts` 里指向已删除 Admin reducer 的注释。

阶段一验证：

```bash
pnpm --filter @starter/web test
pnpm --filter @starter/web check-types
```

## 阶段二：请求层与页面

- [x] 新增 `apps/web/lib/api/ai-chat.api.ts`：agent 列表、session 列表、创建 session、transcript、Run 详情、abort 六个 JSON 请求，走 `apiRpc` + `unwrapApiData`，用 contracts schema `safeParse` 校验，失败抛明确错误。
- [x] 新增 `apps/web/lib/ai/harness-stream.ts`：`startRunStream({ sessionId, input, agentId, signal })` 发 POST 拿 `Response`，按空行切 SSE 帧，跳过注释心跳，`harnessEventSchema.safeParse` 后逐个 yield；解析失败的帧丢弃不中断。
- [x] 新增 `app/(site)/chat/page.tsx`：Server Component，metadata 加 Chat 标题，渲染说明和客户端容器。
- [x] 新增 `app/(site)/_components/chat/chat-panel.tsx`：登录判断、Agent 下拉、输入框、发送、停止、错误与空状态、断流轮询恢复、终态后读 transcript。
- [x] 新增 `app/(site)/_components/chat/chat-timeline.tsx`：渲染 message 的 text 与折叠 thinking、tool 行、compaction 行，保留换行，不引 Markdown。
- [x] `site-nav.tsx` 的 `navItems` 加 `/chat` 入口。
- [x] 检查可访问性：发送和停止按钮有可读名称，流式区域 `aria-live="polite"`，输入框有 label。

阶段二验证：

```bash
pnpm --filter @starter/web check-types
pnpm --filter @starter/web lint
pnpm --filter @starter/web format:check
pnpm --filter @starter/web build
```

## 阶段三：全量验证

- [x] 全仓搜索确认 `apps/web` 没有导入 `@admin`、`apps/admin` 或 harness 私有模块。
- [x] 仓库级检查：`pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`git diff --check`。
- [ ] 手工验收（需要本地配好 Provider 和至少一个 enabled Agent）：发送消息看到流式输出和终态；刷新页面看到 transcript 历史；点停止后状态变成已取消；未登录时显示登录入口。

## 回滚点

- 归并结果和 fixture 对不上：先确认是不是 `message.completed` 的多 text 块规则实现错了，按 `run.live-snapshot.ts` 的注释逐条比对，不改 fixture，也不改 API 实现。
- SSE 在浏览器里读不到增量：先确认不是被 `unwrapApiData` 吞掉整个流，再确认 fetch 没有被中间层缓冲。不要退回轮询代替流式。
- 需要改运行协议：回到 API 侧改 contracts 和 API，不在 Web 侧本地扩展事件字段。
- Next.js 里放不下客户端流式消费：加 Web 自己的 server 适配层，不把应用凭据放进前端。

## 检查后的收尾改动

trellis-check 报出的问题，本次一起处理：

- `test/chat-events.test.ts` 从 4 个用例补到 12 个：只有 fixture 一条主断言时，`message.completed` 单块覆盖、thinking 的 blockIndex 定位、64 块上限、`tool.progress`、无 text 块追加这五类漂移都测不出来。补完后逐条改坏 `chat-events.ts` 验证，8 条变异全部报红。
- 点停止不再先弹「事件流已断开」：`controller.signal.aborted` 为真时不显示断流提示，终态到达后由 `finishRun` 显示「已停止生成」。分支顺序没动，aborted 分支里的 `setRunState(null)` 仍在后面，避免停止时清空已产生的输出。
- 轮询从 `setInterval` 改成 `setTimeout` 链式调度，加 token 校验，避免慢请求导致 tick 重叠、重复读 transcript。
- `run.failed` 的 API 可读说明透传到提示文案，错误码作为附注；`ChatRunState` 加 `errorMessage`。
- 409 `AI.SESSION_BUSY` 换成产品文案；为此给 `lib/http.ts` 的 `ApiRequestError` 加可选 `code` 字段，三处解析失败 envelope 时传入。
- `role="status"` 从 notice 外层容器移到内部 `<p>`，链接和按钮不再在 live region 里。
- `consumeRunStream` 和 `stop()` 加 controller 身份校验，`stop()` 改从 `sessionIdRef` 读 session，不依赖闭包时序。
- 停止按钮在 runId 到位前禁用：`run.started` 之前 abort 没有目标，只中断读流会让服务端 Run 继续跑。
- 导航入口移到 `navItems` 末尾，和页面 eyebrow 的 `CHAT / 04` 续号一致。
