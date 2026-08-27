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
import { ApiErrorCodes } from "@starter/contracts";
import type { AgentThinkingLevel } from "@starter/contracts";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import type { TelemetryContext } from "@earendil-works/pi-telemetry";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import type { AppLogger } from "@api/infra/log/index.js";
import {
  aiAgentRuns,
  aiModelCalls,
  aiRunEvents,
  aiRunSteps,
  aiRunTurns,
  aiToolExecutions,
} from "@api/infra/db/schema/index.js";
import { RUN_EVENT_MERGE_MAX_BYTES } from "@api/modules/ai/run/run-event.publisher.js";
import type { AiToolSourceInput } from "@api/modules/ai/tool/tool-registry.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";
import { z } from "zod";

import { register } from "./helpers.js";
import {
  assistantMessage,
  createSessionId,
  lookupTool,
  parseSseEvents,
  readSseBody,
  runTestApp,
  seedAgent,
  seedEnabledModel,
  startRunAndReadSse,
  streamAssistant,
  streamModel,
  streamProviderError,
  type RunSseEvent,
} from "./ai-run-harness.js";

type Runtime = ReturnType<typeof runTestApp>["runtime"];

/** 一个 Run 结束后，四张执行记录表都不能留 running 行。 */
function expectNoRunningRecords(runtime: Runtime, runId: string): void {
  expect(
    runtime.db
      .select()
      .from(aiRunTurns)
      .where(eq(aiRunTurns.runId, runId))
      .all()
      .filter((row) => row.outcome === "running"),
  ).toEqual([]);
  expect(
    runtime.db
      .select()
      .from(aiRunSteps)
      .where(eq(aiRunSteps.runId, runId))
      .all()
      .filter((row) => row.outcome === "running"),
  ).toEqual([]);
  expect(
    runtime.db
      .select()
      .from(aiModelCalls)
      .where(eq(aiModelCalls.runId, runId))
      .all()
      .filter((row) => row.result === "running"),
  ).toEqual([]);
  expect(
    runtime.db
      .select()
      .from(aiToolExecutions)
      .where(eq(aiToolExecutions.runId, runId))
      .all()
      .filter((row) => row.status === "running"),
  ).toEqual([]);
}

interface RunScenario {
  streamSimple: Models["streamSimple"];
  tools?: ReturnType<typeof createAiToolRegistry>;
  toolRefs?: { name: string; version: string }[];
  maxTurns?: number;
  thinkingLevel?: AgentThinkingLevel;
  model?: Model<Api>;
  completeSimple?: Models["completeSimple"];
  compaction?: { reserveTokens?: number; keepRecentTokens?: number };
  input?: string;
  email: string;
  prefix: string;
  /** 断言 span 属性时传 InMemory telemetry。 */
  telemetry?: TelemetryContext;
  /** 断言被拒绝的工具上报时传假 logger。 */
  logger?: AppLogger;
  /** Run 启动前预置 Pi Session 历史，例如触发 compaction。 */
  seedHistory?: boolean;
}

/** 跑一个完整 Run，把 runtime、runId 和 SSE 事件交给断言，最后统一清理。 */
async function withRun(
  scenario: RunScenario,
  assertions: (context: {
    runtime: Runtime;
    runId: string;
    events: RunSseEvent[];
  }) => void | Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    join(tmpdir(), `starter-${scenario.prefix}-`),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const { app, cleanup, runtime } = runTestApp({
    store,
    streamSimple: scenario.streamSimple,
    tools: scenario.tools ?? createAiToolRegistry([]),
    ...(scenario.model ? { model: scenario.model } : {}),
    ...(scenario.telemetry ? { telemetry: scenario.telemetry } : {}),
    ...(scenario.logger ? { logger: scenario.logger } : {}),
    ...(scenario.completeSimple
      ? { completeSimple: scenario.completeSimple }
      : {}),
    ...(scenario.compaction ? { compaction: scenario.compaction } : {}),
  });
  try {
    const user = await register(app, scenario.email);
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, scenario.toolRefs ?? [], {
      ...(scenario.maxTurns === undefined
        ? {}
        : { maxTurns: scenario.maxTurns }),
      ...(scenario.thinkingLevel === undefined
        ? {}
        : { thinkingLevel: scenario.thinkingLevel }),
    });
    if (scenario.seedHistory) {
      const sessionId = await createSessionId(app, user.cookie);
      const session = await store.openSession(sessionId);
      await session.appendMessage("main", {
        role: "user",
        content: "history ".repeat(100),
        timestamp: Date.now(),
      });
      const started = await app.request(`/api/ai/sessions/${sessionId}/runs`, {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, input: scenario.input ?? "continue" }),
      });
      expect(started.status).toBe(200);
      const events = parseSseEvents(await readSseBody(started));
      await assertions({
        runtime,
        runId: events[0]?.runId ?? "",
        events,
      });
      return;
    }
    const { runId, events } = await startRunAndReadSse(app, user.cookie, {
      agentId,
      input: scenario.input ?? "go",
    });
    await assertions({ runtime, runId, events });
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
}

/** 一轮工具调用 + 一轮文字回答的模型桩。 */
function toolThenTextStream(toolCallId: string): Models["streamSimple"] {
  return ((
    _model: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return streamAssistant(
        assistantMessage(
          [
            { type: "thinking", thinking: "visible reasoning trace" },
            { type: "text", text: "final answer" },
          ],
          "stop",
        ),
        "stop",
      );
    }
    return streamAssistant(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: toolCallId,
            name: "lookup",
            arguments: { value: "SECRET-TOOL-ARG" },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  }) as unknown as Models["streamSimple"];
}

it("两轮模型调用和一次 Tool 的事件关联与 SQLite 执行记录一致", async () => {
  await withRun(
    {
      prefix: "run-correlation",
      email: "run-correlation@example.com",
      streamSimple: toolThenTextStream("tool-call-correlation-1"),
      tools: lookupTool(),
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
      thinkingLevel: "medium",
      input: "lookup then answer",
    },
    ({ runtime, runId, events }) => {
      const turnRows = runtime.db
        .select()
        .from(aiRunTurns)
        .where(eq(aiRunTurns.runId, runId))
        .all();
      const stepRows = runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all();
      const modelRows = runtime.db
        .select()
        .from(aiModelCalls)
        .where(eq(aiModelCalls.runId, runId))
        .all();
      const toolRows = runtime.db
        .select()
        .from(aiToolExecutions)
        .where(eq(aiToolExecutions.runId, runId))
        .all();
      expect(turnRows).toHaveLength(2);
      expect(stepRows).toHaveLength(2);
      expect(modelRows).toHaveLength(2);
      expect(toolRows).toHaveLength(1);

      // 所有事件都属于同一个 Run，sequence 从 1 开始连续
      expect(events.every((event) => event.runId === runId)).toBe(true);
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_event, index) => index + 1),
      );

      const stepIds = new Set(stepRows.map((row) => row.id));
      const modelCallIds = new Set(modelRows.map((row) => row.id));
      const turnIdByIndex = new Map(
        turnRows.map((row) => [row.turnIndex, row.id]),
      );
      const stepByTurn = new Map(stepRows.map((row) => [row.turnId, row.id]));
      for (const event of events) {
        if (event.stepId !== null) expect(stepIds.has(event.stepId)).toBe(true);
        if (event.modelCallId !== null) {
          expect(modelCallIds.has(event.modelCallId)).toBe(true);
        }
        if (event.turnIndex !== null && event.stepId !== null) {
          // 事件的 stepId 必须是它自己那一轮的 Step
          const turnId = turnIdByIndex.get(event.turnIndex);
          expect(stepByTurn.get(turnId ?? "")).toBe(event.stepId);
        }
      }

      // Tool 生命周期事件带 toolCallId 和 toolExecutionId，其他事件不带
      const toolEvents = events.filter((event) =>
        event.type.startsWith("tool."),
      );
      expect(toolEvents.map((event) => event.type)).toEqual([
        "tool.started",
        "tool.completed",
      ]);
      const toolRow = toolRows[0];
      if (!toolRow) throw new Error("缺少 Tool 执行记录");
      for (const event of toolEvents) {
        expect(event.toolCallId).toBe("tool-call-correlation-1");
        expect(event.toolExecutionId).toBe(toolRow.id);
        expect(event.modelCallId).toBe(toolRow.modelCallId);
        expect(event.stepId).toBe(toolRow.stepId);
      }
      expect(toolRow.toolCallId).toBe("tool-call-correlation-1");
      for (const event of events.filter(
        (candidate) => !candidate.type.startsWith("tool."),
      )) {
        expect(event.toolCallId).toBeNull();
        expect(event.toolExecutionId).toBeNull();
      }

      // 两次模型调用各自一组 started / first_output / completed
      const modelEvents = events.filter((event) =>
        event.type.startsWith("model_call."),
      );
      expect(modelEvents.map((event) => event.type)).toEqual([
        "model_call.started",
        "model_call.first_output",
        "model_call.completed",
        "model_call.started",
        "model_call.first_output",
        "model_call.completed",
      ]);
      expect(new Set(modelEvents.map((event) => event.modelCallId)).size).toBe(
        2,
      );
      expect(new Set(modelRows.map((row) => row.id))).toEqual(
        new Set(modelEvents.map((event) => event.modelCallId as string)),
      );
      for (const row of modelRows) {
        expect(row.turnId).not.toBeNull();
        expect(row.stepId).not.toBeNull();
        expect(stepIds.has(row.stepId ?? "")).toBe(true);
      }

      // 产品事件不带 system prompt、Tool 参数和原始 Tool 结果
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("SECRET-TOOL-ARG");
      expect(serialized).not.toContain("SECRET-TOOL-RESULT");
      expect(serialized).not.toContain("SECRET-SYSTEM-PROMPT");
      // thinkingLevel 为 medium：display policy 开，思考边界和正文都在事件里
      expect(
        events.find((event) => event.type === "thinking.completed")?.data,
      ).toMatchObject({ display: true, summary: null });
    },
  );
});

it("model_call.first_output 每次模型调用只发一次，text、thinking 和 tool-call 首输出都能触发", async () => {
  // 第一轮首输出是 toolCall，第二轮首输出是 thinking
  await withRun(
    {
      prefix: "run-first-output-tool",
      email: "run-first-output-tool@example.com",
      streamSimple: toolThenTextStream("tool-call-first-output-1"),
      tools: lookupTool(),
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
      thinkingLevel: "medium",
    },
    ({ events }) => {
      const started = events.filter(
        (event) => event.type === "model_call.started",
      );
      const firstOutputs = events.filter(
        (event) => event.type === "model_call.first_output",
      );
      expect(started).toHaveLength(2);
      expect(firstOutputs).toHaveLength(2);
      expect(new Set(firstOutputs.map((event) => event.modelCallId))).toEqual(
        new Set(started.map((event) => event.modelCallId)),
      );
      // 首输出事件排在同一次模型调用的第一个内容事件之前
      const firstToolStarted = events.findIndex(
        (event) => event.type === "tool.started",
      );
      const firstThinking = events.findIndex(
        (event) => event.type === "thinking.started",
      );
      expect(events.indexOf(firstOutputs[0] as RunSseEvent)).toBeLessThan(
        firstToolStarted,
      );
      expect(events.indexOf(firstOutputs[1] as RunSseEvent)).toBeLessThan(
        firstThinking,
      );
      for (const event of firstOutputs) {
        expect(typeof event.data.elapsedMs).toBe("number");
      }
    },
  );

  // 纯文本首输出
  await withRun(
    {
      prefix: "run-first-output-text",
      email: "run-first-output-text@example.com",
      streamSimple: (() =>
        streamAssistant(
          assistantMessage([{ type: "text", text: "plain answer" }], "stop"),
          "stop",
        )) as unknown as Models["streamSimple"],
    },
    ({ events }) => {
      const firstOutputs = events.filter(
        (event) => event.type === "model_call.first_output",
      );
      expect(firstOutputs).toHaveLength(1);
      expect(events.indexOf(firstOutputs[0] as RunSseEvent)).toBeLessThan(
        events.findIndex((event) => event.type === "message.delta"),
      );
    },
  );
});

it("message delta 合并后 sequence 连续，事件行数不随 token 数线性增长", async () => {
  const chunk = "0123456789";
  const chunkCount = 200;
  const fullText = chunk.repeat(chunkCount);
  const totalBytes = Buffer.byteLength(fullText, "utf8");
  const streamSimple = (() => {
    const stream = createAssistantMessageEventStream();
    const pending = assistantMessage([], "pending");
    stream.push({ type: "start", partial: pending });
    for (let index = 0; index < chunkCount; index += 1) {
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: chunk,
        partial: pending,
      });
    }
    const done: AssistantMessage = assistantMessage(
      [{ type: "text", text: fullText }],
      "stop",
    );
    stream.push({ type: "done", reason: "stop", message: done });
    return stream;
  }) as unknown as Models["streamSimple"];

  await withRun(
    {
      prefix: "run-delta-merge",
      email: "run-delta-merge@example.com",
      streamSimple,
    },
    ({ runtime, runId, events }) => {
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_event, index) => index + 1),
      );
      const deltaEvents = events.filter(
        (event) => event.type === "message.delta",
      );
      // 每个合并事件至少攒到 1KB 才落库，最后不足 1KB 的那段由 message.completed 前的 flush 落库
      const maxDeltaEvents =
        Math.ceil(totalBytes / RUN_EVENT_MERGE_MAX_BYTES) + 1;
      expect(deltaEvents.length).toBeGreaterThan(0);
      expect(deltaEvents.length).toBeLessThanOrEqual(maxDeltaEvents);
      expect(deltaEvents.length).toBeLessThan(chunkCount);
      // 合并不丢内容
      expect(
        deltaEvents.map((event) => event.data.delta as string).join(""),
      ).toBe(fullText);

      const deltaRows = runtime.db
        .select()
        .from(aiRunEvents)
        .where(eq(aiRunEvents.runId, runId))
        .all()
        .filter((row) => row.type === "message.delta");
      expect(deltaRows).toHaveLength(deltaEvents.length);
      const sequences = runtime.db
        .select()
        .from(aiRunEvents)
        .where(eq(aiRunEvents.runId, runId))
        .all()
        .map((row) => row.sequence)
        .sort((left, right) => left - right);
      expect(sequences).toEqual(sequences.map((_value, index) => index + 1));
    },
  );
});

it("tool 失败、tool 超时、模型失败、max turns 和 compaction 结束后都没有 running 执行记录", async () => {
  const failingTools = createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "Always fails",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      scope: "platform",
      requiredPermission: null,
      execute: async () => {
        throw new Error("SECRET-TOOL-CRASH");
      },
    }),
  ]);
  const slowTools = createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "Times out",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 100,
      scope: "platform",
      requiredPermission: null,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { modelText: "late", safeSummary: null };
      },
    }),
  ]);

  await withRun(
    {
      prefix: "run-running-tool-failed",
      email: "run-running-tool-failed@example.com",
      streamSimple: toolThenTextStream("tool-call-running-failed"),
      tools: failingTools,
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
    },
    ({ runtime, runId, events }) => {
      expect(events.at(-1)?.type).toBe("run.completed");
      expect(
        events.find((event) => event.type === "tool.completed")?.data.status,
      ).toBe("failed");
      expectNoRunningRecords(runtime, runId);
    },
  );

  await withRun(
    {
      prefix: "run-running-tool-timeout",
      email: "run-running-tool-timeout@example.com",
      streamSimple: toolThenTextStream("tool-call-running-timeout"),
      tools: slowTools,
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
    },
    ({ runtime, runId, events }) => {
      expect(events.at(-1)?.type).toBe("run.completed");
      expect(
        events.find((event) => event.type === "tool.completed")?.data.status,
      ).toBe("timed_out");
      expectNoRunningRecords(runtime, runId);
    },
  );

  await withRun(
    {
      prefix: "run-running-model-failed",
      email: "run-running-model-failed@example.com",
      streamSimple: (() =>
        streamProviderError()) as unknown as Models["streamSimple"],
    },
    ({ runtime, runId, events }) => {
      expect(events.at(-1)).toMatchObject({
        type: "run.failed",
        data: { error: { code: ApiErrorCodes.AI_UPSTREAM_ERROR } },
      });
      expect(
        events.find((event) => event.type === "model_call.failed")?.data,
      ).toMatchObject({ error: { code: ApiErrorCodes.AI_UPSTREAM_ERROR } });
      expectNoRunningRecords(runtime, runId);
    },
  );

  await withRun(
    {
      prefix: "run-running-max-turns",
      email: "run-running-max-turns@example.com",
      // 模型只要拿不到 toolResult 就一直调工具，撞上 maxTurns 后由收尾轮回答
      streamSimple: ((
        _model: Model<Api>,
        context: Context,
        _options?: SimpleStreamOptions,
      ) => {
        const tools = context.tools ?? [];
        if (tools.length === 0) {
          return streamAssistant(
            assistantMessage([{ type: "text", text: "wrap up" }], "stop"),
            "stop",
          );
        }
        return streamAssistant(
          assistantMessage(
            [
              {
                type: "toolCall",
                id: `tool-call-max-turns-${context.messages.length}`,
                name: "lookup",
                arguments: { value: "again" },
              },
            ],
            "toolUse",
          ),
          "toolUse",
        );
      }) as unknown as Models["streamSimple"],
      tools: lookupTool(),
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
      maxTurns: 1,
    },
    ({ runtime, runId, events }) => {
      expect(events.at(-1)).toMatchObject({
        type: "run.completed",
        data: { reason: "max_turns" },
      });
      expectNoRunningRecords(runtime, runId);
    },
  );

  await withRun(
    {
      prefix: "run-running-compaction",
      email: "run-running-compaction@example.com",
      streamSimple: (() =>
        streamAssistant(
          assistantMessage([{ type: "text", text: "answer" }], "stop"),
          "stop",
        )) as unknown as Models["streamSimple"],
      model: { ...streamModel, contextWindow: 32 },
      completeSimple: (async () =>
        assistantMessage(
          [{ type: "text", text: "SECRET-COMPACTION-SUMMARY" }],
          "stop",
        )) as unknown as Models["completeSimple"],
      compaction: { reserveTokens: 10, keepRecentTokens: 0 },
      seedHistory: true,
    },
    ({ runtime, runId, events }) => {
      expect(events.some((event) => event.type === "context.compacted")).toBe(
        true,
      );
      expect(events.at(-1)?.type).toBe("run.completed");
      expectNoRunningRecords(runtime, runId);
    },
  );
});

it("abort 结束后没有 running 执行记录", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-abort-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const streamSimple = (() => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: assistantMessage([], "pending") });
    void gate.then(() => {
      stream.push({
        type: "done",
        reason: "stop",
        message: assistantMessage([{ type: "text", text: "late" }], "stop"),
      });
    });
    return stream;
  }) as unknown as Models["streamSimple"];
  const { app, cleanup, runtime } = runTestApp({
    store,
    streamSimple,
    tools: createAiToolRegistry([]),
  });
  try {
    const user = await register(app, "run-abort-running@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);
    const sessionId = await createSessionId(app, user.cookie);
    const startedPromise = app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, input: "abort me" }),
    });
    let runId = "";
    await vi.waitFor(async () => {
      await startedPromise;
      const rows = runtime.db
        .select()
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.sessionId, sessionId))
        .all();
      expect(rows).toHaveLength(1);
      runId = rows[0]?.id ?? "";
      expect(runId).toBeTruthy();
    });
    const aborted = await app.request(
      `/api/ai/sessions/${sessionId}/runs/${runId}/abort`,
      { method: "POST", headers: { cookie: user.cookie } },
    );
    expect(aborted.status).toBe(200);
    release();

    const events = parseSseEvents(await readSseBody(await startedPromise));
    expect(events.at(-1)?.type).toBe("run.aborted");
    expectNoRunningRecords(runtime, runId);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("事件写库失败时 Run 进入存储失败终态，客户端不会收到跳号事件和 run.completed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-event-fail-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const { app, cleanup, runtime } = runTestApp({
    store,
    streamSimple: (() =>
      streamAssistant(
        assistantMessage([{ type: "text", text: "answer" }], "stop"),
        "stop",
      )) as unknown as Models["streamSimple"],
    tools: createAiToolRegistry([]),
  });
  try {
    const user = await register(app, "run-event-storage@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);
    // 只让 message.completed 这一条事件写库失败，模拟中途持久化故障
    runtime.database.sqlite.exec(`
      CREATE TRIGGER fail_message_completed
      BEFORE INSERT ON ai_run_events
      WHEN NEW.type = 'message.completed'
      BEGIN SELECT RAISE(ABORT, 'event storage failure'); END;
    `);

    const { runId, events } = await startRunAndReadSse(app, user.cookie, {
      agentId,
      input: "answer",
    });

    // 失败的事件既不入库也不发给客户端
    expect(events.map((event) => event.type)).not.toContain(
      "message.completed",
    );
    expect(events.map((event) => event.type)).not.toContain("run.completed");
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      data: { error: { code: ApiErrorCodes.AI_SESSION_STORAGE_FAILED } },
    });
    // 没有 sequence 空洞
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_event, index) => index + 1),
    );
    const rows = runtime.db
      .select()
      .from(aiRunEvents)
      .where(eq(aiRunEvents.runId, runId))
      .all();
    expect(rows.map((row) => row.sequence).sort((a, b) => a - b)).toEqual(
      events.map((event) => event.sequence),
    );
    const run = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, runId))
      .get();
    expect(run?.status).toBe("failed");
    expect(run?.errorCode).toBe(ApiErrorCodes.AI_SESSION_STORAGE_FAILED);
    expectNoRunningRecords(runtime, runId);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("step 事件与 ai_run_steps 一一对应，assistant 和 compaction Step 都发布", async () => {
  await withRun(
    {
      prefix: "run-step-events",
      email: "run-step-events@example.com",
      streamSimple: toolThenTextStream("tool-call-step-events-1"),
      tools: lookupTool(),
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
      // 小 contextWindow + 预置历史让第一轮就走 compaction Step
      model: { ...streamModel, contextWindow: 32 },
      completeSimple: (async () =>
        assistantMessage(
          [{ type: "text", text: "compaction summary" }],
          "stop",
        )) as unknown as Models["completeSimple"],
      compaction: { reserveTokens: 10, keepRecentTokens: 0 },
      seedHistory: true,
      input: "lookup then answer",
    },
    ({ runtime, runId, events }) => {
      const stepRows = runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all();
      const startedEvents = events.filter(
        (event) => event.type === "step.started",
      );
      const completedEvents = events.filter(
        (event) => event.type === "step.completed",
      );

      // 两轮模型调用各一个 assistant Step，加上至少一个 compaction Step
      expect(stepRows.filter((row) => row.kind === "assistant")).toHaveLength(
        2,
      );
      expect(
        stepRows.filter((row) => row.kind === "compaction").length,
      ).toBeGreaterThanOrEqual(1);
      // 事件数量与库里行数一致，成对出现
      expect(startedEvents).toHaveLength(stepRows.length);
      expect(completedEvents).toHaveLength(stepRows.length);

      for (const row of stepRows) {
        const startedIndex = events.findIndex(
          (event) => event.type === "step.started" && event.stepId === row.id,
        );
        const completedIndex = events.findIndex(
          (event) => event.type === "step.completed" && event.stepId === row.id,
        );
        expect(startedIndex).toBeGreaterThanOrEqual(0);
        expect(startedIndex).toBeLessThan(completedIndex);
        expect(events[startedIndex]?.data).toEqual({
          kind: row.kind,
          attempt: row.attempt,
        });
        // outcome 与 error 与库里的 Step 行一致
        expect(events[completedIndex]?.data).toEqual({
          kind: row.kind,
          attempt: row.attempt,
          outcome: row.outcome,
          error: null,
        });
        expect(row.errorCode).toBeNull();
      }

      // compaction Step 的 Step 事件和 context.compacted 用同一个 stepId
      const compactionRow = stepRows.find((row) => row.kind === "compaction");
      expect(
        events.find((event) => event.type === "context.compacted")?.stepId,
      ).toBe(compactionRow?.id);
      // assistant Step 的事件挂在自己那一轮，模型和 Tool 事件共用同一个 stepId
      const assistantRows = stepRows.filter((row) => row.kind === "assistant");
      for (const row of assistantRows) {
        const modelStarted = events.find(
          (event) =>
            event.type === "model_call.started" && event.stepId === row.id,
        );
        expect(modelStarted).toBeDefined();
      }
      expectNoRunningRecords(runtime, runId);
    },
  );
});

it("失败 Run 的 step.completed 带失败 outcome 和稳定错误码", async () => {
  await withRun(
    {
      prefix: "run-step-failed",
      email: "run-step-failed@example.com",
      streamSimple: (() =>
        streamProviderError()) as unknown as Models["streamSimple"],
    },
    ({ runtime, runId, events }) => {
      const stepRows = runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all();
      expect(stepRows).toHaveLength(1);
      const row = stepRows[0];
      if (!row) throw new Error("缺少 Step 记录");
      expect(row.outcome).toBe("failed");
      expect(row.errorCode).toBe(ApiErrorCodes.AI_UPSTREAM_ERROR);

      const completed = events.find((event) => event.type === "step.completed");
      expect(completed?.stepId).toBe(row.id);
      expect(completed?.data).toEqual({
        kind: "assistant",
        attempt: 1,
        outcome: "failed",
        error: {
          code: ApiErrorCodes.AI_UPSTREAM_ERROR,
          category: "upstream",
          retryable: true,
        },
      });
      // 产品事件不带 Provider 原始错误
      expect(JSON.stringify(events)).not.toContain("SECRET-PROVIDER-ERROR");
    },
  );
});

/** 一次工具调用后回答文字的模型桩，工具执行时上报 source。 */
function sourceReportingTools(
  sources: readonly unknown[],
): ReturnType<typeof createAiToolRegistry> {
  return createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "Look up a value and report sources",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      scope: "platform",
      requiredPermission: null,
      execute: async (context) => {
        for (const source of sources) {
          context.reportSource?.(source as AiToolSourceInput);
        }
        return { modelText: "SECRET-TOOL-RESULT", safeSummary: "looked up" };
      },
    }),
  ]);
}

function fakeLogger(): { logger: AppLogger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  return {
    warn,
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn,
    } as unknown as AppLogger,
  };
}

it("工具上报的合法 source 发布 source.available 并落库，关联字段指向当前 Tool", async () => {
  const { logger, warn } = fakeLogger();
  await withRun(
    {
      prefix: "run-source-ok",
      email: "run-source-ok@example.com",
      streamSimple: toolThenTextStream("tool-call-source-1"),
      tools: sourceReportingTools([
        {
          sourceId: "doc-1",
          kind: "document",
          title: "公开文档",
          uri: "https://example.com/doc?page=2",
          excerpt: "文档摘要",
        },
        // uri 和 excerpt 可以省略，服务端按 null 处理
        { sourceId: "doc-2", kind: "memory", title: "会话记忆" },
      ]),
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
      logger,
    },
    ({ runtime, runId, events }) => {
      const sourceEvents = events.filter(
        (event) => event.type === "source.available",
      );
      expect(sourceEvents).toHaveLength(2);
      expect(sourceEvents.map((event) => event.data)).toEqual([
        {
          sourceId: "doc-1",
          kind: "document",
          title: "公开文档",
          uri: "https://example.com/doc?page=2",
          excerpt: "文档摘要",
        },
        {
          sourceId: "doc-2",
          kind: "memory",
          title: "会话记忆",
          uri: null,
          excerpt: null,
        },
      ]);

      const toolRow = runtime.db
        .select()
        .from(aiToolExecutions)
        .where(eq(aiToolExecutions.runId, runId))
        .all()[0];
      if (!toolRow) throw new Error("缺少 Tool 执行记录");
      for (const event of sourceEvents) {
        expect(event.toolCallId).toBe("tool-call-source-1");
        expect(event.toolExecutionId).toBe(toolRow.id);
        expect(event.stepId).toBe(toolRow.stepId);
      }
      // 事件排在 tool.started 之后、tool.completed 之前
      const startedIndex = events.findIndex(
        (event) => event.type === "tool.started",
      );
      const completedIndex = events.findIndex(
        (event) => event.type === "tool.completed",
      );
      for (const event of sourceEvents) {
        const index = events.indexOf(event);
        expect(index).toBeGreaterThan(startedIndex);
        expect(index).toBeLessThan(completedIndex);
      }

      // 落进持久时间线，sequence 连续
      const rows = runtime.db
        .select()
        .from(aiRunEvents)
        .where(eq(aiRunEvents.runId, runId))
        .all();
      expect(
        rows.filter((row) => row.type === "source.available"),
      ).toHaveLength(2);
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_event, index) => index + 1),
      );
      // 合法上报不写安全日志，Tool 正常完成
      expect(warn).not.toHaveBeenCalled();
      expect(
        events.find((event) => event.type === "tool.completed")?.data,
      ).toMatchObject({ status: "succeeded" });
      expect(events.at(-1)?.type).toBe("run.completed");
      // source 不带 Tool 原始结果
      expect(JSON.stringify(sourceEvents)).not.toContain("SECRET-TOOL-RESULT");
    },
  );
});

it("非法 source 被丢弃并记安全日志，Tool 仍然正常完成", async () => {
  const { logger, warn } = fakeLogger();
  await withRun(
    {
      prefix: "run-source-rejected",
      email: "run-source-rejected@example.com",
      streamSimple: toolThenTextStream("tool-call-source-2"),
      tools: sourceReportingTools([
        // file: 协议
        {
          sourceId: "bad-1",
          kind: "file",
          title: "本地文件",
          uri: "file:///etc/passwd",
        },
        // 内网地址
        {
          sourceId: "bad-2",
          kind: "document",
          title: "内网文档",
          uri: "http://127.0.0.1:8080/secret",
        },
        {
          sourceId: "bad-3",
          kind: "document",
          title: "元数据服务",
          uri: "http://169.254.169.254/latest/meta-data",
        },
        // 带 credential 的 URL
        {
          sourceId: "bad-4",
          kind: "document",
          title: "带凭据",
          uri: "https://user:secret@example.com/doc",
        },
        // schema 不合法：缺 title
        { sourceId: "bad-5", kind: "document", uri: "https://example.com/x" },
        // schema 不合法：多余字段
        {
          sourceId: "bad-6",
          kind: "document",
          title: "多余字段",
          uri: "https://example.com/y",
          rawResult: "SECRET-TOOL-RESULT",
        },
      ]),
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
      logger,
    },
    ({ runtime, runId, events }) => {
      expect(
        events.filter((event) => event.type === "source.available"),
      ).toHaveLength(0);
      expect(
        runtime.db
          .select()
          .from(aiRunEvents)
          .where(eq(aiRunEvents.runId, runId))
          .all()
          .filter((row) => row.type === "source.available"),
      ).toHaveLength(0);
      // 每条非法上报写一条安全日志，日志字段里没有 source 正文
      expect(warn).toHaveBeenCalledTimes(6);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain("127.0.0.1");
      expect(logged).not.toContain("SECRET-TOOL-RESULT");
      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        reason: "url",
        toolName: "lookup",
        toolCallId: "tool-call-source-2",
        runId,
      });
      expect(warn.mock.calls[4]?.[0]).toMatchObject({ reason: "schema" });
      // Tool 与 Run 都不受影响
      expect(
        events.find((event) => event.type === "tool.completed")?.data,
      ).toMatchObject({ status: "succeeded" });
      expect(events.at(-1)?.type).toBe("run.completed");
    },
  );
});

it("工具不上报 source 时没有 source.available 事件", async () => {
  await withRun(
    {
      prefix: "run-source-absent",
      email: "run-source-absent@example.com",
      streamSimple: toolThenTextStream("tool-call-source-3"),
      tools: lookupTool(),
      toolRefs: [{ name: "lookup", version: "1.0.0" }],
    },
    ({ events }) => {
      expect(events.some((event) => event.type === "source.available")).toBe(
        false,
      );
    },
  );
});

/** 两段 thinking 增量 + 一段文本的模型桩。 */
function thinkingStream(): Models["streamSimple"] {
  return (() => {
    const stream = createAssistantMessageEventStream();
    const partial = assistantMessage([], "pending");
    stream.push({ type: "start", partial });
    stream.push({ type: "thinking_start", contentIndex: 0, partial });
    stream.push({
      type: "thinking_delta",
      contentIndex: 0,
      delta: "REASONING-BODY-1",
      partial,
    });
    stream.push({
      type: "thinking_delta",
      contentIndex: 0,
      delta: "REASONING-BODY-2",
      partial,
    });
    stream.push({
      type: "thinking_end",
      contentIndex: 0,
      content: "REASONING-BODY-1REASONING-BODY-2",
      partial,
    });
    stream.push({
      type: "text_delta",
      contentIndex: 1,
      delta: "answer",
      partial,
    });
    stream.push({
      type: "done",
      reason: "stop",
      message: assistantMessage(
        [
          { type: "thinking", thinking: "REASONING-BODY-1REASONING-BODY-2" },
          { type: "text", text: "answer" },
        ],
        "stop",
      ),
    });
    return stream;
  }) as unknown as Models["streamSimple"];
}

it("thinkingLevel 非 off 时 thinking 事件 display 为 true 且正文完整，telemetry 不带正文", async () => {
  const recorder = new InMemoryTelemetryContext();
  await withRun(
    {
      prefix: "run-thinking-on",
      email: "run-thinking-on@example.com",
      streamSimple: thinkingStream(),
      thinkingLevel: "medium",
      telemetry: recorder,
    },
    ({ runtime, runId, events }) => {
      const thinkingEvents = events.filter((event) =>
        event.type.startsWith("thinking."),
      );
      expect(thinkingEvents.map((event) => event.type)).toEqual([
        "thinking.started",
        "thinking.delta",
        "thinking.delta",
        "thinking.completed",
      ]);
      expect(
        events.find((event) => event.type === "thinking.started")?.data,
      ).toEqual({ blockIndex: 0, display: true });
      expect(
        events.find((event) => event.type === "thinking.completed")?.data,
      ).toEqual({ blockIndex: 0, display: true, summary: null });
      // thinking 增量当前不进 publisher 的合并窗口（合并键只有 message.delta
      // 和 tool.progress），逐条发布后正文仍然无损
      expect(
        events
          .filter((event) => event.type === "thinking.delta")
          .map((event) => event.data.delta as string)
          .join(""),
      ).toBe("REASONING-BODY-1REASONING-BODY-2");
      // 思考正文只允许出现在产品事件和 ai_run_events 里
      const rows = runtime.db
        .select()
        .from(aiRunEvents)
        .where(eq(aiRunEvents.runId, runId))
        .all();
      expect(
        rows
          .filter((row) => row.type === "thinking.delta")
          .map((row) => row.payloadJson)
          .join(""),
      ).toContain("REASONING-BODY-1");
      // message.completed 只带文本
      const completedMessage = events.find(
        (event) => event.type === "message.completed",
      );
      expect(completedMessage?.data.content).toBe("answer");
      // telemetry span 不带 reasoning 正文
      expect(JSON.stringify(recorder.getSpans())).not.toContain(
        "REASONING-BODY",
      );
      // SQLite 审计表不带 reasoning 正文
      const auditRows = runtime.db
        .select()
        .from(aiModelCalls)
        .where(eq(aiModelCalls.runId, runId))
        .all();
      expect(JSON.stringify(auditRows)).not.toContain("REASONING-BODY");
    },
  );
});

it("thinkingLevel 为 off 时不产生 thinking 事件", async () => {
  await withRun(
    {
      prefix: "run-thinking-off",
      email: "run-thinking-off@example.com",
      streamSimple: thinkingStream(),
      thinkingLevel: "off",
    },
    ({ runtime, runId, events }) => {
      expect(
        events.filter((event) => event.type.startsWith("thinking.")),
      ).toHaveLength(0);
      expect(
        runtime.db
          .select()
          .from(aiRunEvents)
          .where(eq(aiRunEvents.runId, runId))
          .all()
          .filter((row) => row.type.startsWith("thinking.")),
      ).toHaveLength(0);
      // 事件流仍然连续，正文也不会混进 message.completed
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_event, index) => index + 1),
      );
      const completedMessage = events.find(
        (event) => event.type === "message.completed",
      );
      expect(completedMessage?.data.content).toBe("answer");
      expect(JSON.stringify(events)).not.toContain("REASONING-BODY");
    },
  );
});
