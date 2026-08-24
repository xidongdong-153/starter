# Implement：Web 端 Agent 会话列表与切换、改名、归档

## 前置

只改 `apps/web`。开工前读 `.trellis/spec/web/frontend/ai-runtime-consumer.md`，本任务会突破它第 9 节写的边界（「Session 列表切换不在范围内」），完成后必须按 Phase 3.3 更新这份 spec。

## 执行清单

- [ ] 1. `apps/web/lib/api/ai-chat.api.ts`：新增 `renameAgentSession(sessionId, title)` 走 `PATCH`、`archiveAgentSession(sessionId)` 走 `DELETE`，都用 `agentSessionSchema` 校验响应，沿用 `unwrapApiData` + `parseApiData`。
- [ ] 2. `apps/web/lib/ai/chat-session-view.ts`（新增）：`upsertSession`、`removeSession`、`pickNextSessionId` 三个纯函数，不 import React。
- [ ] 3. `apps/web/test/chat-session-view.test.ts`（新增）：覆盖已存在时原位替换、不存在时插首位、按 id 移除、归档后取剩余首条、空列表返回 null。
- [ ] 4. `apps/web/hooks/use-chat-run.ts`：
      - 启动时保存整个列表和 `total`，不再只留 `items[0]`
      - 新增 `sessionBusy` 与 `selectSession`、`startNewSession`、`renameSession`、`archiveSession`
      - `selectSession` 用递增 token 作废晚到的 transcript 响应，切换前 `stopPolling()` 并 abort 上一条流（`ai-runtime-consumer.md` 第 6 节要求）
      - `send` 成功创建新会话后 `upsertSession` 插入列表并选中
      - `finishRun` 结束后重拉一次列表，失败只提示不清空
      - 导出 `canMutateSessions = boot === 'ready' && !running && !sessionBusy`
- [ ] 5. `apps/web/app/(site)/_components/chat/chat-session-bar.tsx`（新增）：原生 `select` + 新建、改名、归档按钮；改名切行内输入框（trim 后空或 >120 字符时本地拦截）；归档二段确认；`total > sessions.length` 时显示总数提示；控件禁用由 `canMutateSessions` 决定。
- [ ] 6. `apps/web/app/(site)/_components/chat/chat-panel.tsx`：在时间线上方装配 `ChatSessionBar`，只传 props，不放业务逻辑。
- [ ] 7. 更新 `.trellis/spec/web/frontend/ai-runtime-consumer.md`：边界一节去掉「Session 列表切换」，第 3 节补 `PATCH` / `DELETE` 两行契约，第 4 节补会话操作的 404 行为。

## 验证命令

按顺序跑，前一项过了再跑下一项：

```bash
pnpm --filter @starter/web check-types
pnpm --filter @starter/web lint
pnpm --filter @starter/web test
pnpm format:check
```

手动验证（`pnpm dev:api` + `pnpm dev:web`，登录后开 http://localhost:4399/chat ）：

1. 会话选择器有历史会话，默认选中最近一条，时间线是它的历史。
2. 切换会话后时间线跟着换，切回来内容一致。
3. 「新建对话」不发请求（Network 面板确认），发送首条消息后新会话出现在列表首位。
4. 改名保存后标题立即变化，刷新页面仍在；空标题和超长标题被本地拦截。
5. 归档当前会话后它消失，时间线切到剩余首条；归档最后一条回到空态。
6. Run 运行中会话区四个控件禁用，停止生成可用；结束后恢复并且顺序、标题与服务端一致。

## 风险点与回滚

| 风险 | 位置 | 处理 |
| --- | --- | --- |
| 晚到的 transcript 覆盖新会话 | `use-chat-run.ts` `selectSession` | 递增 token 校验 |
| 归档后仍向旧会话发请求 | `use-chat-run.ts` `archiveSession` | 先 `rememberSession(next)` 再读 transcript |
| `sessionBusy` 卡住 | 所有会话异步动作 | `finally` 复位 |
| 破坏现有 Run 流程 | `use-chat-run.ts` | 不动 `consumeRunStream`、`beginRunPolling`、`finishRun` 的内部折叠逻辑，只在末尾加重拉列表 |

回滚：`git checkout -- apps/web/hooks/use-chat-run.ts apps/web/lib/api/ai-chat.api.ts apps/web/app/\(site\)/_components/chat/chat-panel.tsx` 并删除三个新增文件。

## 完成前确认

- [ ] `apps/api`、`packages/contracts` 没有改动（`git status` 确认）
- [ ] 新增纯函数有测试，且测试在 `apps/web/test/` 下、不依赖 jsdom
- [ ] spec 的边界描述已更新，没留下和实现矛盾的句子
