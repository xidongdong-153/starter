# 执行计划

## 顺序清单

1. contracts 加查询 schema
   - `packages/contracts/src/ai.ts`：`activeAgentRunQuerySchema = z.strictObject({ lane: agentLaneSchema.default('main') })` + `ActiveAgentRunQuery` 类型，放在 `runTimelineQuerySchema` 附近。
2. api repository
   - `run.repository.ts`：接口加 `findActiveInScope`，实现里先 `sessionRepository.findInScope` 再查 `sessionId + lane + status IN ('starting','running')`，`orderBy(desc(createdAt))` 取一条。
3. api service
   - `run.service.ts`：新增 `activeRun(access, sessionId, lane)`，`requireActiveSession` → `repository.findActiveInScope` → 没有就返回 null，有就 `toAgentRun(record, readLiveSnapshot(record))`；导出到返回对象。
4. api 路由与文档
   - `run.openapi.ts`：`getActiveAgentRunRoute`，path `/api/ai/sessions/{sessionId}/active-run`，`request: { params: sessionParams, query: activeAgentRunQuerySchema }`，`200: apiSuccessResponse(agentRunSchema.nullable(), 'Session 进行中的 Agent Run', 'ActiveAgentRunResponse')`。ref 名不能和已有的 `AgentRunResponse` 撞。
   - `run.route.ts`：注册处理函数，`service.activeRun(access(c), params.sessionId, query.lane)`。
5. api 测试
   - `apps/api/src/test/run-event-recovery.test.ts` 新增一条 it，复用文件里已有的 `gate` + `delayedTextStream`（`:44`）把 Run 停在 running：
     - `GET active-run` 返回该 Run，`status` 是 `running`；
     - 同一时刻 `GET transcript` 已含本轮 `user_message`，不含 `assistant_message`；
     - 用返回的 runId 连 `events/stream?afterSequence=0`，`release()` 之后收到从 sequence 1 开始的连续事件并以终态事件收尾；
     - 终态后再 `GET active-run` 返回 null。
   - `apps/api/src/test/rpc-type.probe.ts`：按文件现有写法加一条 `C["api"]["ai"]["sessions"][":sessionId"]["active-run"]["$get"]` 存在性断言。
6. web API 客户端
   - `ai-chat.api.ts`：`getActiveAgentRun(sessionId)`，响应用 `agentRunSchema.nullable()` 校验，`cache: 'no-store'`。
7. web 恢复流
   - `run-event-stream.ts`：抽出读流与帧解析的公共部分，新增 `resumeRunStream({ sessionId, runId, afterSequence, signal })`，走 `apiRpc.api.ai.sessions[':sessionId'].runs[':runId'].events.stream.$get`，`accept: text/event-stream`。
   - `apps/web/test/run-event-stream.test.ts`：按文件现有写法（`vi.mock('@web/lib/rpc')` + `sseResponse`）加一组用例，断言 `resumeRunStream` 把 `afterSequence` 传进 query 并产出全量事件。mock 得补上 `runs[':runId'].events.stream.$get` 这条链。
8. web hook
   - `use-chat-run.ts`：`consumeRunStream` 改成 `consumeRunEvents(sessionId, events, controller, mode)`，`send` 传 `startRunStream(...)` 和 `'start'`；零事件分支按 mode 分派（`start` 抛错，`resume` 转 `beginRunPolling`）。
   - 新增 `resumeActiveRun(sessionId)`：查 active-run，null 直接返回；有 Run 就设 `running`、`runId`、`runState`，`pendingUserText` 保持 null，建 controller 存进 `streamRef`，消费 `resumeRunStream`。
   - 调用点：boot effect 里和 transcript 并行请求、拉完后调用；`selectSession` 拉完 transcript 后调用。两处都要在已有的 `active` / `selectTokenRef` 校验之后再进恢复，避免写进已经切走的会话。

## 验证命令

```bash
pnpm test     # turbo 同时跑 @starter/api 和 @starter/web 的 vitest
pnpm check    # 类型 -> lint -> format
```

手动验证（AC5、AC6）：

```bash
pnpm dev:api   # 7788
pnpm dev:web   # 4399
```

1. 在 http://localhost:4399 发一个会生成长文的问题。
2. 生成中刷新页面，确认重新加载后继续打字、没有重复的用户气泡。
3. 生成完成后确认正文与思考过程完整。
4. 再发一次长文，刷新后点停止，确认转入已中止提示。

## 风险点与回滚

- `apps/web/hooks/use-chat-run.ts` 是聊天页唯一的数据入口，改函数签名会同时影响发送路径。先保证 `send` 行为不变，再接恢复入口。hook 本身没有自动化测试（web 的 vitest 是 `environment: 'node'`，不测渲染），靠 `pnpm check` 的类型检查加上面的手动步骤。
- OpenAPI 的 nullable data：`apiSuccessResponse` 直接吃 `agentRunSchema.nullable()`，`openapi.smoke.test.ts` 只按路径断言存在性，不会因为新增路由失败；如果 schema ref 重名，报错会出现在 `/openapi.json` 请求上。
- 共享包改动后跑 web dev 前要先 `pnpm --filter @starter/contracts build`，否则 Turbopack 解析不到新导出（`.trellis/spec/web/frontend/ai-runtime-consumer.md` 第 9 节）。
- 回滚点：第 4 步之前只有新增代码，删掉即可；第 8 步是唯一改动既有逻辑的地方，回滚就是把 `consumeRunEvents` 退回原来的 `consumeRunStream` 并删掉两个调用点。

## 完成后要同步的 spec

属于 Phase 3.3，不在实现步骤里做：

- `.trellis/spec/web/frontend/ai-runtime-consumer.md`：第 3 节接口表加一行 active-run，第 2 节 Signatures 加 `resumeRunStream`，第 9 节那条「刷新后只能读 transcript」的限制要重写。
- `.trellis/spec/api/backend/agent-run-guidelines.md`：第 2 节路由清单和 repository 方法列表加新接口。顺便注意这份 spec 里的 `findOwned`、`updateTerminal` 已经和代码里的 `findInScope`、`completeWithTerminalEvent` 不一致，属于既有偏差，本次不顺手改。
