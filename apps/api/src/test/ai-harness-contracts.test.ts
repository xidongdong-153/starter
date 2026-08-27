import {
  agentDefinitionConfigSchema,
  agentDefinitionDetailSchema,
  agentDefinitionSummarySchema,
  agentRunLiveSnapshotSchema,
  agentRunSchema,
  agentSessionSchema,
  agentTranscriptItemSchema,
  agentTranscriptQuerySchema,
  aiModelCallAuditSchema,
  aiToolRefSchema,
  createAgentDefinitionSchema,
  createAgentSessionSchema,
  defaultAgentDefinitionConfig,
  followUpAgentRunSchema,
  runEventSchema,
  startAgentRunSchema,
  starterRunDataSchema,
  steerAgentRunSchema,
  updateAgentSessionSchema,
} from "@starter/contracts";
import { describe, expect, it } from "vitest";

const IDS = {
  agent: "01958c80-8df7-7ce2-8f90-123456789001",
  session: "01958c80-8df7-7ce2-8f90-123456789002",
  run: "01958c80-8df7-7ce2-8f90-123456789003",
  event: "01958c80-8df7-7ce2-8f90-123456789004",
  entry: "01958c80-8df7-7ce2-8f90-123456789005",
  prompt: "01958c80-8df7-7ce2-8f90-123456789006",
  skill: "01958c80-8df7-7ce2-8f90-123456789007",
  turn: "01958c80-8df7-7ce2-8f90-123456789008",
  step: "01958c80-8df7-7ce2-8f90-123456789009",
} as const;

const NOW = "2025-01-01T00:00:00.000Z";
const MODEL = { providerId: "openai", modelId: "gpt-4o" } as const;
const CONFIG = {
  schemaVersion: 2,
  model: MODEL,
  systemPromptId: IDS.prompt,
  skillIds: [IDS.skill],
  toolRefs: [{ name: "lookup", version: "1.0.0" }],
  thinkingLevel: "medium",
  maxTurns: 8,
} as const;
const SNAPSHOT = {
  ...CONFIG,
  agentId: IDS.agent,
  agentRevision: 2,
} as const;

describe("agent harness contracts", () => {
  it("解析默认配置并拒绝 secret、未知字段、重复引用和越界参数", () => {
    expect(defaultAgentDefinitionConfig).toEqual({
      schemaVersion: 2,
      model: null,
      systemPromptId: null,
      skillIds: [],
      toolRefs: [],
      outputContract: null,
      outputMode: "optional",
      thinkingLevel: "off",
      maxTurns: 8,
    });
    expect(agentDefinitionConfigSchema.safeParse(CONFIG).success).toBe(true);
    expect(
      agentDefinitionConfigSchema.safeParse({ ...CONFIG, apiKey: "secret" })
        .success,
    ).toBe(false);
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        skillIds: [IDS.skill, IDS.skill],
      }).success,
    ).toBe(false);
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        toolRefs: [
          { name: "lookup", version: "1.0.0" },
          { name: "lookup", version: "1.0.0" },
        ],
      }).success,
    ).toBe(false);
    expect(
      agentDefinitionConfigSchema.safeParse({ ...CONFIG, maxTurns: 33 })
        .success,
    ).toBe(false);
    expect(
      createAgentDefinitionSchema.safeParse({
        name: "Harness",
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it("只接受 schemaVersion 2 + toolRefs，拒绝 v1、toolNames、缺版本和版本范围", () => {
    expect(
      aiToolRefSchema.safeParse({ name: "lookup", version: "1.0.0" }).success,
    ).toBe(true);
    expect(
      aiToolRefSchema.safeParse({ name: "lookup", version: "1.0.0" }).data,
    ).toEqual({
      name: "lookup",
      version: "1.0.0",
    });

    // v1 配置：整体拒绝，不存在兼容读取
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        schemaVersion: 1,
      }).success,
    ).toBe(false);

    // toolNames 不是 v2 字段，strictObject 拒绝未知字段
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        toolNames: ["lookup"],
      }).success,
    ).toBe(false);

    // 缺失 version / name
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        toolRefs: [{ name: "lookup" }],
      }).success,
    ).toBe(false);
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        toolRefs: [{ version: "1.0.0" }],
      }).success,
    ).toBe(false);
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        toolRefs: [],
      }).success,
    ).toBe(true);

    // 版本范围 / latest / v 前缀 / 预发布标签全部拒绝
    for (const version of [
      "latest",
      "^1.0.0",
      ">=1.0.0",
      "~1.0.0",
      "v1.0.0",
      "1.0",
      "1.0.0-beta.1",
      "1.0.0+build",
    ]) {
      expect(
        agentDefinitionConfigSchema.safeParse({
          ...CONFIG,
          toolRefs: [{ name: "lookup", version }],
        }).success,
        version,
      ).toBe(false);
    }

    // 非法工具名
    expect(
      agentDefinitionConfigSchema.safeParse({
        ...CONFIG,
        toolRefs: [{ name: "Lookup", version: "1.0.0" }],
      }).success,
    ).toBe(false);
  });

  it("解析 Agent、Session、分页查询和 Run 控制输入", () => {
    const summary = {
      id: IDS.agent,
      name: "Harness",
      description: "Agent",
      status: "draft",
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    expect(agentDefinitionSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      agentDefinitionDetailSchema.safeParse({ ...summary, config: CONFIG })
        .success,
    ).toBe(true);
    expect(
      agentSessionSchema.safeParse({
        id: IDS.session,
        title: "Session",
        defaultAgentId: null,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }).success,
    ).toBe(true);
    expect(createAgentSessionSchema.safeParse({}).success).toBe(true);
    expect(
      updateAgentSessionSchema.safeParse({ defaultAgentId: null }).success,
    ).toBe(true);
    expect(agentTranscriptQuerySchema.parse({})).toEqual({
      lane: "main",
      limit: 50,
      direction: "backward",
    });
    expect(agentTranscriptQuerySchema.parse({ direction: "forward" })).toEqual({
      lane: "main",
      limit: 50,
      direction: "forward",
    });
    expect(
      agentTranscriptQuerySchema.safeParse({ direction: "newest" }).success,
    ).toBe(false);
    expect(
      agentTranscriptQuerySchema.safeParse({ lane: "_private" }).success,
    ).toBe(false);
    expect(startAgentRunSchema.safeParse({ input: "hello" }).success).toBe(
      true,
    );
    expect(steerAgentRunSchema.safeParse({ text: "steer" }).success).toBe(true);
    expect(
      followUpAgentRunSchema.safeParse({ text: "follow up" }).success,
    ).toBe(true);
    expect(
      startAgentRunSchema.safeParse({ input: " ".repeat(1) }).success,
    ).toBe(false);
    expect(updateAgentSessionSchema.safeParse({}).success).toBe(false);
  });

  it("解析六种 Run 状态并执行终态约束", () => {
    const base = {
      id: IDS.run,
      sessionId: IDS.session,
      agentId: IDS.agent,
      agentRevision: 2,
      lane: "main",
      snapshot: SNAPSHOT,
      requestId: "request-1",
      createdAt: NOW,
      startedAt: NOW,
    };
    const runs = [
      {
        ...base,
        status: "starting",
        startedAt: null,
        finishedAt: null,
        finalEntryId: null,
        errorCode: null,
      },
      {
        ...base,
        status: "running",
        finishedAt: null,
        finalEntryId: null,
        errorCode: null,
      },
      {
        ...base,
        status: "completed",
        finishedAt: NOW,
        finalEntryId: IDS.entry,
        errorCode: null,
      },
      {
        ...base,
        status: "failed",
        finishedAt: NOW,
        finalEntryId: null,
        errorCode: "AI.TOOL_FAILED",
      },
      {
        ...base,
        status: "aborted",
        finishedAt: NOW,
        finalEntryId: null,
        errorCode: "AI.REQUEST_ABORTED",
      },
      {
        ...base,
        status: "interrupted",
        finishedAt: NOW,
        finalEntryId: null,
        errorCode: "AI.RUN_INTERRUPTED",
      },
    ];

    for (const run of runs) {
      expect(agentRunSchema.safeParse(run).success).toBe(true);
    }
    expect(
      agentRunSchema.safeParse({
        ...runs[2],
        finalEntryId: null,
      }).success,
    ).toBe(false);
    expect(
      agentRunSchema.safeParse({
        ...runs[4],
        errorCode: "AI.TOOL_FAILED",
      }).success,
    ).toBe(false);
    expect(
      agentRunSchema.safeParse({
        ...runs[2],
        agentId: IDS.session,
      }).success,
    ).toBe(false);
    expect(
      agentRunSchema.safeParse({
        ...runs[2],
        snapshot: { ...SNAPSHOT, agentRevision: 3 },
      }).success,
    ).toBe(false);
    expect(
      agentRunSchema.safeParse({
        ...runs[2],
        live: {
          lastSequence: 1,
          turn: 1,
          maxTurns: 8,
          timeline: [],
        },
      }).success,
    ).toBe(false);
    expect(
      agentRunSchema.safeParse({ ...runs[2], ownerId: "starter-user" }).success,
    ).toBe(false);
    expect(
      agentRunSchema.safeParse({
        ...runs[2],
        snapshot: { ...SNAPSHOT, providerApiKey: "secret" },
      }).success,
    ).toBe(false);
  });

  it("解析四种 transcript item", () => {
    const base = { id: IDS.entry, sequence: 1, lane: "main", createdAt: NOW };
    const items = [
      {
        ...base,
        type: "user_message",
        runId: IDS.run,
        content: "hello",
      },
      {
        ...base,
        type: "assistant_message",
        runId: IDS.run,
        content: "world",
        status: "completed",
        model: MODEL,
        stopReason: "stop",
        errorCode: null,
      },
      {
        ...base,
        type: "tool_activity",
        runId: IDS.run,
        toolCallId: "tool-1",
        name: "lookup",
        status: "succeeded",
        errorCode: null,
        safeSummary: null,
      },
      {
        ...base,
        type: "system",
        runId: null,
        kind: "compaction",
        summary: "summary",
      },
    ];

    for (const item of items) {
      expect(agentTranscriptItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it("transcript item 的 usage / toolCalls / tokensBefore 是可选新增字段", () => {
    const base = { id: IDS.entry, sequence: 1, lane: "main", createdAt: NOW };
    const assistant = {
      ...base,
      type: "assistant_message",
      runId: IDS.run,
      content: "world",
      status: "completed",
      model: MODEL,
      stopReason: "stop",
      errorCode: null,
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        totalTokens: 20,
      },
      toolCalls: [{ toolCallId: "tool-1", name: "lookup" }],
    };
    expect(agentTranscriptItemSchema.safeParse(assistant).success).toBe(true);

    const system = {
      ...base,
      type: "system",
      runId: null,
      kind: "compaction",
      summary: "summary",
      tokensBefore: 4096,
    };
    expect(agentTranscriptItemSchema.safeParse(system).success).toBe(true);

    // toolCalls 只暴露标识，带 arguments 的对象必须被 strictObject 拒绝
    expect(
      agentTranscriptItemSchema.safeParse({
        ...assistant,
        toolCalls: [
          { toolCallId: "tool-1", name: "lookup", arguments: { q: "x" } },
        ],
      }).success,
    ).toBe(false);
  });

  it("assistant item 的 blocks 保留 text 与 thinking 的原始顺序", () => {
    const assistant = {
      id: IDS.entry,
      sequence: 1,
      lane: "main",
      createdAt: NOW,
      type: "assistant_message",
      runId: IDS.run,
      content: "answer",
      status: "completed",
      model: MODEL,
      stopReason: "stop",
      errorCode: null,
    };
    expect(
      agentTranscriptItemSchema.safeParse({
        ...assistant,
        blocks: [
          { type: "thinking", text: "先想" },
          { type: "text", text: "answer" },
        ],
      }).success,
    ).toBe(true);
    // blocks 可选：缺失时消费者回退到 content
    expect(agentTranscriptItemSchema.safeParse(assistant).success).toBe(true);
    // 只允许 text / thinking 两种块，工具入参不能借块结构进协议
    expect(
      agentTranscriptItemSchema.safeParse({
        ...assistant,
        blocks: [{ type: "toolCall", text: "lookup" }],
      }).success,
    ).toBe(false);
  });

  it("live 快照的 timeline 覆盖 message / tool / compaction 三种元素", () => {
    const snapshot = {
      lastSequence: 6,
      turn: 1,
      maxTurns: 8,
      timeline: [
        {
          kind: "message",
          messageId: IDS.entry,
          blocks: [
            { type: "thinking", text: "想" },
            { type: "text", text: "答" },
          ],
          completed: true,
          usage: null,
        },
        {
          kind: "tool",
          toolCallId: "tool-1",
          name: "lookup",
          status: "running",
          safeSummary: null,
        },
        { kind: "compaction", entryId: IDS.entry, summary: "摘要" },
      ],
    };
    expect(agentRunLiveSnapshotSchema.safeParse(snapshot).success).toBe(true);
    // 旧的 messages / tools 两个数组已经被 timeline 取代
    expect(
      agentRunLiveSnapshotSchema.safeParse({
        lastSequence: 1,
        turn: 1,
        maxTurns: 8,
        messages: [],
        tools: [],
      }).success,
    ).toBe(false);
    expect(
      agentRunLiveSnapshotSchema.safeParse({
        ...snapshot,
        timeline: [{ kind: "user", messageId: IDS.entry }],
      }).success,
    ).toBe(false);
  });

  it("解析 RunEvent envelope、终态和安全字段", () => {
    const envelope = {
      eventId: IDS.event,
      sequence: 1,
      sessionId: IDS.session,
      runId: IDS.run,
      lane: "main",
      occurredAt: NOW,
      turnIndex: null,
      stepId: null,
      modelCallId: null,
      messageId: null,
      toolCallId: null,
      toolExecutionId: null,
    } as const;
    const events = [
      {
        ...envelope,
        type: "run.started",
        data: {
          agentId: IDS.agent,
          agentRevision: 2,
          model: MODEL,
          outputContract: null,
        },
      },
      {
        ...envelope,
        type: "message.delta",
        data: { partId: "part-1", delta: "a" },
      },
      {
        ...envelope,
        type: "tool.completed",
        data: {
          name: "lookup",
          version: "1.0.0",
          status: "succeeded",
          summary: "done",
          entryId: IDS.entry,
          error: null,
        },
      },
      {
        ...envelope,
        type: "run.completed",
        data: { finalEntryId: IDS.entry, reason: "model_finished" },
      },
    ];

    for (const event of events) {
      expect(runEventSchema.safeParse(event).success).toBe(true);
    }
    expect(
      runEventSchema.safeParse({
        ...events[0],
        data: { status: "completed", finalEntryId: IDS.entry },
      }).success,
    ).toBe(false);
  });

  it("校验 starter.run 终态和用量审计关联互斥", () => {
    expect(
      starterRunDataSchema.safeParse({
        schemaVersion: 1,
        runId: IDS.run,
        sessionId: IDS.session,
        lane: "main",
        agentId: IDS.agent,
        agentRevision: 2,
        status: "completed",
        finalEntryId: IDS.entry,
        errorCode: null,
        finishedAt: 1_736_899_200_000,
      }).success,
    ).toBe(true);
    expect(
      starterRunDataSchema.safeParse({
        schemaVersion: 1,
        runId: IDS.run,
        sessionId: IDS.session,
        lane: "main",
        agentId: IDS.agent,
        agentRevision: 2,
        status: "completed",
        finalEntryId: null,
        errorCode: null,
        finishedAt: 1_736_899_200_000,
      }).success,
    ).toBe(false);

    const audit = {
      id: IDS.event,
      requestId: "request-1",
      userId: "user-1",
      appId: null,
      principalKind: "starter_user",
      tenantId: "starter",
      projectId: "starter",
      externalUserId: null,
      scenario: "agent_run",
      runId: IDS.run,
      turnId: IDS.turn,
      stepId: IDS.step,
      providerId: "openai",
      modelId: "gpt-4o",
      api: "openai-completions",
      startedAt: NOW,
      timeoutMs: 1000,
      finishedAt: NOW,
      durationMs: 1,
      ttftMs: 1,
      chunkCount: 3,
      responseModel: "gpt-4o-2024-08-06",
      responseId: "resp-1",
      httpStatus: 200,
      result: "succeeded",
      stopReason: "stop",
      errorCode: null,
      errorCategory: null,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        totalTokens: 2,
      },
      cost: null,
    } as const;

    expect(aiModelCallAuditSchema.safeParse(audit).success).toBe(true);
    expect(
      aiModelCallAuditSchema.safeParse({
        ...audit,
        scenario: "legacy",
        runId: null,
      }).success,
    ).toBe(true);
    expect(
      aiModelCallAuditSchema.safeParse({ ...audit, scenario: "legacy" })
        .success,
    ).toBe(false);
    expect(
      aiModelCallAuditSchema.safeParse({
        ...audit,
        scenario: "agent_run",
        runId: null,
      }).success,
    ).toBe(false);
  });
});
