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
- transcript 查询参数：lane 默认 `main`，cursor 可选非负整数，limit 默认 50、最大 200，由 `agentTranscriptQuerySchema` 校验。
- transcript 响应 `{ items, nextCursor }`；没有下一页时 nextCursor 为 null。

### 3.1 runId 读取规则

S2 契约里 user/assistant/tool item 的 `runId` 是必填 UUID，但 Pi 标准 user/assistant message entry 没有 runId 槽位。Pi SQLite backend 对 message entry 原样 JSON 持久化，因此写入侧（S6）给 message 附加字段即可承载。

S5 投影读取顺序固定：

1. `message.runId`（用 `uuidSchema` 校验，不是 UUIDv7 就丢弃）
2. `message.details.runId`

两者都缺失时，该 item 不投影并记录结构化日志（entryType、entryId、reason、sessionId、requestId），不输出 null、不编造 Run 归属。compaction system item 的 runId 契约允许 null，直接输出 null。

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
- transcript：升序、limit 分页、cursor=上一页最后一条 raw entry seq、四种 item、`starter.run.v1`/未知 entry 过滤、内部字段不泄露、非法 lane 400。
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
