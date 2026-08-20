import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ApiErrorCodes, starterRunDataSchema } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import {
  createActiveRunRegistry,
  createPiAgentExecutor,
  type PiAgentExecutor,
} from "@api/infra/agent/index.js";
import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import {
  aiAgentDefinitions,
  aiAgentRuns,
  aiAgentSessions,
  aiEnabledModels,
  aiProviderConfigs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import {
  createAiAgentRunRepository,
  createAiAgentRunService,
} from "@api/modules/ai/run/index.js";
import { createAiAgentSessionRepository } from "@api/modules/ai/session/index.js";
import { generateId } from "@api/shared/id.js";

import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

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
  }
  stream.push({ type: "done", reason, message });
  return stream;
}

function streamError(): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const partial = assistantMessage([], "error");
  stream.push({ type: "start", partial });
  stream.push({ type: "error", reason: "error", error: partial });
  return stream;
}

async function readSse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("缺少 SSE body");
  const decoder = new TextDecoder();
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  reader.releaseLock();
  return body;
}

function parseSseEvents(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  let eventType: string | null = null;
  const dataLines: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
      continue;
    }
    if (line.trim() === "" && dataLines.length > 0) {
      const event = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      events.push({ ...event, _sseType: eventType });
      eventType = null;
      dataLines.length = 0;
    }
  }
  return events;
}

async function setupAgent(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
  admin: { cookie: string },
  name: string,
): Promise<{
  agentId: string;
  modelRef: { providerId: string; modelId: string };
}> {
  const prompt = await postJson(app, "/api/ai/system-prompts", admin.cookie, {
    name: `${name}-prompt`,
    content: "只返回事实。",
  });
  const promptBody = await readSuccess<{ id: string }>(prompt);
  const modelRef = seedModel(runtime);
  const created = await postJson(app, "/api/ai/admin/agents", admin.cookie, {
    name,
    config: {
      schemaVersion: 1,
      model: modelRef,
      systemPromptId: promptBody.data.id,
      skillIds: [],
      toolNames: [],
      thinkingLevel: "off",
      maxTurns: 8,
    },
  });
  const createdBody = await readSuccess<{ id: string }>(created);
  const enabled = await patchJson(
    app,
    `/api/ai/admin/agents/${createdBody.data.id}/status`,
    admin.cookie,
    { status: "enabled" },
  );
  expect(enabled.status).toBe(200);
  return { agentId: createdBody.data.id, modelRef };
}

async function createSession(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  title: string,
): Promise<{ sessionId: string }> {
  const created = await postJson(app, "/api/ai/sessions", cookie, { title });
  expect(created.status).toBe(200);
  const body = await readSuccess<{ id: string }>(created);
  return { sessionId: body.data.id };
}

async function startRun(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  sessionId: string,
  input: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function getRun(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  sessionId: string,
  runId: string,
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs/${runId}`, {
    headers: { cookie },
  });
}

async function postRunAction(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  sessionId: string,
  runId: string,
  action: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs/${runId}/${action}`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

it("文本 Run 从 starting/running 进入唯一 completed 终态，SSE 顺序正确", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-success-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const streamFn = (
    _model: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) =>
    streamResponse(
      assistantMessage([{ type: "text", text: "hello from run" }], "stop"),
      "stop",
    );
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-success@example.com");
    const { agentId, modelRef } = await setupAgent(
      app,
      runtime,
      admin,
      "success-agent",
    );
    const { sessionId } = await createSession(app, user.cookie, "成功 Run");

    const started = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: "hello",
    });
    expect(started.status).toBe(200);
    const body = await readSse(started);
    const events = parseSseEvents(body);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "turn.started",
      "message.started",
      "message.delta",
      "message.completed",
      "turn.completed",
      "run.completed",
    ]);
    const sequences = events.map((event) => event.sequence as number);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(
      events.filter((event) => String(event.type).startsWith("run.")),
    ).toHaveLength(2);
    const terminalEvents = events.filter(
      (event) =>
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.aborted",
    );
    expect(terminalEvents).toHaveLength(1);

    const runId = events[0]?.runId as string;
    expect(runId).toBeTruthy();
    const detail = await getRun(app, user.cookie, sessionId, runId);
    expect(detail.status).toBe(200);
    const detailBody = await readSuccess<{
      status: string;
      finalEntryId: string | null;
      errorCode: string | null;
      agentRevision: number;
      snapshot: { model: { providerId: string; modelId: string } };
    }>(detail);
    expect(detailBody.data).toMatchObject({
      status: "completed",
      finalEntryId: expect.any(String),
      errorCode: null,
      agentRevision: 1,
      snapshot: {
        model: modelRef,
      },
    });

    // Pi 侧只写一条 starter.run.v1
    const entries = await store.findRunTerminalEntries({
      sessionId,
      lane: "main",
      runId,
    });
    expect(entries).toHaveLength(1);
    expect(starterRunDataSchema.safeParse(entries[0]?.data).success).toBe(true);

    // 主库记录终态
    const row = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, runId))
      .get();
    expect(row?.status).toBe("completed");
    expect(row?.finalEntryId).toBeTruthy();
    expect(row?.finishedAt).toBeTruthy();
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("同一 Session lane 并发返回 AI_SESSION_BUSY，不创建多余 Run row", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-busy-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const streamFn = (
    _model: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    void gate.then(() => {
      stream.push({
        type: "done",
        reason: "stop",
        message: assistantMessage([{ type: "text", text: "done" }], "stop"),
      });
    });
    return stream;
  };
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const registry = createActiveRunRegistry();
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutor: executor,
      activeRunRegistry: registry,
    },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-busy@example.com");
    const { agentId } = await setupAgent(app, runtime, admin, "busy-agent");
    const { sessionId } = await createSession(app, user.cookie, "busy");

    const first = startRun(app, user.cookie, sessionId, {
      agentId,
      input: "first",
    });
    await vi.waitFor(() => {
      expect(registry.getBySessionLane(sessionId, "main")).toBeDefined();
    });

    const second = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: "second",
    });
    expect(second.status).toBe(409);
    expect((await readFailure(second)).error.code).toBe(
      ApiErrorCodes.AI_SESSION_BUSY,
    );

    releaseFirst();
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    const body = await readSse(firstResponse);
    expect(
      parseSseEvents(body).some((event) => event.type === "run.completed"),
    ).toBe(true);

    // 只创建了一条 Run row
    const rows = runtime.db
      .select({ id: aiAgentRuns.id })
      .from(aiAgentRuns)
      .all();
    expect(rows).toHaveLength(1);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("不同 lane 可以并发", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-lanes-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let releaseA!: () => void;
  let releaseB!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const gateB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  const streamFn = (
    _model: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    void Promise.race([gateA, gateB]).then(() => {
      stream.push({
        type: "done",
        reason: "stop",
        message: assistantMessage([{ type: "text", text: "done" }], "stop"),
      });
    });
    return stream;
  };
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-lanes@example.com");
    const { agentId } = await setupAgent(app, runtime, admin, "lane-agent");
    const { sessionId } = await createSession(app, user.cookie, "lanes");

    const a = startRun(app, user.cookie, sessionId, {
      agentId,
      lane: "a",
      input: "a",
    });
    const b = startRun(app, user.cookie, sessionId, {
      agentId,
      lane: "b",
      input: "b",
    });
    const [responseA, responseB] = await Promise.all([a, b]);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    releaseA();
    releaseB();
    const bodyA = await readSse(responseA);
    const bodyB = await readSse(responseB);
    expect(
      parseSseEvents(bodyA).some((event) => event.type === "run.completed"),
    ).toBe(true);
    expect(
      parseSseEvents(bodyB).some((event) => event.type === "run.completed"),
    ).toBe(true);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("provider 失败映射为稳定 failed 终态", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-failed-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () => streamError(),
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-failed@example.com");
    const { agentId } = await setupAgent(app, runtime, admin, "fail-agent");
    const { sessionId } = await createSession(app, user.cookie, "fail");

    const started = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: "boom",
    });
    expect(started.status).toBe(200);
    const body = await readSse(started);
    const events = parseSseEvents(body);
    const failed = events.find((event) => event.type === "run.failed");
    expect(failed).toBeDefined();
    expect((failed?.data as { error: { code: string } }).error.code).toBe(
      ApiErrorCodes.AI_UPSTREAM_ERROR,
    );

    const runId = events[0]?.runId as string;
    const detail = await getRun(app, user.cookie, sessionId, runId);
    const detailBody = await readSuccess<{
      status: string;
      errorCode: string;
    }>(detail);
    expect(detailBody.data.status).toBe("failed");
    expect(detailBody.data.errorCode).toBe(ApiErrorCodes.AI_UPSTREAM_ERROR);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("prepare 失败后释放 lane lease，下一次同 lane Run 可以启动", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "starter-run-prepare-failed-"),
  );
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const prepare = vi.fn(() => {
    throw new Error("prepare failed");
  });
  const executor = { prepare } as unknown as PiAgentExecutor;
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-prepare-failed@example.com");
    const { agentId } = await setupAgent(
      app,
      runtime,
      admin,
      "prepare-failed-agent",
    );
    const { sessionId } = await createSession(
      app,
      user.cookie,
      "prepare failed",
    );

    const first = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: "first",
    });
    expect(first.status).toBe(200);
    const firstEvents = parseSseEvents(await readSse(first));
    expect(firstEvents.map((event) => event.type)).toEqual(["run.failed"]);

    const second = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: "second",
    });
    expect(second.status).toBe(200);
    const secondEvents = parseSseEvents(await readSse(second));
    expect(secondEvents.map((event) => event.type)).toEqual(["run.failed"]);
    expect(prepare).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("abort 产生 aborted 终态；终态后 steer/follow-up 返回 AI_RUN_NOT_ACTIVE", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-abort-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const streamFn = (
    _model: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    const partial = assistantMessage([], "pending");
    stream.push({ type: "start", partial });
    void gate.then(() => {
      stream.push({
        type: "done",
        reason: "stop",
        message: assistantMessage([{ type: "text", text: "late" }], "stop"),
      });
    });
    return stream;
  };
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-abort@example.com");
    const { agentId } = await setupAgent(app, runtime, admin, "abort-agent");
    const { sessionId } = await createSession(app, user.cookie, "abort");

    // 从 SSE 首事件拿 runId
    const startedPromise = startRun(app, user.cookie, sessionId, {
      agentId,
      input: "abort me",
    });
    let runId: string | undefined;
    await vi.waitFor(async () => {
      const response = await startedPromise;
      void response;
      const rows = runtime.db
        .select()
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.sessionId, sessionId))
        .all();
      expect(rows.length).toBe(1);
      runId = rows[0]?.id;
      expect(runId).toBeTruthy();
    });
    if (!runId) throw new Error("Run 未创建");

    // active 期间 steer / follow-up 生效
    const steer = await postRunAction(
      app,
      user.cookie,
      sessionId,
      runId,
      "steer",
      {
        text: "be brief",
      },
    );
    expect(steer.status).toBe(200);
    const followUp = await postRunAction(
      app,
      user.cookie,
      sessionId,
      runId,
      "follow-ups",
      { text: "and now?" },
    );
    expect(followUp.status).toBe(200);

    const abort = await postRunAction(
      app,
      user.cookie,
      sessionId,
      runId,
      "abort",
    );
    expect(abort.status).toBe(200);
    release();

    const started = await startedPromise;
    const body = await readSse(started);
    const events = parseSseEvents(body);
    const aborted = events.find((event) => event.type === "run.aborted");
    expect(aborted).toBeDefined();

    // 终态后控制接口返回 AI_RUN_NOT_ACTIVE
    const steerAfter = await postRunAction(
      app,
      user.cookie,
      sessionId,
      runId,
      "steer",
      { text: "too late" },
    );
    expect(steerAfter.status).toBe(409);
    expect((await readFailure(steerAfter)).error.code).toBe(
      ApiErrorCodes.AI_RUN_NOT_ACTIVE,
    );
    const detail = await getRun(app, user.cookie, sessionId, runId);
    const detailBody = await readSuccess<{
      status: string;
      errorCode: string;
    }>(detail);
    expect(detailBody.data.status).toBe("aborted");
    expect(detailBody.data.errorCode).toBe(ApiErrorCodes.AI_REQUEST_ABORTED);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("他人 Session 或 Run 一律 404，不能靠 id 探测", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-owner-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () =>
      streamResponse(
        assistantMessage([{ type: "text", text: "ok" }], "stop"),
        "stop",
      ),
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const owner = await register(app, "run-owner-a@example.com");
    const other = await register(app, "run-owner-b@example.com");
    const { agentId } = await setupAgent(app, runtime, admin, "owner-agent");
    const { sessionId } = await createSession(app, owner.cookie, "owner");

    const started = await startRun(app, owner.cookie, sessionId, {
      agentId,
      input: "mine",
    });
    const body = await readSse(started);
    const runId = parseSseEvents(body)[0]?.runId as string;

    // 他人读 run / abort / steer / follow-up 全部 404
    const read = await getRun(app, other.cookie, sessionId, runId);
    expect(read.status).toBe(404);
    const abort = await postRunAction(
      app,
      other.cookie,
      sessionId,
      runId,
      "abort",
    );
    expect(abort.status).toBe(404);
    const steer = await postRunAction(
      app,
      other.cookie,
      sessionId,
      runId,
      "steer",
      {
        text: "x",
      },
    );
    expect(steer.status).toBe(404);
    // 他人对 owner session 启动 Run 也 404
    const otherStart = await startRun(app, other.cookie, sessionId, {
      agentId,
      input: "not yours",
    });
    expect(otherStart.status).toBe(404);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("启动恢复：无 terminal entry 标记 interrupted，唯一合法 entry 投影终态", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const owner = await register(app, "recover-owner@example.com");
    const agentId = await seedAgentDefinition(runtime, "recover-agent-1");
    const sessionId = generateId();
    await runtime.agentSessionStore.createSession({ id: sessionId });
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: sessionId,
        ownerId: owner.user.id,
        title: "恢复",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const runId = generateId();
    const now = new Date();
    await runtime.db
      .insert(aiAgentRuns)
      .values({
        id: runId,
        sessionId,
        agentId,
        lane: "main",
        status: "running",
        agentRevision: 1,
        snapshotJson: JSON.stringify({
          schemaVersion: 1,
          agentId,
          agentRevision: 1,
          model: { providerId: model.provider, modelId: model.id },
          systemPromptId: null,
          skillIds: [],
          toolNames: [],
          thinkingLevel: "off",
          maxTurns: 8,
        }),
        requestId: "request-recover",
        createdAt: now,
        startedAt: now,
      })
      .run();

    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const service = createAiAgentRunService({
      repository: createAiAgentRunRepository(runtime.db),
      sessionRepository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      agentService: {} as never,
      registry: createActiveRunRegistry(),
      executor: {} as never,
      logger,
    });

    // 无 terminal entry -> interrupted
    const report = await service.recoverInterrupted();
    expect(report.scanned).toBe(1);
    expect(report.interrupted).toBe(1);
    const row = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, runId))
      .get();
    expect(row?.status).toBe("interrupted");
    expect(row?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED);
  } finally {
    cleanup();
  }
});

it("启动恢复：唯一合法 entry 投影终态；重复 entry 标记 interrupted", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const owner = await register(app, "recover-entry@example.com");
    const agentId = await seedAgentDefinition(runtime, "recover-agent-2");
    const sessionId = generateId();
    await runtime.agentSessionStore.createSession({ id: sessionId });
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: sessionId,
        ownerId: owner.user.id,
        title: "恢复 entry",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const now = new Date();
    const makeRun = async (status: "running" | "starting") => {
      const runId = generateId();
      await runtime.db
        .insert(aiAgentRuns)
        .values({
          id: runId,
          sessionId,
          agentId,
          lane: "main",
          status,
          agentRevision: 1,
          snapshotJson: JSON.stringify({
            schemaVersion: 1,
            agentId,
            agentRevision: 1,
            model: { providerId: model.provider, modelId: model.id },
            systemPromptId: null,
            skillIds: [],
            toolNames: [],
            thinkingLevel: "off",
            maxTurns: 8,
          }),
          requestId: "request-recover-entry",
          createdAt: now,
          startedAt: status === "running" ? now : null,
        })
        .run();
      return runId;
    };

    const recoveredRunId = await makeRun("running");
    const session = await runtime.agentSessionStore.openSession(sessionId);
    const finalEntryId = generateId();
    await session.appendRunTerminalEntry("main", {
      schemaVersion: 1,
      runId: recoveredRunId,
      sessionId,
      lane: "main",
      agentId,
      agentRevision: 1,
      status: "completed",
      finalEntryId,
      errorCode: null,
      finishedAt: Date.now(),
    });

    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const service = createAiAgentRunService({
      repository: createAiAgentRunRepository(runtime.db),
      sessionRepository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      agentService: {} as never,
      registry: createActiveRunRegistry(),
      executor: {} as never,
      logger,
    });
    const report = await service.recoverInterrupted();
    expect(report.recoveredFromEntry).toBe(1);
    const recoveredRow = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, recoveredRunId))
      .get();
    expect(recoveredRow?.status).toBe("completed");
    expect(recoveredRow?.finalEntryId).toBe(finalEntryId);
    expect(recoveredRow?.finishedAt).toBeTruthy();

    // 重复 entry 视为损坏 -> interrupted
    const corruptedRunId = await makeRun("starting");
    await session.appendRunTerminalEntry("main", {
      schemaVersion: 1,
      runId: corruptedRunId,
      sessionId,
      lane: "main",
      agentId,
      agentRevision: 1,
      status: "completed",
      finalEntryId: generateId(),
      errorCode: null,
      finishedAt: Date.now(),
    });
    await session.appendRunTerminalEntry("main", {
      schemaVersion: 1,
      runId: corruptedRunId,
      sessionId,
      lane: "main",
      agentId,
      agentRevision: 1,
      status: "failed",
      finalEntryId: null,
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      finishedAt: Date.now(),
    });
    const report2 = await service.recoverInterrupted();
    expect(report2.corrupted).toBe(1);
    const corruptedRow = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, corruptedRunId))
      .get();
    expect(corruptedRow?.status).toBe("interrupted");
    expect(corruptedRow?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED);

    // entry 结构合法但身份字段与主库 Run 不一致，同样视为损坏。
    const mismatchedRunId = await makeRun("running");
    await session.appendRunTerminalEntry("main", {
      schemaVersion: 1,
      runId: mismatchedRunId,
      sessionId,
      lane: "main",
      agentId: generateId(),
      agentRevision: 1,
      status: "failed",
      finalEntryId: null,
      errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      finishedAt: Date.now(),
    });
    const report3 = await service.recoverInterrupted();
    expect(report3.corrupted).toBe(1);
    const mismatchedRow = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, mismatchedRunId))
      .get();
    expect(mismatchedRow?.status).toBe("interrupted");
    expect(mismatchedRow?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED);
  } finally {
    cleanup();
  }
});

it("启动恢复：schema 解析失败标记 AI.RUN_INTERRUPTED", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const owner = await register(app, "recover-schema@example.com");
    const agentId = await seedAgentDefinition(runtime, "recover-agent-3");
    const sessionId = generateId();
    await runtime.agentSessionStore.createSession({ id: sessionId });
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: sessionId,
        ownerId: owner.user.id,
        title: "恢复 schema",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const runId = generateId();
    const now = new Date();
    await runtime.db
      .insert(aiAgentRuns)
      .values({
        id: runId,
        sessionId,
        agentId,
        lane: "main",
        status: "running",
        agentRevision: 1,
        snapshotJson: JSON.stringify({
          schemaVersion: 1,
          agentId,
          agentRevision: 1,
          model: { providerId: model.provider, modelId: model.id },
          systemPromptId: null,
          skillIds: [],
          toolNames: [],
          thinkingLevel: "off",
          maxTurns: 8,
        }),
        requestId: "request-recover-schema",
        createdAt: now,
        startedAt: now,
      })
      .run();

    // 错误 schema 的 custom entry：schemaVersion 非法但 runId 可匹配
    const session = await runtime.agentSessionStore.openSession(sessionId);
    await session.appendRunTerminalEntry("main", {
      schemaVersion: 99,
      runId,
      status: "weird",
      finishedAt: "not-a-number",
    });

    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const service = createAiAgentRunService({
      repository: createAiAgentRunRepository(runtime.db),
      sessionRepository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      agentService: {} as never,
      registry: createActiveRunRegistry(),
      executor: {} as never,
      logger,
    });
    const report = await service.recoverInterrupted();
    expect(report.corrupted).toBe(1);
    const row = runtime.db
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, runId))
      .get();
    expect(row?.status).toBe("interrupted");
    expect(row?.errorCode).toBe(ApiErrorCodes.AI_RUN_INTERRUPTED);
  } finally {
    cleanup();
  }
});

it("transcript 写入侧挂载 runId（S5 约定）", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-runid-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn: () =>
      streamResponse(
        assistantMessage([{ type: "text", text: "runid ok" }], "stop"),
        "stop",
      ),
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-runid@example.com");
    const { agentId } = await setupAgent(app, runtime, admin, "runid-agent");
    const { sessionId } = await createSession(app, user.cookie, "runid");

    const started = await startRun(app, user.cookie, sessionId, {
      agentId,
      input: "挂 runId",
    });
    await readSse(started);

    const transcript = await app.request(
      `/api/ai/sessions/${sessionId}/transcript?lane=main`,
      { headers: { cookie: user.cookie } },
    );
    const transcriptBody = await readSuccess<{
      items: Array<{
        type: string;
        runId: string | null;
        content?: string;
      }>;
    }>(transcript);
    const userItems = transcriptBody.data.items.filter(
      (item) => item.type === "user_message",
    );
    expect(userItems.length).toBeGreaterThan(0);
    expect(userItems[0]?.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(userItems[0]?.content).toContain("挂 runId");
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("活跃 Run 返回 live 快照，终态后为 null，他人 Run 仍 404", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-live-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  // 用 gate 把 Run 挂在 running 状态，才能观察到活跃快照。
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const streamFn = (
    _model: Model<Api>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: assistantMessage([], "pending") });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "部分输出",
      partial: assistantMessage(
        [{ type: "text", text: "部分输出" }],
        "pending",
      ),
    });
    void gate.then(() => {
      stream.push({
        type: "done",
        reason: "stop",
        message: assistantMessage(
          [{ type: "text", text: "部分输出已完成" }],
          "stop",
        ),
      });
    });
    return stream;
  };
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: () => model,
    streamFn,
    hasPermission: async () => true,
  });
  const { app, cleanup, runtime } = createTestApp(
    {},
    { agentSessionStore: store, piAgentExecutor: executor },
  );
  try {
    const admin = await registerAdmin(app, runtime);
    const user = await register(app, "run-live@example.com");
    const other = await register(app, "run-live-other@example.com");
    const { agentId } = await setupAgent(app, runtime, admin, "live-agent");
    const { sessionId } = await createSession(app, user.cookie, "live");

    const startedPromise = startRun(app, user.cookie, sessionId, {
      agentId,
      input: "看快照",
    });

    let runId: string | undefined;
    await vi.waitFor(async () => {
      const rows = runtime.db
        .select()
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.sessionId, sessionId))
        .all();
      expect(rows.length).toBe(1);
      expect(rows[0]?.status).toBe("running");
      runId = rows[0]?.id;
    });
    if (!runId) throw new Error("Run 未创建");

    // AC1：执行中的 Run 返回非空快照，部分文本与已推送 delta 一致
    type LiveDetail = {
      status: string;
      live: {
        lastSequence: number;
        turn: number;
        maxTurns: number;
        messages: Array<{ content: string; completed: boolean }>;
        tools: unknown[];
      } | null;
    };
    await vi.waitFor(async () => {
      const active = await getRun(app, user.cookie, sessionId, runId!);
      expect(active.status).toBe(200);
      const body = await readSuccess<LiveDetail>(active);
      expect(body.data.status).toBe("running");
      expect(body.data.live).not.toBeNull();
      expect(body.data.live?.messages[0]?.content).toBe("部分输出");
      expect(body.data.live?.messages[0]?.completed).toBe(false);
      expect(body.data.live?.turn).toBe(1);
      expect(body.data.live?.maxTurns).toBe(8);
      expect(body.data.live?.lastSequence).toBeGreaterThan(0);
    });

    // AC3：他人读同一个 Run 仍 404，不泄露存在性
    const foreign = await getRun(app, other.cookie, sessionId, runId);
    expect(foreign.status).toBe(404);

    release();
    const started = await startedPromise;
    const events = parseSseEvents(await readSse(started));
    expect(events.some((event) => event.type === "run.completed")).toBe(true);

    // AC2：终态后快照为 null，客户端回落 transcript
    const finished = await getRun(app, user.cookie, sessionId, runId);
    const finishedBody = await readSuccess<LiveDetail>(finished);
    expect(finishedBody.data.status).toBe("completed");
    expect(finishedBody.data.live ?? null).toBeNull();
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

async function registerAdmin(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
) {
  const owner = await register(app, `run-admin-${Date.now()}@example.com`);
  const adminRole = runtime.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "admin"))
    .get()!;
  const aiPermissions = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, "ai:config:manage"))
    .all();
  const aiReadPermissions = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, "ai:config:read"))
    .all();
  for (const permission of [...aiPermissions, ...aiReadPermissions]) {
    runtime.db
      .insert(rolePermissions)
      .values({
        roleId: adminRole.id,
        permissionId: permission.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .onConflictDoNothing()
      .run();
  }
  runtime.db
    .update(userRoles)
    .set({ roleId: adminRole.id })
    .where(eq(userRoles.userId, owner.user.id))
    .run();
  return owner;
}

async function seedAgentDefinition(
  runtime: ReturnType<typeof createTestApp>["runtime"],
  name: string,
): Promise<string> {
  const id = generateId();
  const now = new Date();
  await runtime.db
    .insert(aiAgentDefinitions)
    .values({
      id,
      name: `${name}-${now.getTime()}`,
      description: "",
      status: "enabled",
      revision: 1,
      configJson: JSON.stringify({
        schemaVersion: 1,
        model: { providerId: model.provider, modelId: model.id },
        systemPromptId: null,
        skillIds: [],
        toolNames: [],
        thinkingLevel: "off",
        maxTurns: 8,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function seedModel(runtime: ReturnType<typeof createTestApp>["runtime"]): {
  providerId: string;
  modelId: string;
} {
  const modelRef = runtime.ai.listModels("openai")[0];
  if (!modelRef) throw new Error("测试模型目录为空");
  const now = new Date();
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: modelRef.providerId,
      enabled: true,
      configRevision: 0,
      checkedConfigRevision: 0,
      authStatus: "ready",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  runtime.db
    .insert(aiEnabledModels)
    .values({
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
      enabledAt: now,
    })
    .run();
  return { providerId: modelRef.providerId, modelId: modelRef.modelId };
}

async function postJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchJson(
  app: ReturnType<typeof createTestApp>["app"],
  path: string,
  cookie: string,
  body: Record<string, unknown>,
) {
  return app.request(path, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
