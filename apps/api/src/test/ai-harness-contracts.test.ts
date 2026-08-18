import {
  agentDefinitionConfigSchema,
  agentDefinitionDetailSchema,
  agentDefinitionSummarySchema,
  agentRunSchema,
  agentSessionSchema,
  agentTranscriptItemSchema,
  agentTranscriptQuerySchema,
  aiModelCallAuditSchema,
  createAgentDefinitionSchema,
  createAgentSessionSchema,
  defaultAgentDefinitionConfig,
  followUpAgentRunSchema,
  harnessEventSchema,
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
} as const;

const NOW = "2025-01-01T00:00:00.000Z";
const MODEL = { providerId: "openai", modelId: "gpt-4o" } as const;
const CONFIG = {
  schemaVersion: 1,
  model: MODEL,
  systemPromptId: IDS.prompt,
  skillIds: [IDS.skill],
  toolNames: ["lookup"],
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
      schemaVersion: 1,
      model: null,
      systemPromptId: null,
      skillIds: [],
      toolNames: [],
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
        toolNames: ["lookup", "lookup"],
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
    });
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

  it("解析所有 HarnessEvent 分支并拒绝不匹配的 data", () => {
    const envelope = {
      version: 1,
      eventId: IDS.event,
      sequence: 1,
      sessionId: IDS.session,
      runId: IDS.run,
      lane: "main",
      createdAt: NOW,
    } as const;
    const events = [
      {
        ...envelope,
        type: "run.started",
        data: { agentId: IDS.agent, agentRevision: 2, model: MODEL },
      },
      {
        ...envelope,
        type: "message.started",
        data: { messageId: IDS.entry, role: "assistant" },
      },
      {
        ...envelope,
        type: "message.delta",
        data: { messageId: IDS.entry, delta: "a" },
      },
      {
        ...envelope,
        type: "message.completed",
        data: {
          messageId: IDS.entry,
          role: "assistant",
          content: "answer",
          stopReason: "stop",
          errorCode: null,
        },
      },
      {
        ...envelope,
        type: "tool.started",
        data: { toolCallId: "tool-1", name: "lookup" },
      },
      {
        ...envelope,
        type: "tool.progress",
        data: {
          toolCallId: "tool-1",
          name: "lookup",
          safeSummary: null,
        },
      },
      {
        ...envelope,
        type: "tool.completed",
        data: {
          toolCallId: "tool-1",
          name: "lookup",
          status: "succeeded",
          errorCode: null,
          safeSummary: "done",
          entryId: IDS.entry,
        },
      },
      {
        ...envelope,
        type: "run.completed",
        data: { status: "completed", finalEntryId: IDS.entry },
      },
      {
        ...envelope,
        type: "run.failed",
        data: {
          status: "failed",
          finalEntryId: null,
          error: {
            code: "AI.TOOL_FAILED",
            message: "工具执行失败",
            retryable: false,
          },
        },
      },
      {
        ...envelope,
        type: "run.aborted",
        data: {
          status: "aborted",
          finalEntryId: null,
          errorCode: "AI.REQUEST_ABORTED",
        },
      },
    ];

    for (const event of events) {
      expect(harnessEventSchema.safeParse(event).success).toBe(true);
    }
    expect(
      harnessEventSchema.safeParse({
        ...events[0],
        data: { status: "completed", finalEntryId: IDS.entry },
      }).success,
    ).toBe(false);
  });

  it("校验 starter.run.v1 终态和用量审计关联互斥", () => {
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
      scenario: "agent_run",
      conversationId: null,
      generationId: null,
      runId: IDS.run,
      providerId: "openai",
      modelId: "gpt-4o",
      startedAt: NOW,
      timeoutMs: 1000,
      finishedAt: NOW,
      durationMs: 1,
      result: "succeeded",
      stopReason: "stop",
      errorCode: null,
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
        conversationId: IDS.session,
      }).success,
    ).toBe(false);
  });
});
