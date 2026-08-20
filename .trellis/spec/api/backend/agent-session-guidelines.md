# API AgentSession 子域规范

改 `apps/api/src/modules/ai/session/` 时按本规范。S5 完成 Session 业务索引、用户归属、创建补偿、transcript 投影和只读一致性检查；Run 启动与转录写入由 S6 负责。

公开 DTO、输入、字段限制和 transcript union 以共享契约为准：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md` 第 3 节。本文件只记实现层约定。

## 1. Scope / Trigger

- 新增或改动 Session 的 repository、service、route、presenter、OpenAPI 或测试。
- 改动 `ai_agent_sessions` 表或 Session 相关的双库交互（补偿、一致性检查）。
- 不需要本规范：只读改动 AgentDefinition、，或后端无关的前端页面。

## 2. Signatures

```ts
interface AiAgentSessionService {
  create(input: CreateAgentSessionInput, ownerId: string, requestId?: string): Promise<AgentSession>
  list(ownerId: string, query: AgentSessionListQuery): { items, total, page, pageSize }
  get(ownerId: string, sessionId: string): AgentSession
  update(ownerId: string, sessionId: string, input: UpdateAgentSessionInput): Promise<AgentSession>
  archive(ownerId: string, sessionId: string): AgentSession
  transcript(ownerId: string, sessionId: string, query: AgentTranscriptQuery, requestId?: string): Promise<AgentTranscript>
  checkConsistency(): Promise<{ missingInPi: string[], missingInMain: string[] }>
}
```

Repository 方法与 Pi Session store 接口见 `apps/api/src/modules/ai/session/session.repository.ts` 和 `apps/api/src/infra/agent/pi-session-store.ts`。

Route 六个 endpoint：

```text
POST   /api/ai/sessions
GET    /api/ai/sessions
GET    /api/ai/sessions/{sessionId}
PATCH  /api/ai/sessions/{sessionId}
DELETE /api/ai/sessions/{sessionId}
GET    /api/ai/sessions/{sessionId}/transcript
```

## 3. Contracts

- `ai_agent_sessions` 只存索引：id、owner_id、title、default_agent_id、archived_at、created_at、updated_at。message、Tool 结果、lane tree 和完整 transcript 不进主库。
- Session id 与 Pi Session id 是同一个 UUIDv7，由 Starter 生成，创建时传给 `agentSessionStore.createSession({ id })`。
- 默认列表排除已归档。title 未传时用「新会话」。`defaultAgentId` 非空必须指向已启用的 Agent。
- transcript 查询参数：lane 默认 `main`，cursor 可选非负整数，limit 默认 50、最大 200，direction 默认 `backward`，由 `agentTranscriptQuerySchema` 校验。
- transcript 响应 `{ items, nextCursor }`，items 始终是时间正序。读取时向 Pi Session store 请求 `limit + 1` 条，只有确实读到额外 entry 才返回 nextCursor，否则为 null。hasMore 按 raw entry 数量判，不是投影后的 item 数量。
- 两个方向的语义：`backward` 用 Pi 的 `newestFirst` 读（该方向下 `cursor.afterSeq` 取的是 `entry.seq < afterSeq`，也就是更早的），服务端反转成正序后返回，`nextCursor` 是本页最早一条 raw entry 的 seq，用于继续往更早翻；`forward` 用 `oldestFirst`，`nextCursor` 指向更新的一页。首屏不传 cursor 时 `backward` 返回最新一页。

### 3.1 runId 读取规则

S2 契约里 user/assistant/tool item 的 `runId` 是必填 UUID，但 Pi 标准 user/assistant message entry 没有 runId 槽位。Pi SQLite backend 对 message entry 原样 JSON 持久化，因此写入侧（S6）给 message 附加字段即可承载。

S5 投影读取顺序固定：

1. `message.runId`（用 `uuidSchema` 校验，不是 UUIDv7 就丢弃）
2. `message.details.runId`

两者都缺失时，该 item 不投影并记录结构化日志（entryType、entryId、reason、sessionId、requestId），不输出 null、不编造 Run 归属。compaction system item 的 runId 契约允许 null，直接输出 null。

### 3.2 assistant 与 system item 的可选字段

三个字段都从已持久化的 Pi entry 读，不新增数据源，都是 optional：

- `assistant_message.usage`：读 Pi `AssistantMessage.usage`，字段名映射为 `AiUsage`（`input` -> `inputTokens`、`totalTokens` -> `totalTokens` 等）。非非负整数一律输出 null，不补 0。
- `assistant_message.toolCalls`：从 `message.content` filter `type === 'toolCall'`，只取 `{ toolCallId, name }`，最多 64 条。**不取 `arguments`**，入参属于脱敏边界内的数据。`toolCallId` 与对应 `tool_activity` item 的 `toolCallId` 一致，客户端靠它建关联。
- `system.tokensBefore`：读 `CompactionEntry.tokensBefore`，同样只接受非负整数。

`content` 字段语义不变，仍然只拼 text block。顺序信息走另一个可选字段 `blocks`：按 `message.content` 原顺序把 `TextContent` 和 `ThinkingContent` 投成 `{ type, text }` 块数组（上限 64），toolCall 块不进 `blocks`，继续只走 `toolCalls`。只带 toolCall 的 assistant message 投出来是 `content: ''` + `blocks: []`，客户端不能把这种空消息当成「还在生成中」渲染。

## 4. Validation & Error Matrix

| 条件 | HTTP | Error code |
| --- | --- | --- |
| 未登录 | 401 | 既有 `AUTH.UNAUTHENTICATED` |
| `defaultAgentId` 引用的 Agent 不存在 | 400 | `COMMON.INVALID_REQUEST` |
| `defaultAgentId` 引用的 Agent 存在但非 enabled | 409 | `AI.AGENT_NOT_ENABLED` |
| Session 不存在、属他人或已归档 | 404 | `COMMON.NOT_FOUND` |
| 创建顺序先 Pi 后主库，Pi Session 创建失败 | 500 | `AI.SESSION_STORAGE_FAILED` |
| 主库 insert 失败（补偿删除 Pi Session 后） | 500 | `SYSTEM.INTERNAL_ERROR` |
| transcript 读取失败 | 500 | `AI.SESSION_STORAGE_FAILED` |

## 5. Good / Base / Bad

- Good：`PATCH` 先做资源存在性检查（`requireActiveSession`）再校验输入，保证不存在/他人/已归档 session 的任何 payload 都返回 404。
- Good：repository 的 find/update/archive 都带 `id + ownerId` 双条件，不先查全局 id 再比较 owner，避免暴露资源存在性。
- Good：创建失败补偿只删本次刚创建的 Pi Session；补偿删除失败必须记录 sessionId 和 cause。
- Base：DELETE 只归档主库索引，幂等（已归档再次 DELETE 返回 200），Pi history 保留。
- Base：一致性检查列出主库全部 Session id（含已归档，归档不删 Pi）与 Pi metadata id，只报告两类 orphan，不修改数据。
- Bad：把 Pi entry 的 `details`、Tool arguments 或 Provider 信息放进 transcript DTO。

## 6. Tests Required

`apps/api/src/test/ai-agent-sessions.test.ts` 覆盖：

- 创建后主库与 Pi DB 同一 id；列表/详情/更新/归档；归档幂等；归档不出现在默认列表且 Pi history 保留。
- owner 隔离：他人 GET / PATCH / transcript 返回 404，不能靠 id 探测。
- `defaultAgentId`：不存在 400、非 enabled 409、enabled 成功。
- 主库失败补偿删除 Pi Session；补偿失败日志带 sessionId 与 cause（用 fake repository + fake session store 直接测 service）。
- transcript：升序、limit 分页、cursor=上一页最后一条 raw entry seq、只有多读到一条 raw entry 时才返回 nextCursor、原始 entry 数量刚好等于 limit 时 nextCursor 为 null、四种 item、`starter.run.v1`/未知 entry 过滤、内部字段不泄露、非法 lane 400。
- 分页方向：`direction=backward` 首屏返回最新一页且是时间正序、带 cursor 时返回更早一页、没有更早内容时 nextCursor 为 null；`direction=forward` 行为与改动前一致。
- assistant item 的 `usage` 和 `toolCalls`、system item 的 `tokensBefore` 都能读到；toolCall block 带 `arguments` 时投影结果不得包含入参，`toolCallId` 与对应 `tool_activity` item 一致。
- assistant item 的 `blocks` 按 `message.content` 原顺序输出（含 text 与 thinking 交错的情况），`content` 仍然只有正文。
- 一致性检查两方向 orphan 且不修改数据。

## 7. Wrong vs Correct

错误写法先校验 `defaultAgentId` 再查 Session 归属，导致对已归档 session 发无效 defaultAgentId 时返回 409 而非 404：

```ts
await assertDefaultAgent(input.defaultAgentId)   // 先校验输入
repository.updateOwned({ id: sessionId, ownerId, ... })  // 才 404
```

正确写法先确认资源存在且未归档，再校验输入：

```ts
requireActiveSession(ownerId, sessionId)         // 不存在/他人/已归档 → 404
await assertDefaultAgent(input.defaultAgentId)
repository.updateOwned({ id: sessionId, ownerId, ... })
```
