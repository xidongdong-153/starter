# Harness 跨任务契约

## 用途

本文是 S1 至 S7 的共享实施基准。S1 按本文提供 terminal entry 存储接口；S2 创建公开 Zod schema 和 Drizzle schema；S3 至 S7 只使用 S2 已导出的名称和字段，不在各自任务中重新定义协议。

如果实施时发现 Pi API 无法支持某个字段或顺序，停止当前子任务并回到父任务修改本文。不得在单个子任务中静默更名、删字段或增加第二套事件。

## 1. 通用字段

| 字段 | 约束 |
| --- | --- |
| 公开 id | `uuidSchema`，由 Starter 生成 UUIDv7 |
| 公开时间 | `isoDateTimeSchema`，UTC ISO 8601 字符串 |
| 数据库时间 | SQLite `timestamp_ms` |
| `schemaVersion` | 当前固定为字面量 `1` |
| `lane` | 默认 `main`；1 至 64 字符；首字符为字母或数字；其余字符只允许字母、数字、点、下划线和连字符 |
| Session 标题 | trim 后 1 至 120 字符 |
| Agent 名称 | trim 后 1 至 80 字符；数据库唯一 |
| Agent 描述 | 最多 500 字符，空值保存为空字符串 |
| Run 输入 | trim 后 1 至 100000 字符 |
| cursor | 上一页最后一项的 `sequence`；下一页只返回 `sequence > cursor` 的项目 |

所有输入 object 使用严格 schema。未知字段、secret、Pi 类型、数据库 record 和文件路径都不得进入公开 contracts。

## 2. AgentDefinition

### 2.1 配置

`agentDefinitionConfigSchema` 的精确字段：

```ts
{
  schemaVersion: 1
  model: AiModelRef | null
  systemPromptId: string | null
  skillIds: string[]
  toolNames: string[]
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTurns: number
}
```

- `skillIds` 最多 64 项，每项为 UUIDv7，不允许重复。
- `toolNames` 最多 64 项，每项 trim 后 1 至 240 字符，不允许重复。
- `maxTurns` 是 1 至 32 的整数。
- `model` 允许在 draft 阶段为空；启用 Agent 前必须解析为可用模型。
- 配置不保存 Prompt 内容、Skill 内容、Tool schema、Provider credential 或任意 secret。
- 默认 draft 配置为 `{ schemaVersion: 1, model: null, systemPromptId: null, skillIds: [], toolNames: [], thinkingLevel: 'off', maxTurns: 8 }`。

### 2.2 DTO

`AgentDefinitionSummary`：

```ts
{
  id: string
  name: string
  description: string
  status: 'draft' | 'enabled' | 'disabled'
  revision: number
  createdAt: string
  updatedAt: string
}
```

`AgentDefinitionDetail` 在 Summary 基础上增加 `config: AgentDefinitionConfig`。普通用户的 enabled Agent 列表和详情只返回 Summary；Admin 接口返回 Detail。

列表查询为 `page` 默认 1、`pageSize` 默认 20 且最大 100。列表响应为 `{ items, total, page, pageSize }`；公开列表的 items 是 Summary，Admin 列表的 items 是 Detail。

创建输入包含 `name`、可选 `description` 和可选 `config`。未传配置时使用 S2 导出的默认 draft 配置。更新输入允许修改 `name`、`description`、`config` 中至少一项；状态通过独立 `{ status }` 输入修改。

## 3. AgentSession

### 3.1 DTO 与输入

`AgentSession`：

```ts
{
  id: string
  title: string
  defaultAgentId: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}
```

- 创建输入：`{ title?: string, defaultAgentId?: string | null }`。
- 更新输入：`{ title?: string, defaultAgentId?: string | null }`，至少包含一项。
- 列表查询：`page` 默认 1，`pageSize` 默认 20、最大 100；默认排除已归档 Session。
- transcript 查询：`lane` 默认 `main`，`cursor` 可选且为非负整数，`limit` 默认 50、最大 200。
- transcript 响应：`{ items, nextCursor }`；没有下一页时 `nextCursor` 为 null。
- 未传 title 时服务端使用 `新会话`。非空 `defaultAgentId` 在写入时必须指向 enabled Agent；Agent 后续被停用时保留引用，但新 Run 会返回 `AI.AGENT_NOT_ENABLED`。
- Session 列表响应为 `{ items, total, page, pageSize }`。

`ownerId`、Pi metadata 和存储路径不进入 DTO。

### 3.2 Transcript item

所有 item 共享：

```ts
{
  id: string
  sequence: number
  lane: string
  runId: string | null
  createdAt: string
  type: string
}
```

`sequence` 使用 Pi entry 的全局 `seq`，响应按升序排列。公开 union 固定为：

```ts
type AgentTranscriptItem =
  | {
      type: 'user_message'
      id: string
      sequence: number
      lane: string
      runId: string
      createdAt: string
      content: string
    }
  | {
      type: 'assistant_message'
      id: string
      sequence: number
      lane: string
      runId: string
      createdAt: string
      content: string
      status: 'completed' | 'failed' | 'aborted' | 'interrupted'
      model: AiModelRef
      stopReason: 'stop' | 'length' | 'tool_use' | null
      errorCode: ApiErrorCode | null
    }
  | {
      type: 'tool_activity'
      id: string
      sequence: number
      lane: string
      runId: string
      createdAt: string
      toolCallId: string
      name: string
      status:
        | 'succeeded'
        | 'not_found'
        | 'invalid_arguments'
        | 'forbidden'
        | 'failed'
        | 'timed_out'
        | 'cancelled'
        | 'interrupted'
      errorCode: ApiErrorCode | null
      safeSummary: string | null
    }
  | {
      type: 'system'
      id: string
      sequence: number
      lane: string
      runId: string | null
      createdAt: string
      kind: 'compaction'
      summary: string
    }
```

- message item 的 `id` 同时是 `messageId` 和 Pi entry id。
- Tool item 的 `id` 是承载 Tool 结果的 Pi entry id；`toolCallId` 用于关联同一次 Tool 生命周期。
- `safeSummary` 最多 1000 字符，不返回 Tool arguments、模型可见结果或 Pi `details`。
- `starter.run.v1` 不投影为 transcript item。
- 未识别的 Pi entry 默认跳过并记录 entry type、entry id 和 requestId；不得把原始 entry 放入响应。

## 4. AgentRun

### 4.1 Snapshot

`agentRunSnapshotSchema` 是严格的无 secret schema：

```ts
{
  schemaVersion: 1
  agentId: string
  agentRevision: number
  model: AiModelRef
  systemPromptId: string | null
  skillIds: string[]
  toolNames: string[]
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTurns: number
}
```

Snapshot 保存已选模型和配置引用，不保存解析后的 Prompt/Skill 内容、Tool schema 或 credential。

### 4.2 DTO 与输入

`AgentRun`：

```ts
{
  id: string
  sessionId: string
  agentId: string
  agentRevision: number
  lane: string
  status: 'starting' | 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted'
  snapshot: AgentRunSnapshot
  requestId: string
  finalEntryId: string | null
  errorCode: ApiErrorCode | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
```

- 启动输入：`{ agentId?: string, lane?: string, input: string }`。没有 `agentId` 时使用 Session 的 `defaultAgentId`；两者都为空时返回 `COMMON.INVALID_REQUEST`。
- abort 无 request body。
- steer 和 follow-up 输入均为 `{ text: string }`，复用 Run 输入文本限制。
- Run 状态和 transcript 只允许通过 Session owner 读取，不导出 `ownerId`。

### 4.3 终态约束

- `completed`：`finalEntryId` 非空，`errorCode` 为空。
- `failed`：`errorCode` 非空，`finalEntryId` 可以为空或指向已保存的 partial assistant entry。
- `aborted`：`errorCode` 固定为 `AI.REQUEST_ABORTED`，`finalEntryId` 可以为空。
- `interrupted`：`errorCode` 固定为 `AI.RUN_INTERRUPTED`，`finalEntryId` 保留已知值。
- `starting` 和 `running` 的 `finishedAt`、`finalEntryId`、`errorCode` 为空。

## 5. HarnessEvent

### 5.1 Envelope

每个事件都包含：

```ts
{
  version: 1
  eventId: string
  sequence: number
  sessionId: string
  runId: string
  lane: string
  createdAt: string
  type: string
  data: object
}
```

- `eventId` 是 UUIDv7。
- `sequence` 从 1 开始，在同一个 Run 内严格递增。
- Run Service 创建唯一 `EventSequencer`。`run.started` 使用第一个 sequence，Executor 的 message/tool 事件和 Run Service 的 terminal event 共用该实例。
- SSE 的 `id`、`event`、`data` 分别使用 `eventId`、`type` 和完整 HarnessEvent JSON。

### 5.2 Event data

| `type` | `data` |
| --- | --- |
| `run.started` | `{ agentId, agentRevision, model: AiModelRef }` |
| `message.started` | `{ messageId, role: 'assistant' }` |
| `message.delta` | `{ messageId, delta }` |
| `message.completed` | `{ messageId, role: 'assistant', content, stopReason, errorCode }` |
| `tool.started` | `{ toolCallId, name }` |
| `tool.progress` | `{ toolCallId, name, safeSummary }` |
| `tool.completed` | `{ toolCallId, name, status, errorCode, safeSummary, entryId }` |
| `run.completed` | `{ status: 'completed', finalEntryId }` |
| `run.failed` | `{ status: 'failed', finalEntryId, error: { code, message, retryable } }` |
| `run.aborted` | `{ status: 'aborted', finalEntryId, errorCode: 'AI.REQUEST_ABORTED' }` |

补充约束：

- `messageId` 在 `message.started` 时生成，后续 delta/completed 保持不变，并等于最终 Pi message entry id。
- `tool.progress.safeSummary` 和 `tool.completed.safeSummary` 为 nullable、最多 1000 字符。
- Tool `status` 使用 transcript 的 Tool status，但实时 `tool.started` 不持久化 running transcript item。
- `message.completed.errorCode` 仅在保存 partial assistant message 时非空。
- `run.failed.error.message` 是可展示的安全中文信息，不包含 Provider 响应体、Tool arguments、路径或 stack。
- terminal event 只有 `run.completed`、`run.failed`、`run.aborted`。启动恢复产生的 `interrupted` 没有活动 SSE 连接，只通过 Run DTO 和 transcript 恢复。
- owner/Agent/reserve 校验在 Run row 创建前失败时，Route 返回普通 JSON error，不创建 SSE，也不创建 Run。
- Run row 已创建但 Executor 尚未进入 running 就失败时，Run Service 持久化 failed，并用 `run.failed` 作为 sequence 1 的唯一 SSE event；此路径不发送 `run.started`。
- 正常路径只有在 prepare、attach 和 starting -> running 更新成功后才发送 sequence 1 的 `run.started`。

## 6. Pi `starter.run.v1`

`starter.run.v1` 是 Pi `CustomEntry`，不是公开 transcript item，也不是 Pi `LaneRecord`。它在 terminal message/Tool entry 之后、主库 Run 终态更新之前写入当前 lane。

```ts
{
  type: 'custom'
  id: string
  customType: 'starter.run.v1'
  data: {
    schemaVersion: 1
    runId: string
    sessionId: string
    lane: string
    agentId: string
    agentRevision: number
    status: 'completed' | 'failed' | 'aborted'
    finalEntryId: string | null
    errorCode: ApiErrorCode | null
    finishedAt: number
  }
}
```

- `finishedAt` 是 Unix 毫秒。
- 每个 Run 只写一个 `starter.run.v1` entry。
- 恢复时按 `customType` 和 `data.runId` 查找；合法且 status 为终态时，按 data 条件更新主库。
- 找到多个同 runId entry 视为数据损坏：不选择最后一条，主库 Run 标记 `interrupted` 并记录结构化错误。
- schema 解析失败时不得读取部分字段，主库 Run 标记 `interrupted`。

## 7. Run 生命周期所有权

| 责任 | 唯一所有者 |
| --- | --- |
| Session owner、归档状态、Agent enabled 校验 | Run Service |
| `sessionId + lane` reserve、attach controls、release | Run Service |
| 创建 Run row、starting/running/terminal 条件更新 | Run Service |
| 创建 EventSequencer、`run.started` 和 terminal event | Run Service |
| 读取 lane context，运行 Pi Agent 和 compaction | Executor |
| 写 user/assistant/Tool/compaction Pi entries | Executor |
| Pi event 到 message/tool HarnessEvent 的转换 | PiEventMapper |
| 写 `starter.run.v1` | Run Service |
| SSE 订阅和 heartbeat | Run Route transport |

Run Route 只订阅 Run Service 的事件，不直接迭代 Executor。客户端断开只删除订阅者。

Executor 使用两段式内部 port：`prepare(input)` 立即返回 controls、事件流、result promise 和 `start()`；Run Service 先 attach controls，再调用 `start()`。这保证 Agent loop 开始前 registry 已能处理 abort、steer 和 follow-up。

Run Service 的终态顺序固定为：

1. 等待 Executor 返回 terminal result。
2. 写 `starter.run.v1`。
3. 条件更新主库 Run。
4. 发布唯一 terminal HarnessEvent。
5. 在 `finally` 中 release registry。

`starter.run.v1` 写入失败时不发布原 completed/aborted 事件，改为以 `AI.SESSION_STORAGE_FAILED` 写主库 failed 并发布 `run.failed`；如果主库也失败，记录 runId、sessionId、requestId 和两个 cause，关闭订阅 transport，仍在 `finally` release。Run Service 不尝试删除已经提交的 transcript entry。

`starter.run.v1` 已写入但主库终态更新失败时，不发布 terminal event。Service 记录 runId、sessionId、requestId 和数据库 cause，关闭订阅 transport 并 release；同进程恢复函数或下次启动根据 terminal entry 修复主库。

## 8. 新错误码

S2 在保留旧错误码的同时增加：

| 常量 | code | HTTP/用途 |
| --- | --- | --- |
| `AI_AGENT_NAME_CONFLICT` | `AI.AGENT_NAME_CONFLICT` | 409，Agent 名称重复 |
| `AI_AGENT_CONFIG_INVALID` | `AI.AGENT_CONFIG_INVALID` | 400，配置或资源引用不合法 |
| `AI_AGENT_NOT_ENABLED` | `AI.AGENT_NOT_ENABLED` | 409，Admin 操作或 Run 启动时状态不可用 |
| `AI_SESSION_BUSY` | `AI.SESSION_BUSY` | 409，registry 或 Pi writer lease 冲突 |
| `AI_SESSION_STORAGE_FAILED` | `AI.SESSION_STORAGE_FAILED` | 500，Pi Session 创建、写入或读取失败 |
| `AI_RUN_NOT_ACTIVE` | `AI.RUN_NOT_ACTIVE` | 409，Run 没有当前进程 active handle |
| `AI_RUN_INTERRUPTED` | `AI.RUN_INTERRUPTED` | 持久化终态；读取 Run 时仍返回 200 |

资源不存在、无权读取他人资源或已归档 Session 统一使用 `COMMON.NOT_FOUND` 404。认证和权限继续使用现有 Auth 错误码。Provider、Tool、timeout、context 和 abort 继续复用现有 AI 错误码。

## 9. 主库结构

### 9.1 `ai_agent_definitions`

| 列 | 约束 |
| --- | --- |
| `id` | text PK |
| `name` | text not null，唯一 |
| `description` | text not null，默认空字符串 |
| `status` | text not null，默认 `draft`，check `draft/enabled/disabled` |
| `revision` | integer not null，默认 1，check `revision >= 1` |
| `config_json` | text not null，check `json_valid(config_json)` |
| `created_by` | nullable user FK，`onDelete: set null` |
| `updated_by` | nullable user FK，`onDelete: set null` |
| `created_at`、`updated_at` | timestamp_ms not null |

索引：name unique；`(status, updated_at, id)`。

### 9.2 `ai_agent_sessions`

| 列 | 约束 |
| --- | --- |
| `id` | text PK，与 Pi Session id 相同 |
| `owner_id` | user FK not null，`onDelete: cascade` |
| `title` | text not null |
| `default_agent_id` | nullable Agent FK，`onDelete: set null` |
| `archived_at` | nullable timestamp_ms |
| `created_at`、`updated_at` | timestamp_ms not null |

索引：`(owner_id, archived_at, updated_at, id)`；`default_agent_id`。

### 9.3 `ai_agent_runs`

| 列 | 约束 |
| --- | --- |
| `id` | text PK |
| `session_id` | Session FK not null，`onDelete: cascade` |
| `agent_id` | Agent FK not null，`onDelete: restrict` |
| `lane` | text not null |
| `status` | text not null，check 六种 Run 状态 |
| `agent_revision` | integer not null，check `>= 1` |
| `snapshot_json` | text not null，check `json_valid(snapshot_json)` |
| `request_id` | text not null |
| `final_entry_id` | nullable text；跨数据库不建 FK |
| `error_code` | nullable text |
| `created_at` | timestamp_ms not null |
| `started_at`、`finished_at` | nullable timestamp_ms |

索引：`(session_id, created_at, id)`；`(session_id, lane, status)`；`(agent_id, created_at, id)`；`(status, created_at, id)`；`request_id`。

### 9.4 `ai_model_calls`

- 增加 nullable `run_id`，引用 `ai_agent_runs.id`，`onDelete: set null`。
- 增加 `(run_id, started_at, id)` 索引。
- `scenario` 新增 `agent_run` 值。
- 增加关联互斥 check：`run_id IS NULL OR (conversation_id IS NULL AND generation_id IS NULL)`。
- 旧 Conversation 调用写 conversation/generation 且 `run_id=null`；新 Run 调用写 `run_id` 且旧两列为 null；model test 可以三列都为空。
- 共存阶段 `AiModelCallAudit.scenario` 为 `model_test | conversation | agent_run`，DTO 增加 `runId: string | null` 并保留 `conversationId`、`generationId`。
- S8 后 `scenario` 为 `model_test | agent_run | legacy`，DTO 删除 `conversationId`、`generationId`，旧审计返回 `runId=null` 和 `legacy`。

S2 migration 不删除旧表、旧列、旧索引或旧记录。JSON 由 Service 读写时使用本文件对应的 Zod schema 解析；数据库的 `json_valid` 只检查 JSON 语法。

## 10. 旧规范适用范围

S1 至 S7 仍会读取 `.trellis/spec/api/backend/ai-integration-guidelines.md`，但其中 Conversation route、generation 状态机、`AiToolOrchestrator`、retry、旧 SSE event 和旧预算只约束临时保留的旧 runtime。

新 Harness 继续使用该规范中的 Provider credential、模型目录与白名单、Gateway、Tool Registry、权限、审计、secret 和日志规则。新 Harness 的 Session、Run、事件、并发和恢复以本文及各子任务 design 为准。S8 删除旧 runtime 后必须把规范改写为 Harness 规则。
