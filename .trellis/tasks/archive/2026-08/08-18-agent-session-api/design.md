# AgentSession API 设计

transcript DTO、cursor、lane 和 Pi entry 过滤规则以父任务共享契约为准：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。

## 1. 创建流程

```mermaid
%%{init: {"theme": "dark"}}%%
sequenceDiagram
  participant Client as Client
  participant Service as Session Service
  participant Pi as PiSessionStore
  participant Main as app.db

  Client->>Service: createSession(userId, input)
  Service->>Service: validate defaultAgentId
  Service->>Pi: createSession(id)
  Pi-->>Service: created
  Service->>Main: insert session index
  alt 主库写入成功
    Main-->>Service: session record
    Service-->>Client: AgentSession DTO
  else 主库写入失败
    Service->>Pi: deleteSession(id)
    Service-->>Client: mapped error
  end
```

不采用 SQLite `ATTACH` 或跨库 transaction。补偿只删除本次刚创建且尚未返回给客户端的 Pi Session。

## 2. 归属

Repository 的用户查询都同时包含 `id` 和 `ownerId`。Service 不先查全局 id 再比较 owner，避免暴露资源存在性。Admin 也不绕过该规则；本任务没有跨用户 Session 管理接口。

## 3. 归档

DELETE 写 `archivedAt`。默认列表排除已归档 Session；GET、PATCH 和 transcript 也按不存在处理。Pi history 保留，后续 retention 任务再决定物理删除。

## 4. Transcript 投影

Presenter 接收 adapter 返回的中性 entry projection，不直接接收 `SessionEntry`。公开 union 固定区分 user message、assistant message、Tool activity 和 compaction system item；`starter.run.v1` 必须过滤，不投影为 transcript。S5 负责安全投影，S6 负责 Run identity entry 的写入和恢复测试。

### 4.1 runId 读取规则（S5 定稿，S6 落实写入侧）

S2 契约中 user/assistant/tool item 的 `runId` 为必填 UUID，但 Pi 标准 user/assistant message entry 没有 runId 槽位。已确认 Pi SQLite backend 对 message entry 做原样 JSON 持久化（`entryPayload` 剔除基础字段后全量 `stringify`），因此 S6 可在写入时给 message 附加字段承载 runId。

- S5 投影读取顺序固定为：`message.runId`（UUID 校验）优先，其次 `message.details.runId`（toolResult 双通道兜底）。
- 两者都缺失时，该 item 不投影并记录结构化日志（entry type、entry id、requestId），与契约 3.2「未识别 entry 跳过」同一范式；不输出 null、不编造 Run 归属。
- compaction system item 的 `runId` 契约允许 null，直接 `null`。
- S6 写入侧约定已写入 `08-18-agent-run-api/prd.md` 备注：assistant/user message 附加 `runId` 字段，toolResult 在 `details` 中附加可选 `runId`（两路 S5 都兼容）。

## 5. 一致性检查

检查器分别列出主库全部 Session ids（含已归档，因为归档只写主库 `archivedAt`，Pi history 仍保留）和 Pi repository metadata ids，计算：

- `missingInPi`
- `missingInMain`

结果只用于日志和测试，不提供默认修复命令。

## 6. 回滚

删除 Session Route、Service、Repository、Presenter 和测试。已创建的业务索引和 Pi Session 数据不自动删除；回滚前若已有数据，需要先告知用户并单独决定处理方式。
