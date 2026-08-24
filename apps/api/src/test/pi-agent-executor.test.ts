import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { generateId } from "@api/shared/id.js";
import { ApiErrorCodes } from "@starter/contracts";
import type { AgentSessionStore } from "@api/infra/agent/pi-session-store.js";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { createActiveRunRegistry } from "@api/infra/agent/active-run-registry.js";
import {
  createEventSequencer,
  createPiAgentExecutor,
} from "@api/infra/agent/index.js";
import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";

const model: Model<Api> = {
  id: "test-model",
  name: "Test model",
  api: "openai-completions",
  provider: "test-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 1024,
};

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamResponse(
  message: AssistantMessage,
  reason: Extract<
    AssistantMessage["stopReason"],
    "stop" | "length" | "toolUse" | "deferred"
  >,
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const partial = assistantMessage([], "pending");
  stream.push({ type: "start", partial });
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === "text") {
      stream.push({
        type: "text_delta",
        contentIndex,
        delta: block.text,
        partial: assistantMessage(
          message.content.slice(0, contentIndex + 1),
          "pending",
        ),
      });
    }
    if (block.type === "toolCall") {
      stream.push({
        type: "toolcall_end",
        contentIndex,
        toolCall: block,
        partial: assistantMessage(
          message.content.slice(0, contentIndex + 1),
          "pending",
        ),
      });
    }
  }
  stream.push({ type: "done", reason, message });
  return stream;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

it("piAgentExecutor 使用 Pi Agent 完成多轮 Tool，并按 caller sequence 映射事件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-executor-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const sessionId = generateId();
  const runId = generateId();
  await store.createSession({ id: sessionId });
  let calls = 0;
  const streamFn = (
    _requestModel: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    calls += 1;
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return streamResponse(
        assistantMessage([{ type: "text", text: "answer" }], "stop"),
        "stop",
      );
    }
    return streamResponse(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: "tool-call-1",
            name: "lookup",
            arguments: { value: "input" },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  };
  const tools = createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "Look up a value",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      scope: "platform",
      requiredPermission: null,
      execute: async () => ({
        modelText: "tool-result",
        safeSummary: "looked up",
      }),
    }),
  ]);
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const registry = createActiveRunRegistry();
  const prepared = executor.prepare({
    runId,
    sessionId,
    lane: "main",
    userId: generateId(),
    requestId: "request-agent-executor",
    input: "lookup this",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      systemPrompt: "You are a test agent.",
      thinkingLevel: "off",
      maxTurns: 4,
      tools: tools.list(),
    },
  });

  await expect(prepared.start()).rejects.toThrow("not_attached");
  const lease = registry.reserve(sessionId, "main");
  registry.attach(lease, runId, prepared.controls);
  await prepared.start();
  const [events, terminal] = await Promise.all([
    collect(prepared.events),
    prepared.result,
  ]);

  expect(calls).toBe(2);
  expect(terminal).toMatchObject({
    status: "completed",
    errorCode: null,
  });
  expect(terminal.finalEntryId).toBeTruthy();
  expect(events.map((event) => event.sequence)).toEqual(
    events.map((event) => event.sequence).sort((a, b) => a - b),
  );
  expect(events.map((event) => event.type)).toEqual([
    "turn.started",
    "message.started",
    "message.completed",
    "tool.started",
    "tool.completed",
    "turn.completed",
    "turn.started",
    "message.started",
    "message.delta",
    "message.completed",
    "turn.completed",
  ]);
  expect(events.find((event) => event.type === "tool.completed")).toMatchObject(
    {
      data: {
        toolCallId: "tool-call-1",
        name: "lookup",
        status: "succeeded",
        safeSummary: "looked up",
      },
    },
  );
  expect(events.some((event) => event.type.startsWith("run."))).toBe(false);

  const transcript = await store.readTranscript({ sessionId, lane: "main" });
  expect(transcript.filter((entry) => entry.type === "message")).toHaveLength(
    4,
  );
  expect(transcript.map((entry) => entry.type)).toEqual([
    "message",
    "message",
    "message",
    "message",
  ]);
  expect(registry.get(runId)).toBeDefined();
  registry.release(runId);
  expect(registry.get(runId)).toBeUndefined();

  await store.close();
  await rm(directory, { recursive: true, force: true });
});

it("思考内容映射成 thinking 事件，message.completed 只带正文", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-thinking-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const sessionId = generateId();
  const runId = generateId();
  await store.createSession({ id: sessionId });
  const finalMessage = assistantMessage(
    [
      { type: "thinking", thinking: "先想一下" },
      { type: "text", text: "answer" },
    ],
    "stop",
  );
  const streamFn = (
    _requestModel: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    const partial = assistantMessage([], "pending");
    stream.push({ type: "start", partial });
    stream.push({ type: "thinking_start", contentIndex: 0, partial });
    stream.push({
      type: "thinking_delta",
      contentIndex: 0,
      delta: "先想",
      partial,
    });
    stream.push({
      type: "thinking_delta",
      contentIndex: 0,
      delta: "一下",
      partial,
    });
    stream.push({
      type: "thinking_end",
      contentIndex: 0,
      content: "先想一下",
      partial,
    });
    stream.push({
      type: "text_delta",
      contentIndex: 1,
      delta: "answer",
      partial,
    });
    stream.push({ type: "done", reason: "stop", message: finalMessage });
    return stream;
  };
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const registry = createActiveRunRegistry();
  const prepared = executor.prepare({
    runId,
    sessionId,
    lane: "main",
    userId: generateId(),
    requestId: "request-agent-thinking",
    input: "think first",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      thinkingLevel: "medium",
      maxTurns: 4,
      tools: [],
    },
  });
  const lease = registry.reserve(sessionId, "main");
  registry.attach(lease, runId, prepared.controls);
  await prepared.start();
  const [events, terminal] = await Promise.all([
    collect(prepared.events),
    prepared.result,
  ]);

  expect(terminal.status).toBe("completed");
  // thinking 事件按流顺序发布，夹在 message.started 和 message.delta 之间
  expect(events.map((event) => event.type)).toEqual([
    "turn.started",
    "message.started",
    "thinking.started",
    "thinking.delta",
    "thinking.delta",
    "thinking.completed",
    "message.delta",
    "message.completed",
    "turn.completed",
  ]);
  const messageStarted = events.find(
    (event) => event.type === "message.started",
  );
  const thinkingEvents = events.filter((event) =>
    event.type.startsWith("thinking."),
  );
  for (const event of thinkingEvents) {
    expect(event.data).toMatchObject({
      messageId: messageStarted?.data.messageId,
      blockIndex: 0,
    });
  }
  expect(thinkingEvents.at(-1)?.data).toMatchObject({ content: "先想一下" });
  // message.completed 的 content 语义不变，只拼 text 块
  expect(
    events.find((event) => event.type === "message.completed")?.data,
  ).toMatchObject({ content: "answer" });
  expect(events.map((event) => event.sequence)).toEqual(
    events.map((event) => event.sequence).sort((a, b) => a - b),
  );

  registry.release(runId);
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

it("工具上报进度时发布 tool.progress，只带脱敏摘要", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-progress-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const sessionId = generateId();
  const runId = generateId();
  await store.createSession({ id: sessionId });
  const streamFn = (
    _requestModel: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return streamResponse(
        assistantMessage([{ type: "text", text: "done" }], "stop"),
        "stop",
      );
    }
    return streamResponse(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: "tool-call-progress",
            name: "stepwise",
            arguments: { steps: 2 },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  };
  const tools = createAiToolRegistry([
    defineAiTool({
      name: "stepwise",
      version: "1.0.0",
      description: "Report progress per step",
      inputSchema: z.object({ steps: z.number().int().min(1).max(4) }),
      timeoutMs: 1000,
      scope: "platform",
      requiredPermission: null,
      execute: async (context, input) => {
        for (let step = 1; step <= input.steps; step += 1) {
          context.reportProgress?.(`已完成 ${step}/${input.steps}`);
        }
        return { modelText: "all done", safeSummary: "共 2 步" };
      },
    }),
  ]);
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const registry = createActiveRunRegistry();
  const prepared = executor.prepare({
    runId,
    sessionId,
    lane: "main",
    userId: generateId(),
    requestId: "request-tool-progress",
    input: "run stepwise",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      maxTurns: 4,
      tools: tools.list(),
    },
  });
  const lease = registry.reserve(sessionId, "main");
  registry.attach(lease, runId, prepared.controls);
  await prepared.start();
  const [events] = await Promise.all([
    collect(prepared.events),
    prepared.result,
  ]);

  const progress = events.filter((event) => event.type === "tool.progress");
  expect(progress.length).toBe(2);
  expect(progress[0]).toMatchObject({
    data: {
      toolCallId: "tool-call-progress",
      name: "stepwise",
      safeSummary: "已完成 1/2",
    },
  });
  expect(progress[1]?.data).toMatchObject({ safeSummary: "已完成 2/2" });
  // progress 事件只带摘要，不泄露 modelText 或入参
  expect(JSON.stringify(progress)).not.toContain("modelText");
  expect(JSON.stringify(progress)).not.toContain("steps");
  // sequence 仍单调递增
  expect(events.map((event) => event.sequence)).toEqual(
    events.map((event) => event.sequence).sort((a, b) => a - b),
  );

  registry.release(runId);
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

it("工具超时后模型继续回复，Run 以 completed 结束", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-agent-tool-timeout-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const sessionId = generateId();
  const runId = generateId();
  await store.createSession({ id: sessionId });
  let calls = 0;
  const streamFn = (
    _requestModel: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    calls += 1;
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return streamResponse(
        assistantMessage(
          [{ type: "text", text: "工具超时了，换个思路。" }],
          "stop",
        ),
        "stop",
      );
    }
    return streamResponse(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: "tool-call-timeout",
            name: "never_finishes",
            arguments: {},
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  };
  const tools = createAiToolRegistry([
    defineAiTool({
      name: "never_finishes",
      version: "1.0.0",
      description: "Never settles; adapter timeout owns cancellation",
      inputSchema: z.object({}),
      timeoutMs: 100,
      scope: "platform",
      requiredPermission: null,
      execute: async () => new Promise<never>(() => {}),
    }),
  ]);
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const registry = createActiveRunRegistry();
  const prepared = executor.prepare({
    runId,
    sessionId,
    lane: "main",
    userId: generateId(),
    requestId: "request-tool-timeout",
    input: "call the tool",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      maxTurns: 4,
      tools: tools.list(),
    },
  });
  const lease = registry.reserve(sessionId, "main");
  registry.attach(lease, runId, prepared.controls);
  await prepared.start();
  const [events, terminal] = await Promise.all([
    collect(prepared.events),
    prepared.result,
  ]);

  // 工具超时不再护断 Run：模型拿到失败后又请求了一次
  expect(calls).toBe(2);
  expect(terminal).toMatchObject({ status: "completed", errorCode: null });

  const toolCompleted = events.find((event) => event.type === "tool.completed");
  expect(toolCompleted).toMatchObject({
    data: {
      toolCallId: "tool-call-timeout",
      name: "never_finishes",
      status: "timed_out",
      errorCode: ApiErrorCodes.AI_TOOL_TIMED_OUT,
    },
  });

  // 超时后仍有一轮 assistant 回复，内容已落到 transcript
  const completedMessages = events.filter(
    (event) => event.type === "message.completed",
  );
  expect(completedMessages.length).toBe(2);
  const transcript = await store.readTranscript({ sessionId, lane: "main" });
  const texts = JSON.stringify(transcript);
  expect(texts).toContain("工具超时了，换个思路。");
  // 模型看到的失败原因带上了超时时长
  expect(texts).toContain("The tool timed out after 100ms.");

  registry.release(runId);
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

it("pi JSON Schema 拒绝参数时仍生成安全 Tool 结果和一次审计", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-agent-invalid-tool-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  try {
    const sessionId = generateId();
    const runId = generateId();
    await store.createSession({ id: sessionId });
    const modelContexts: Context[] = [];
    const streamFn = (
      _requestModel: Model<Api>,
      context: Context,
      _options?: SimpleStreamOptions,
    ) => {
      modelContexts.push(context);
      const last = context.messages.at(-1);
      if (last?.role === "toolResult") {
        return streamResponse(
          assistantMessage([{ type: "text", text: "safe answer" }], "stop"),
          "stop",
        );
      }
      return streamResponse(
        assistantMessage(
          [
            {
              type: "toolCall",
              id: "invalid-tool-call",
              name: "lookup",
              arguments: { value: 123 },
            },
          ],
          "toolUse",
        ),
        "toolUse",
      );
    };
    const execute = vi.fn(async () => ({
      modelText: "should not execute",
      safeSummary: null,
    }));
    const registry = createAiToolRegistry([
      defineAiTool({
        name: "lookup",
        version: "1.0.0",
        description: "Look up a value",
        inputSchema: z.object({ value: z.string().min(5) }),
        timeoutMs: 1000,
        scope: "platform",
        requiredPermission: null,
        execute,
      }),
    ]);
    const auditHandle = { id: "invalid-tool-audit", startedAt: new Date() };
    const toolAudit = {
      beginToolExecution: vi.fn(() => auditHandle),
      finalizeToolExecution: vi.fn(),
    };
    const executor = createPiAgentExecutor({
      sessionStore: store,
      resolveModel: () => model,
      streamFn,
      toolAudit,
    });
    const prepared = executor.prepare({
      runId,
      sessionId,
      lane: "main",
      userId: generateId(),
      requestId: "request-invalid-tool",
      input: "lookup this",
      sequencer: createEventSequencer(),
      config: {
        model: { providerId: model.provider, modelId: model.id },
        maxTurns: 4,
        tools: registry.list(),
      },
    });
    const activeRegistry = createActiveRunRegistry();
    const lease = activeRegistry.reserve(sessionId, "main");
    activeRegistry.attach(lease, runId, prepared.controls);

    await prepared.start();
    const [events, terminal] = await Promise.all([
      collect(prepared.events),
      prepared.result,
    ]);

    expect(terminal.status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
    expect(
      events.find((event) => event.type === "tool.completed"),
    ).toMatchObject({
      data: {
        status: "invalid_arguments",
        errorCode: ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
      },
    });
    expect(toolAudit.beginToolExecution).toHaveBeenCalledOnce();
    expect(toolAudit.finalizeToolExecution).toHaveBeenCalledWith(
      auditHandle,
      "invalid_arguments",
      ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
    );
    const toolResultContext = modelContexts[1]?.messages.at(-1);
    expect(toolResultContext).toMatchObject({
      role: "toolResult",
      content: [{ type: "text", text: "The tool failed." }],
    });
    expect(JSON.stringify(toolResultContext)).not.toContain('"value":123');
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("pi compaction 成功后写入 entry，并用 retained context 继续运行", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-compaction-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  try {
    const sessionId = generateId();
    const runId = generateId();
    const compactModel: Model<Api> = {
      ...model,
      id: "compact-model",
      contextWindow: 32,
    };
    await store.createSession({ id: sessionId });
    const session = await store.openSession(sessionId);
    await session.appendMessage("main", {
      role: "user",
      content: "history ".repeat(100),
      timestamp: Date.now(),
    });
    const streamFn = () =>
      streamResponse(
        assistantMessage([{ type: "text", text: "answer" }], "stop"),
        "stop",
      );
    const models = {
      getModel: vi.fn(() => compactModel),
      completeSimple: vi.fn(async () =>
        assistantMessage([{ type: "text", text: "summary" }], "stop"),
      ),
    } as unknown as Models;
    const modelAudit = {
      beginModelCall: vi.fn(() => "compaction-model-call"),
      finalizeModelCall: vi.fn(),
    };
    const executor = createPiAgentExecutor({
      sessionStore: store,
      models,
      resolveModel: () => compactModel,
      streamFn,
      audit: modelAudit,
      compaction: { reserveTokens: 10, keepRecentTokens: 0 },
    });
    const prepared = executor.prepare({
      runId,
      sessionId,
      lane: "main",
      userId: generateId(),
      requestId: "request-compaction",
      input: "continue",
      sequencer: createEventSequencer(),
      config: {
        model: { providerId: compactModel.provider, modelId: compactModel.id },
        maxTurns: 1,
        tools: [],
      },
    });
    const registry = createActiveRunRegistry();
    const lease = registry.reserve(sessionId, "main");
    registry.attach(lease, runId, prepared.controls);

    await prepared.start();

    const compactionEvents = await collect(prepared.events);
    await expect(prepared.result).resolves.toMatchObject({
      status: "completed",
      errorCode: null,
    });
    expect(models.completeSimple).toHaveBeenCalledOnce();
    expect(modelAudit.beginModelCall).toHaveBeenCalledOnce();
    expect(modelAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "compaction-model-call",
        requestId: "request-compaction",
        result: "succeeded",
      }),
    );
    const transcript = await store.readTranscript({ sessionId, lane: "main" });
    expect(transcript.some((entry) => entry.type === "compaction")).toBe(true);
    expect(transcript.filter((entry) => entry.type === "message")).toHaveLength(
      3,
    );

    // compaction 不再静默：发布 context.compacted 事件，携带 tokensBefore
    const compacted = compactionEvents.find(
      (event) => event.type === "context.compacted",
    );
    expect(compacted).toBeDefined();
    expect(compacted?.data).toMatchObject({
      tokensBefore: expect.any(Number),
    });
    const compactionEntry = transcript.find(
      (entry) => entry.type === "compaction",
    );
    expect((compacted?.data as { entryId: string } | undefined)?.entryId).toBe(
      compactionEntry?.id,
    );
    expect(
      (compacted?.data as { tokensBefore: number } | undefined)?.tokensBefore,
    ).toBeGreaterThan(0);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("pi compaction 摘要失败时保留原 transcript 并返回失败结果", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-agent-compaction-failure-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  try {
    const sessionId = generateId();
    const runId = generateId();
    const compactModel: Model<Api> = {
      ...model,
      id: "compact-failure-model",
      contextWindow: 32,
    };
    await store.createSession({ id: sessionId });
    const session = await store.openSession(sessionId);
    await session.appendMessage("main", {
      role: "user",
      content: "history ".repeat(100),
      timestamp: Date.now(),
    });
    const models = {
      getModel: vi.fn(() => compactModel),
      completeSimple: vi.fn(async () => assistantMessage([], "error")),
    } as unknown as Models;
    const executor = createPiAgentExecutor({
      sessionStore: store,
      models,
      resolveModel: () => compactModel,
      streamFn: () =>
        streamResponse(
          assistantMessage([{ type: "text", text: "should not run" }], "stop"),
          "stop",
        ),
      compaction: { reserveTokens: 10, keepRecentTokens: 0 },
    });
    const prepared = executor.prepare({
      runId,
      sessionId,
      lane: "main",
      userId: generateId(),
      requestId: "request-compaction-failure",
      input: "continue",
      sequencer: createEventSequencer(),
      config: {
        model: { providerId: compactModel.provider, modelId: compactModel.id },
        maxTurns: 1,
        tools: [],
      },
    });
    const registry = createActiveRunRegistry();
    const lease = registry.reserve(sessionId, "main");
    registry.attach(lease, runId, prepared.controls);

    await prepared.start();

    const terminal = await prepared.result;
    expect(terminal).toMatchObject({
      status: "failed",
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
    });
    expect(terminal.finalEntryId).toBeTruthy();
    expect(models.completeSimple).toHaveBeenCalledOnce();
    const transcript = await store.readTranscript({ sessionId, lane: "main" });
    expect(transcript.some((entry) => entry.type === "compaction")).toBe(false);
    expect(
      transcript.some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "user" &&
          typeof entry.message.content === "string" &&
          entry.message.content.startsWith("history"),
      ),
    ).toBe(true);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("pi compaction entry 写入失败时保留原 transcript 并返回 Session storage 错误", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-agent-compaction-entry-failure-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  try {
    const sessionId = generateId();
    const runId = generateId();
    const compactModel: Model<Api> = {
      ...model,
      id: "compact-entry-failure-model",
      contextWindow: 32,
    };
    await store.createSession({ id: sessionId });
    const session = await store.openSession(sessionId);
    await session.appendMessage("main", {
      role: "user",
      content: "history ".repeat(100),
      timestamp: Date.now(),
    });
    const sessionStore = {
      ...store,
      openSession: vi.fn(async () => ({
        ...session,
        appendCompaction: async () => {
          throw new Error("compaction-entry-failure");
        },
      })),
    } as unknown as AgentSessionStore;
    const models = {
      getModel: vi.fn(() => compactModel),
      completeSimple: vi.fn(async () =>
        assistantMessage([{ type: "text", text: "summary" }], "stop"),
      ),
    } as unknown as Models;
    const executor = createPiAgentExecutor({
      sessionStore,
      models,
      resolveModel: () => compactModel,
      streamFn: () =>
        streamResponse(
          assistantMessage([{ type: "text", text: "should not run" }], "stop"),
          "stop",
        ),
      compaction: { reserveTokens: 10, keepRecentTokens: 0 },
    });
    const prepared = executor.prepare({
      runId,
      sessionId,
      lane: "main",
      userId: generateId(),
      requestId: "request-compaction-entry-failure",
      input: "continue",
      sequencer: createEventSequencer(),
      config: {
        model: { providerId: compactModel.provider, modelId: compactModel.id },
        maxTurns: 1,
        tools: [],
      },
    });
    const registry = createActiveRunRegistry();
    const lease = registry.reserve(sessionId, "main");
    registry.attach(lease, runId, prepared.controls);

    await prepared.start();

    await expect(prepared.result).resolves.toMatchObject({
      status: "failed",
      errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
    });
    expect(models.completeSimple).toHaveBeenCalledOnce();
    const transcript = await store.readTranscript({ sessionId, lane: "main" });
    expect(transcript.some((entry) => entry.type === "compaction")).toBe(false);
    expect(
      transcript.some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "user" &&
          typeof entry.message.content === "string" &&
          entry.message.content.startsWith("history"),
      ),
    ).toBe(true);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("session 初始读取失败时返回 Session storage 错误，不启动 Provider", async () => {
  const sessionStore = {
    openSession: vi.fn(async () => {
      throw new Error("provider-secret-marker");
    }),
  } as unknown as AgentSessionStore;
  const executor = createPiAgentExecutor({ sessionStore });
  const runId = generateId();
  const prepared = executor.prepare({
    runId,
    sessionId: generateId(),
    lane: "main",
    userId: generateId(),
    requestId: "request-session-failure",
    input: "hello",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      maxTurns: 1,
      tools: [],
    },
  });
  const registry = createActiveRunRegistry();
  const lease = registry.reserve("session-session-failure", "main");
  registry.attach(lease, runId, prepared.controls);

  await prepared.start();

  await expect(prepared.result).resolves.toEqual({
    status: "failed",
    finalEntryId: null,
    errorCode: ApiErrorCodes.AI_SESSION_STORAGE_FAILED,
  });
  expect(sessionStore.openSession).toHaveBeenCalledOnce();
});

it("start 前 signal 已取消时不读取 Session 或启动 Agent", async () => {
  const controller = new AbortController();
  controller.abort();
  const sessionStore = {
    openSession: vi.fn(),
  } as unknown as AgentSessionStore;
  const executor = createPiAgentExecutor({ sessionStore });
  const runId = generateId();
  const prepared = executor.prepare({
    runId,
    sessionId: generateId(),
    lane: "main",
    userId: generateId(),
    requestId: "request-pre-abort",
    input: "hello",
    signal: controller.signal,
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      maxTurns: 1,
      tools: [],
    },
  });
  const registry = createActiveRunRegistry();
  const lease = registry.reserve("session-pre-abort", "main");
  registry.attach(lease, runId, prepared.controls);

  await prepared.start();

  await expect(prepared.result).resolves.toEqual({
    status: "aborted",
    finalEntryId: null,
    errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
  });
});

it("模型不在 executor 的解析目录时返回 MODEL_NOT_FOUND，不启动 stream", async () => {
  const sessionId = generateId();
  const runId = generateId();
  const sessionStore = {
    openSession: vi.fn(async () => ({
      readTranscript: vi.fn(async () => []),
    })),
  } as unknown as AgentSessionStore;
  const streamFn = vi.fn();
  const executor = createPiAgentExecutor({
    sessionStore,
    resolveModel: () => undefined,
    streamFn,
  });
  const prepared = executor.prepare({
    runId,
    sessionId,
    lane: "main",
    userId: generateId(),
    requestId: "request-model-missing",
    input: "hello",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      maxTurns: 1,
      tools: [],
    },
  });
  const registry = createActiveRunRegistry();
  const lease = registry.reserve(sessionId, "main");
  registry.attach(lease, runId, prepared.controls);

  await prepared.start();

  await expect(prepared.result).resolves.toEqual({
    status: "failed",
    finalEntryId: null,
    errorCode: ApiErrorCodes.AI_MODEL_NOT_FOUND,
  });
  expect(streamFn).not.toHaveBeenCalled();
});

it("原生模型 timeout 以 failed 和 AI_UPSTREAM_TIMEOUT 结束，而不是误报为 aborted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-timeout-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  try {
    const sessionId = generateId();
    const runId = generateId();
    await store.createSession({ id: sessionId });
    const never = createAssistantMessageEventStream();
    const models = {
      getModel: vi.fn(() => model),
      getAuth: vi.fn(async () => ({ auth: {}, source: "test" })),
      streamSimple: vi.fn(() => never),
    } as unknown as Models;
    const executor = createPiAgentExecutor({
      sessionStore: store,
      models,
      requestTimeoutMs: 10,
    });
    const prepared = executor.prepare({
      runId,
      sessionId,
      lane: "main",
      userId: generateId(),
      requestId: "request-native-timeout",
      input: "hello",
      sequencer: createEventSequencer(),
      config: {
        model: { providerId: model.provider, modelId: model.id },
        maxTurns: 1,
        tools: [],
      },
    });
    const registry = createActiveRunRegistry();
    const lease = registry.reserve(sessionId, "main");
    registry.attach(lease, runId, prepared.controls);

    await prepared.start();

    await expect(prepared.result).resolves.toMatchObject({
      status: "failed",
      errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
    });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("撞上 maxTurns 且仍在调工具时追加一轮无工具收尾", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-max-turns-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const sessionId = generateId();
  const runId = generateId();
  await store.createSession({ id: sessionId });
  const modelContexts: Context[] = [];
  const streamFn = (
    _requestModel: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    modelContexts.push(context);
    // 收尾轮没有工具可用，只能给文字
    if ((context.tools ?? []).length === 0) {
      return streamResponse(
        assistantMessage(
          [{ type: "text", text: "根据已有结果给出结论。" }],
          "stop",
        ),
        "stop",
      );
    }
    return streamResponse(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: `tool-call-${modelContexts.length}`,
            name: "lookup",
            arguments: { value: "input" },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  };
  const tools = createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "Look up a value",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      scope: "platform",
      requiredPermission: null,
      execute: async () => ({
        modelText: "tool-result",
        safeSummary: "looked up",
      }),
    }),
  ]);
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const registry = createActiveRunRegistry();
  const prepared = executor.prepare({
    runId,
    sessionId,
    lane: "main",
    userId: generateId(),
    requestId: "request-max-turns",
    input: "keep calling tools",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      maxTurns: 2,
      tools: tools.list(),
    },
  });
  const lease = registry.reserve(sessionId, "main");
  registry.attach(lease, runId, prepared.controls);
  await prepared.start();
  const [events, terminal] = await Promise.all([
    collect(prepared.events),
    prepared.result,
  ]);

  // 2 轮工具轮 + 1 轮收尾
  expect(modelContexts).toHaveLength(3);
  expect(modelContexts[0]?.tools).toHaveLength(1);
  expect(modelContexts[1]?.tools).toHaveLength(1);
  expect(modelContexts[2]?.tools ?? []).toHaveLength(0);
  expect(terminal).toMatchObject({
    status: "completed",
    errorCode: null,
    completionReason: "max_turns",
  });

  // 收尾轮产生了文字回答，并落到 transcript
  const completed = events.filter(
    (event) => event.type === "message.completed",
  );
  expect(completed).toHaveLength(3);
  expect(completed.at(-1)).toMatchObject({
    data: { content: "根据已有结果给出结论。" },
  });
  const transcript = await store.readTranscript({ sessionId, lane: "main" });
  const rawTranscript = JSON.stringify(transcript);
  expect(rawTranscript).toContain("根据已有结果给出结论。");
  // 收尾提示只进内存 context，不写 Pi transcript
  expect(rawTranscript).not.toContain("Tools are no longer available");
  expect(JSON.stringify(modelContexts[2]?.messages)).toContain(
    "Tools are no longer available",
  );
  expect(events.filter((event) => event.type === "turn.started")).toHaveLength(
    3,
  );

  registry.release(runId);
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

it("撞上 maxTurns 时模型已给文字回答则不追加收尾轮", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-turn-text-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const sessionId = generateId();
  const runId = generateId();
  await store.createSession({ id: sessionId });
  let calls = 0;
  const streamFn = (
    _requestModel: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    calls += 1;
    if (calls === 1) {
      return streamResponse(
        assistantMessage(
          [
            {
              type: "toolCall",
              id: "tool-call-1",
              name: "lookup",
              arguments: { value: "input" },
            },
          ],
          "toolUse",
        ),
        "toolUse",
      );
    }
    return streamResponse(
      assistantMessage([{ type: "text", text: "已经够了。" }], "stop"),
      "stop",
    );
  };
  const tools = createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "Look up a value",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      scope: "platform",
      requiredPermission: null,
      execute: async () => ({
        modelText: "tool-result",
        safeSummary: "looked up",
      }),
    }),
  ]);
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const registry = createActiveRunRegistry();
  const prepared = executor.prepare({
    runId,
    sessionId,
    lane: "main",
    userId: generateId(),
    requestId: "request-max-turns-text",
    input: "lookup once",
    sequencer: createEventSequencer(),
    config: {
      model: { providerId: model.provider, modelId: model.id },
      maxTurns: 2,
      tools: tools.list(),
    },
  });
  const lease = registry.reserve(sessionId, "main");
  registry.attach(lease, runId, prepared.controls);
  await prepared.start();
  const terminal = await prepared.result;
  await collect(prepared.events);

  expect(calls).toBe(2);
  expect(terminal).toMatchObject({
    status: "completed",
    errorCode: null,
    completionReason: "model_finished",
  });

  registry.release(runId);
  await store.close();
  await rm(directory, { recursive: true, force: true });
});
