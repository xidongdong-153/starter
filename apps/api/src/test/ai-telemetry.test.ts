import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import type {
  RecordedTelemetrySpan,
  TelemetryContext,
  TelemetrySpan,
} from "@earendil-works/pi-telemetry";
import { ApiErrorCodes } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import {
  aiAgentRuns,
  aiModelCalls,
  aiRunSteps,
  aiRunTurns,
  aiToolExecutions,
} from "@api/infra/db/schema/index.js";
import {
  createAiTelemetryContext,
  openAiSpanScope,
  startAiSpan,
} from "@api/infra/telemetry/index.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";

import { register } from "./helpers.js";
import {
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
  assistantMessage,
} from "./ai-run-harness.js";

function spanByName(
  spans: readonly RecordedTelemetrySpan[],
  name: string,
): RecordedTelemetrySpan {
  const span = spans.find((candidate) => candidate.name === name);
  if (!span) throw new Error(`缺少 span: ${name}`);
  return span;
}

it("startAiSpan 与 openAiSpanScope 组成 Run -> Turn -> Step -> Model Call/Tool 的父子树", async () => {
  const recorder = new InMemoryTelemetryContext();
  const telemetry = createAiTelemetryContext(recorder);

  const run = openAiSpanScope(telemetry, "starter.ai.run", {
    "starter.ai.run.id": "run-1",
    "starter.ai.session.id": "session-1",
    "starter.ai.lane": "main",
    "starter.ai.request.id": "request-1",
    "starter.ai.run.config.source": "agent",
    "starter.ai.principal.kind": "starter_user",
    "starter.ai.tenant.id": "starter",
    "starter.ai.project.id": "starter",
    "starter.ai.agent.id": "agent-1",
    "starter.ai.agent.revision": 1,
    "starter.ai.provider": "test-provider",
    "starter.ai.model": "test-model",
    "starter.ai.output.mode": "optional",
  });
  const turn = openAiSpanScope(run.span, "starter.ai.turn", {
    "starter.ai.run.id": "run-1",
    "starter.ai.turn.id": "turn-1",
    "starter.ai.turn.index": 1,
  });
  const step = openAiSpanScope(turn.span, "starter.ai.step", {
    "starter.ai.run.id": "run-1",
    "starter.ai.turn.id": "turn-1",
    "starter.ai.step.id": "step-1",
    "starter.ai.step.kind": "assistant",
    "starter.ai.step.attempt": 1,
  });

  await startAiSpan(
    step.span,
    "starter.ai.model_call",
    {
      "starter.ai.run.id": "run-1",
      "starter.ai.step.id": "step-1",
      "starter.ai.provider": "test-provider",
      "starter.ai.model": "test-model",
      "starter.ai.api": "openai-completions",
      "starter.ai.streaming": true,
    },
    (span) => {
      span.setAttributes({
        "starter.ai.model_call.id": "model-call-1",
        "starter.ai.model_call.result": "succeeded",
      });
    },
  );
  await startAiSpan(
    step.span,
    "starter.ai.tool_execution",
    {
      "starter.ai.run.id": "run-1",
      "starter.ai.step.id": "step-1",
      "starter.ai.model_call.id": "model-call-1",
      "starter.ai.tool.name": "lookup",
      "starter.ai.tool.version": "1.0.0",
      "starter.ai.tool.call_id": "tool-call-1",
      "starter.ai.tool.attempt": 1,
      "starter.ai.tool.recovery": false,
    },
    (span) => {
      span.setAttributes({
        "starter.ai.tool.execution_id": "tool-execution-1",
        "starter.ai.tool.status": "succeeded",
      });
    },
  );

  step.close({ attributes: { "starter.ai.step.outcome": "succeeded" } });
  turn.close({ attributes: { "starter.ai.turn.outcome": "succeeded" } });
  run.close({
    attributes: {
      "starter.ai.run.outcome": "completed",
      "starter.ai.run.completion_reason": "model_finished",
    },
  });
  await vi.waitFor(() =>
    expect(recorder.getSpans().every((span) => span.settled !== false)).toBe(
      true,
    ),
  );

  const spans = recorder.getSpans();
  expect(spans.map((span) => span.name)).toEqual([
    "starter.ai.run",
    "starter.ai.turn",
    "starter.ai.step",
    "starter.ai.model_call",
    "starter.ai.tool_execution",
  ]);
  const runSpan = spanByName(spans, "starter.ai.run");
  const turnSpan = spanByName(spans, "starter.ai.turn");
  const stepSpan = spanByName(spans, "starter.ai.step");
  const modelSpan = spanByName(spans, "starter.ai.model_call");
  const toolSpan = spanByName(spans, "starter.ai.tool_execution");
  expect(runSpan.parentId).toBeNull();
  expect(turnSpan.parentId).toBe(runSpan.id);
  expect(stepSpan.parentId).toBe(turnSpan.id);
  expect(modelSpan.parentId).toBe(stepSpan.id);
  expect(toolSpan.parentId).toBe(stepSpan.id);
  expect(runSpan.attributes["starter.ai.run.outcome"]).toBe("completed");
  expect(stepSpan.attributes["starter.ai.step.outcome"]).toBe("succeeded");
  expect(modelSpan.attributes["starter.ai.model_call.id"]).toBe("model-call-1");
  expect(toolSpan.attributes["starter.ai.tool.execution_id"]).toBe(
    "tool-execution-1",
  );
});

it("telemetry adapter 抛错时业务 callback 仍然只执行一次并返回原结果", async () => {
  const failures: string[] = [];
  const telemetry = createAiTelemetryContext(
    {
      startSpan: () => {
        throw new Error("telemetry-broken");
      },
    },
    {
      onFailure: (failure) =>
        failures.push(`${failure.span}:${failure.operation}`),
    },
  );
  const callback = vi.fn(() => "business-result");

  const result = await startAiSpan(
    telemetry,
    "starter.ai.turn",
    {
      "starter.ai.run.id": "run-1",
      "starter.ai.turn.id": "turn-1",
      "starter.ai.turn.index": 1,
    },
    callback,
  );

  expect(result).toBe("business-result");
  expect(callback).toHaveBeenCalledOnce();
  expect(failures).toEqual(["starter.ai.turn:start_span"]);
});

it("span 的 setAttributes/setStatus 抛错不影响业务结果，异常只报告一次", async () => {
  const failures: string[] = [];
  const brokenSpan: TelemetrySpan = {
    startSpan: (_options, callback) => Promise.resolve(callback(brokenSpan)),
    setAttributes: () => {
      throw new Error("attributes-broken");
    },
    setStatus: () => {
      throw new Error("status-broken");
    },
    addEvent: () => undefined,
  };
  const telemetry = createAiTelemetryContext(
    {
      startSpan: (_options, callback) => Promise.resolve(callback(brokenSpan)),
    },
    { onFailure: (failure) => failures.push(failure.operation) },
  );

  const outcome = await startAiSpan(
    telemetry,
    "starter.ai.step",
    {
      "starter.ai.run.id": "run-1",
      "starter.ai.step.id": "step-1",
      "starter.ai.step.kind": "assistant",
      "starter.ai.step.attempt": 1,
    },
    (span) => {
      span.setAttributes({ "starter.ai.step.outcome": "succeeded" });
      span.setStatus({ status: "ok" });
      return "still-fine";
    },
  );

  expect(outcome).toBe("still-fine");
  expect(failures).toEqual(["set_attributes", "set_status"]);
});

it("业务 callback 抛错时保留原始异常，不被 telemetry 改写", async () => {
  const recorder = new InMemoryTelemetryContext();
  const failures: string[] = [];
  const telemetry = createAiTelemetryContext(recorder, {
    onFailure: (failure) => failures.push(failure.operation),
  });
  const error = new Error("business-failed");

  await expect(
    startAiSpan(
      telemetry,
      "starter.ai.turn",
      {
        "starter.ai.run.id": "run-1",
        "starter.ai.turn.id": "turn-1",
        "starter.ai.turn.index": 1,
      },
      () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
  expect(
    spanByName(recorder.getSpans(), "starter.ai.turn").status,
  ).toMatchObject({ status: "error" });
  // 业务异常经 adapter 原样抛回，不能被当成 telemetry 故障上报
  await vi.waitFor(() => expect(failures).toEqual([]));
});

it("run 的 span 树与 SQLite 审计、Turn/Step 记录和 RunEvent 关联字段一致", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-telemetry-run-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const recorder = new InMemoryTelemetryContext();
  let calls = 0;
  const streamSimple = ((
    _model: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    calls += 1;
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return streamAssistant(
        assistantMessage(
          [
            { type: "thinking", thinking: "SECRET-REASONING" },
            { type: "text", text: "SECRET-ASSISTANT-TEXT" },
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
            id: "tool-call-telemetry-1",
            name: "lookup",
            arguments: { value: "SECRET-TOOL-ARG" },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  }) as unknown as Models["streamSimple"];
  const { app, cleanup, runtime } = runTestApp({
    store,
    telemetry: recorder,
    streamSimple,
    tools: lookupTool(),
  });
  try {
    const user = await register(app, "telemetry-run@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, [{ name: "lookup", version: "1.0.0" }]);

    const { runId, events } = await startRunAndReadSse(app, user.cookie, {
      agentId,
      input: "SECRET-USER-INPUT",
    });
    expect(calls).toBe(2);
    expect(events.at(-1)?.type).toBe("run.completed");

    const spans = recorder.getSpans();
    const runSpans = spans.filter((span) => span.name === "starter.ai.run");
    const turnSpans = spans.filter((span) => span.name === "starter.ai.turn");
    const stepSpans = spans.filter((span) => span.name === "starter.ai.step");
    const modelSpans = spans.filter(
      (span) => span.name === "starter.ai.model_call",
    );
    const toolSpans = spans.filter(
      (span) => span.name === "starter.ai.tool_execution",
    );
    expect(runSpans).toHaveLength(1);
    expect(turnSpans).toHaveLength(2);
    expect(stepSpans).toHaveLength(2);
    expect(modelSpans).toHaveLength(2);
    expect(toolSpans).toHaveLength(1);

    const runSpan = runSpans[0];
    if (!runSpan) throw new Error("缺少 Run span");
    expect(runSpan.attributes["starter.ai.run.id"]).toBe(runId);
    expect(runSpan.attributes["starter.ai.run.outcome"]).toBe("completed");
    expect(runSpan.attributes["starter.ai.run.completion_reason"]).toBe(
      "model_finished",
    );
    expect(runSpan.attributes["starter.ai.principal.kind"]).toBe(
      "starter_user",
    );
    // Run -> Turn -> Step -> Model Call / Tool Execution
    for (const turnSpan of turnSpans) {
      expect(turnSpan.parentId).toBe(runSpan.id);
      expect(turnSpan.attributes["starter.ai.turn.outcome"]).toBe("succeeded");
    }
    for (const stepSpan of stepSpans) {
      expect(turnSpans.map((span) => span.id)).toContain(stepSpan.parentId);
      expect(stepSpan.attributes["starter.ai.step.kind"]).toBe("assistant");
      expect(stepSpan.attributes["starter.ai.step.outcome"]).toBe("succeeded");
    }
    for (const modelSpan of modelSpans) {
      expect(stepSpans.map((span) => span.id)).toContain(modelSpan.parentId);
      expect(modelSpan.attributes["starter.ai.model_call.result"]).toBe(
        "succeeded",
      );
      expect(modelSpan.attributes["starter.ai.provider"]).toBe(
        streamModel.provider,
      );
      expect(modelSpan.attributes["starter.ai.usage.total_tokens"]).toBe(18);
      expect(modelSpan.attributes["starter.ai.usage.reasoning_tokens"]).toBe(3);
      expect(modelSpan.attributes["starter.ai.usage.cost"]).toBeCloseTo(0.003);
      expect(modelSpan.attributes["starter.ai.response.id"]).toBe(
        "provider-response-1",
      );
    }
    const toolSpan = toolSpans[0];
    if (!toolSpan) throw new Error("缺少 Tool span");
    expect(stepSpans.map((span) => span.id)).toContain(toolSpan.parentId);
    expect(toolSpan.attributes["starter.ai.tool.status"]).toBe("succeeded");
    expect(toolSpan.attributes["starter.ai.tool.attempt"]).toBe(1);
    expect(toolSpan.attributes["starter.ai.tool.recovery"]).toBe(false);

    // span ID 与 SQLite 审计、Turn/Step 记录一致
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
    expect(
      new Set(turnSpans.map((span) => span.attributes["starter.ai.turn.id"])),
    ).toEqual(new Set(turnRows.map((row) => row.id)));
    expect(
      new Set(stepSpans.map((span) => span.attributes["starter.ai.step.id"])),
    ).toEqual(new Set(stepRows.map((row) => row.id)));
    expect(
      new Set(
        modelSpans.map((span) => span.attributes["starter.ai.model_call.id"]),
      ),
    ).toEqual(new Set(modelRows.map((row) => row.id)));
    expect(new Set(modelRows.map((row) => row.stepId))).toEqual(
      new Set(stepRows.map((row) => row.id)),
    );
    expect(toolSpan.attributes["starter.ai.tool.execution_id"]).toBe(
      toolRows[0]?.id,
    );
    expect(toolSpan.attributes["starter.ai.tool.call_id"]).toBe(
      toolRows[0]?.toolCallId,
    );

    // RunEvent 的关联字段与 span 一致
    const toolCompleted = events.find(
      (event) => event.type === "tool.completed",
    );
    expect(toolCompleted?.toolExecutionId).toBe(
      toolSpan.attributes["starter.ai.tool.execution_id"],
    );
    expect(toolCompleted?.toolCallId).toBe(
      toolSpan.attributes["starter.ai.tool.call_id"],
    );
    expect(toolCompleted?.stepId).toBe(
      stepSpans.find((span) => span.id === toolSpan.parentId)?.attributes[
        "starter.ai.step.id"
      ],
    );
    expect(
      events
        .filter((event) => event.type === "turn.started")
        .map((event) => event.turnIndex),
    ).toEqual(
      turnSpans.map((span) => span.attributes["starter.ai.turn.index"]),
    );

    // 禁止数据不得出现在 span 属性里
    const serialized = JSON.stringify(spans);
    for (const marker of [
      "SECRET-SYSTEM-PROMPT",
      "SECRET-USER-INPUT",
      "SECRET-ASSISTANT-TEXT",
      "SECRET-REASONING",
      "SECRET-TOOL-ARG",
      "SECRET-TOOL-RESULT",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("模型上游失败时 Run、Turn、Step 和 Model Call span 都记录失败终态", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-telemetry-failed-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const recorder = new InMemoryTelemetryContext();
  const { app, cleanup, runtime } = runTestApp({
    store,
    telemetry: recorder,
    streamSimple: (() =>
      streamProviderError()) as unknown as Models["streamSimple"],
    tools: createAiToolRegistry([]),
  });
  try {
    const user = await register(app, "telemetry-failed@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);

    const { events } = await startRunAndReadSse(app, user.cookie, {
      agentId,
      input: "fail please",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      data: { error: { code: ApiErrorCodes.AI_UPSTREAM_ERROR } },
    });

    const spans = recorder.getSpans();
    const runSpan = spanByName(spans, "starter.ai.run");
    expect(runSpan.attributes["starter.ai.run.outcome"]).toBe("failed");
    expect(runSpan.attributes["starter.ai.error.code"]).toBe(
      ApiErrorCodes.AI_UPSTREAM_ERROR,
    );
    expect(runSpan.attributes["starter.ai.error.category"]).toBe("upstream");
    expect(runSpan.status).toMatchObject({ status: "error" });
    const stepSpan = spanByName(spans, "starter.ai.step");
    expect(stepSpan.attributes["starter.ai.step.outcome"]).toBe("failed");
    expect(stepSpan.attributes["starter.ai.error.code"]).toBe(
      ApiErrorCodes.AI_UPSTREAM_ERROR,
    );
    const turnSpan = spanByName(spans, "starter.ai.turn");
    expect(turnSpan.attributes["starter.ai.turn.outcome"]).toBe("failed");
    const modelSpan = spanByName(spans, "starter.ai.model_call");
    expect(modelSpan.attributes["starter.ai.model_call.result"]).toBe(
      "upstream_failed",
    );
    expect(modelSpan.attributes["starter.ai.error.type"]).toBe("upstream");
    expect(JSON.stringify(spans)).not.toContain("SECRET-PROVIDER-ERROR");

    // 上游失败的 Turn / Step 不能记 succeeded，RunEvent 用同一个判据
    const failedRunId = events[0]?.runId ?? "";
    expect(
      runtime.db
        .select()
        .from(aiRunTurns)
        .where(eq(aiRunTurns.runId, failedRunId))
        .all()
        .map((row) => row.outcome),
    ).toEqual(["failed"]);
    expect(
      runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, failedRunId))
        .all()
        .map((row) => ({ outcome: row.outcome, errorCode: row.errorCode })),
    ).toEqual([
      { outcome: "failed", errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR },
    ]);
    expect(
      events.find((event) => event.type === "turn.completed")?.data,
    ).toMatchObject({ outcome: "failed" });
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("telemetry context 全面故障时 Run 终态、审计和 Tool 结果不变", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-telemetry-broken-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const brokenSpan: TelemetrySpan = {
    startSpan: (_options, callback) => Promise.resolve(callback(brokenSpan)),
    setAttributes: () => {
      throw new Error("attributes-broken");
    },
    setStatus: () => {
      throw new Error("status-broken");
    },
    addEvent: () => {
      throw new Error("event-broken");
    },
  };
  let started = 0;
  const brokenTelemetry: TelemetryContext = {
    startSpan: (_options, callback) => {
      started += 1;
      // 一半调用直接抛错，一半返回会抛错的 span。
      if (started % 2 === 0) throw new Error("start-span-broken");
      return Promise.resolve(callback(brokenSpan));
    },
  };
  let calls = 0;
  const streamSimple = ((
    _model: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    calls += 1;
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return streamAssistant(
        assistantMessage([{ type: "text", text: "done" }], "stop"),
        "stop",
      );
    }
    return streamAssistant(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: "tool-call-broken-1",
            name: "lookup",
            arguments: { value: "input" },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  }) as unknown as Models["streamSimple"];
  const { app, cleanup, runtime } = runTestApp({
    store,
    telemetry: brokenTelemetry,
    streamSimple,
    tools: lookupTool(),
  });
  try {
    const user = await register(app, "telemetry-broken@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, [{ name: "lookup", version: "1.0.0" }]);

    const { runId, events } = await startRunAndReadSse(app, user.cookie, {
      agentId,
      input: "run with broken telemetry",
    });

    expect(calls).toBe(2);
    expect(events.at(-1)?.type).toBe("run.completed");
    const runRow = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, runId))
      .get();
    expect(runRow?.status).toBe("completed");
    expect(
      runtime.db
        .select()
        .from(aiModelCalls)
        .where(eq(aiModelCalls.runId, runId))
        .all()
        .map((row) => row.result),
    ).toEqual(["succeeded", "succeeded"]);
    const toolRows = runtime.db
      .select()
      .from(aiToolExecutions)
      .where(eq(aiToolExecutions.runId, runId))
      .all();
    expect(toolRows.map((row) => row.status)).toEqual(["succeeded"]);
    expect(
      events.find((event) => event.type === "tool.completed")?.data,
    ).toMatchObject({ status: "succeeded", summary: "looked up" });
    expect(
      runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all()
        .every((row) => row.outcome === "succeeded"),
    ).toBe(true);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("pi terminal entry 写入失败时 Run span 记录 storage 失败", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-telemetry-storage-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const failingStore = {
    ...store,
    appendRunTerminalEntry: async () => {
      throw new Error("terminal-entry-broken");
    },
  } as unknown as typeof store;
  const recorder = new InMemoryTelemetryContext();
  const { app, cleanup, runtime } = runTestApp({
    store: failingStore,
    telemetry: recorder,
    streamSimple: (() =>
      streamAssistant(
        assistantMessage([{ type: "text", text: "answer" }], "stop"),
        "stop",
      )) as unknown as Models["streamSimple"],
    tools: createAiToolRegistry([]),
  });
  try {
    const user = await register(app, "telemetry-storage@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);

    const { events } = await startRunAndReadSse(app, user.cookie, {
      agentId,
      input: "answer",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      data: { error: { code: ApiErrorCodes.AI_SESSION_STORAGE_FAILED } },
    });

    const runSpan = spanByName(recorder.getSpans(), "starter.ai.run");
    expect(runSpan.attributes["starter.ai.run.outcome"]).toBe("failed");
    expect(runSpan.attributes["starter.ai.error.category"]).toBe("storage");
    expect(runSpan.status).toMatchObject({ status: "error" });
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("abort 的 Run、Turn、Step 和 Model Call span 记录取消终态", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-telemetry-abort-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const recorder = new InMemoryTelemetryContext();
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
    telemetry: recorder,
    streamSimple,
    tools: createAiToolRegistry([]),
  });
  try {
    const user = await register(app, "telemetry-abort@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);
    const sessionId = await createSessionId(app, user.cookie);

    const startedPromise = app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, input: "abort me" }),
    });
    let runId: string | undefined;
    await vi.waitFor(async () => {
      await startedPromise;
      const rows = runtime.db
        .select()
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.sessionId, sessionId))
        .all();
      expect(rows.length).toBe(1);
      runId = rows[0]?.id;
      expect(runId).toBeTruthy();
    });
    const aborted = await app.request(
      `/api/ai/sessions/${sessionId}/runs/${runId}/abort`,
      { method: "POST", headers: { cookie: user.cookie } },
    );
    expect(aborted.status).toBe(200);
    release();

    const events = parseSseEvents(await readSseBody(await startedPromise));
    expect(events.some((event) => event.type === "run.aborted")).toBe(true);

    const spans = recorder.getSpans();
    const runSpan = spanByName(spans, "starter.ai.run");
    expect(runSpan.attributes["starter.ai.run.outcome"]).toBe("aborted");
    expect(runSpan.attributes["starter.ai.error.code"]).toBe(
      ApiErrorCodes.AI_REQUEST_ABORTED,
    );
    expect(runSpan.attributes["starter.ai.error.category"]).toBe("cancelled");
    expect(runSpan.status).toMatchObject({ status: "error" });
    expect(
      spanByName(spans, "starter.ai.turn").attributes[
        "starter.ai.turn.outcome"
      ],
    ).toBe("aborted");
    expect(
      spanByName(spans, "starter.ai.step").attributes[
        "starter.ai.step.outcome"
      ],
    ).toBe("aborted");
    expect(
      spanByName(spans, "starter.ai.model_call").attributes[
        "starter.ai.model_call.result"
      ],
    ).toBe("cancelled");

    // abort 的 Turn / Step 记 aborted，不留 running 记录
    expect(
      runtime.db
        .select()
        .from(aiRunTurns)
        .where(eq(aiRunTurns.runId, runId ?? ""))
        .all()
        .map((row) => row.outcome),
    ).toEqual(["aborted"]);
    expect(
      runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId ?? ""))
        .all()
        .map((row) => row.outcome),
    ).toEqual(["aborted"]);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("tool 失败但模型继续并最终成功时 Turn 和 Step 都记 succeeded", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-telemetry-toolfail-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const recorder = new InMemoryTelemetryContext();
  const streamSimple = ((
    _model: Model<Api>,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      return streamAssistant(
        assistantMessage([{ type: "text", text: "recovered" }], "stop"),
        "stop",
      );
    }
    return streamAssistant(
      assistantMessage(
        [
          {
            type: "toolCall",
            id: "tool-call-failing-1",
            name: "failing",
            arguments: { value: "x" },
          },
        ],
        "toolUse",
      ),
      "toolUse",
    );
  }) as unknown as Models["streamSimple"];
  const { app, cleanup, runtime } = runTestApp({
    store,
    telemetry: recorder,
    streamSimple,
    tools: createAiToolRegistry([
      defineAiTool({
        name: "failing",
        version: "1.0.0",
        description: "Always fails",
        inputSchema: z.object({ value: z.string() }),
        timeoutMs: 1000,
        scope: "platform",
        requiredPermission: null,
        execute: async () => {
          throw new Error("SECRET-TOOL-FAILURE");
        },
      }),
    ]),
  });
  try {
    const user = await register(app, "telemetry-toolfail@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, [{ name: "failing", version: "1.0.0" }]);

    const { runId, events } = await startRunAndReadSse(app, user.cookie, {
      agentId,
      input: "use the failing tool",
    });
    expect(events.at(-1)?.type).toBe("run.completed");
    expect(
      events.find((event) => event.type === "tool.completed")?.data,
    ).toMatchObject({ status: "failed" });

    // Tool 失败不等于 Run 失败：两轮 Turn / Step 都是 succeeded
    expect(
      runtime.db
        .select()
        .from(aiRunTurns)
        .where(eq(aiRunTurns.runId, runId))
        .all()
        .map((row) => row.outcome),
    ).toEqual(["succeeded", "succeeded"]);
    expect(
      runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all()
        .map((row) => ({ outcome: row.outcome, errorCode: row.errorCode })),
    ).toEqual([
      { outcome: "succeeded", errorCode: null },
      { outcome: "succeeded", errorCode: null },
    ]);
    expect(
      runtime.db
        .select()
        .from(aiToolExecutions)
        .where(eq(aiToolExecutions.runId, runId))
        .all()
        .map((row) => row.status),
    ).toEqual(["failed"]);
    expect(
      events
        .filter((event) => event.type === "turn.completed")
        .map((event) => event.data.outcome),
    ).toEqual(["succeeded", "succeeded"]);
    expect(JSON.stringify(recorder.getSpans())).not.toContain(
      "SECRET-TOOL-FAILURE",
    );
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("compaction 写入 kind=compaction 的 Step，id 与 span 和 context.compacted 事件一致", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-telemetry-compaction-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const recorder = new InMemoryTelemetryContext();
  const smallModel: Model<Api> = { ...streamModel, contextWindow: 32 };
  const streamSimple = (() =>
    streamAssistant(
      assistantMessage([{ type: "text", text: "answer" }], "stop"),
      "stop",
    )) as unknown as Models["streamSimple"];
  const { app, cleanup, runtime } = runTestApp({
    store,
    telemetry: recorder,
    streamSimple,
    tools: createAiToolRegistry([]),
    model: smallModel,
    completeSimple: (async () =>
      assistantMessage(
        [{ type: "text", text: "SECRET-COMPACTION-SUMMARY" }],
        "stop",
      )) as unknown as Models["completeSimple"],
    compaction: { reserveTokens: 10, keepRecentTokens: 0 },
  });
  try {
    const user = await register(app, "telemetry-compaction@example.com");
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);
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
      body: JSON.stringify({ agentId, input: "continue" }),
    });
    expect(started.status).toBe(200);
    const events = parseSseEvents(await readSseBody(started));
    const runId = events[0]?.runId ?? "";
    expect(runId).toBeTruthy();

    const compacted = events.find(
      (event) => event.type === "context.compacted",
    );
    expect(compacted).toBeDefined();

    const compactionSpan = recorder
      .getSpans()
      .find(
        (span) =>
          span.name === "starter.ai.step" &&
          span.attributes["starter.ai.step.kind"] === "compaction",
      );
    expect(compactionSpan).toBeDefined();

    const compactionSteps = runtime.db
      .select()
      .from(aiRunSteps)
      .where(eq(aiRunSteps.runId, runId))
      .all()
      .filter((row) => row.kind === "compaction");
    expect(compactionSteps).toHaveLength(1);
    const compactionStep = compactionSteps[0];
    if (!compactionStep) throw new Error("缺少 compaction step 记录");
    expect(compactionStep.id).toBe(
      compactionSpan?.attributes["starter.ai.step.id"],
    );
    expect(compacted?.stepId).toBe(compactionStep.id);
    expect(compactionStep.outcome).toBe("succeeded");
    expect(compactionStep.finishedAt).not.toBeNull();
    expect(
      runtime.db
        .select()
        .from(aiRunSteps)
        .where(eq(aiRunSteps.runId, runId))
        .all()
        .some((row) => row.outcome === "running"),
    ).toBe(false);
    expect(JSON.stringify(recorder.getSpans())).not.toContain(
      "SECRET-COMPACTION-SUMMARY",
    );
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("compaction 摘要请求没有 audit 时仍产生 model_call span，parent 是 compaction step", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-telemetry-compaction-no-audit-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const recorder = new InMemoryTelemetryContext();
  const smallModel: Model<Api> = { ...streamModel, contextWindow: 32 };
  const streamSimple = (() =>
    streamAssistant(
      assistantMessage([{ type: "text", text: "answer" }], "stop"),
      "stop",
    )) as unknown as Models["streamSimple"];
  const { app, cleanup, runtime } = runTestApp({
    store,
    telemetry: recorder,
    streamSimple,
    tools: createAiToolRegistry([]),
    model: smallModel,
    completeSimple: (async () =>
      assistantMessage(
        [{ type: "text", text: "SECRET-COMPACTION-SUMMARY" }],
        "stop",
      )) as unknown as Models["completeSimple"],
    compaction: { reserveTokens: 10, keepRecentTokens: 0 },
    // 关键：不注入用量审计，span 包裹不能依赖它
    withAudit: false,
  });
  try {
    const user = await register(
      app,
      "telemetry-compaction-no-audit@example.com",
    );
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);
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
      body: JSON.stringify({ agentId, input: "continue" }),
    });
    expect(started.status).toBe(200);
    const events = parseSseEvents(await readSseBody(started));
    expect(events.some((event) => event.type === "context.compacted")).toBe(
      true,
    );

    const spans = recorder.getSpans();
    const compactionStep = spans.find(
      (span) =>
        span.name === "starter.ai.step" &&
        span.attributes["starter.ai.step.kind"] === "compaction",
    );
    expect(compactionStep).toBeDefined();
    const summaryCall = spans.find(
      (span) =>
        span.name === "starter.ai.model_call" &&
        span.attributes["starter.ai.streaming"] === false,
    );
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.parentId).toBe(compactionStep?.id);
    // 没有 audit 也要有 modelCallId，并且记录终态
    expect(typeof summaryCall?.attributes["starter.ai.model_call.id"]).toBe(
      "string",
    );
    expect(summaryCall?.attributes["starter.ai.model_call.result"]).toBe(
      "succeeded",
    );
    // 没有 audit 就不写 ai_model_calls
    expect(runtime.db.select().from(aiModelCalls).all()).toHaveLength(0);
    expect(JSON.stringify(spans)).not.toContain("SECRET-COMPACTION-SUMMARY");
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
