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
      description: "Look up a value",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
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
    tools,
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
      toolNames: ["lookup"],
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
    "message.started",
    "message.completed",
    "tool.started",
    "tool.completed",
    "message.started",
    "message.delta",
    "message.completed",
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
        description: "Look up a value",
        inputSchema: z.object({ value: z.string().min(5) }),
        timeoutMs: 1000,
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
      tools: registry,
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
        toolNames: ["lookup"],
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
      },
    });
    const registry = createActiveRunRegistry();
    const lease = registry.reserve(sessionId, "main");
    registry.attach(lease, runId, prepared.controls);

    await prepared.start();

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
