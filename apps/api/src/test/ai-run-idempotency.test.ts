// startRun 幂等键集成测试：预检查回放、409 冲突、scope 隔离、
// busy 不消费 key、failed 不重跑、非法 key 400 和 SSE 模式回放。
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai";
import { ApiErrorCodes } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import {
  aiAgentRuns,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { createAiToolRegistry } from "@api/modules/ai/tool/tool-registry.js";

import {
  assistantMessage as buildAssistantMessage,
  parseSseEvents,
  readSseBody,
  runTestApp,
  seedAgent,
  seedEnabledModel,
  streamAssistant,
  streamProviderError,
} from "./ai-run-harness.js";
import {
  readFailure,
  readSuccess,
  register,
  type createTestApp,
} from "./helpers.js";

interface RunRow {
  id: string;
  sessionId: string;
  status: string;
  idempotencyKey: string | null;
}

interface RunAppContext {
  app: ReturnType<typeof createTestApp>["app"];
  runtime: ReturnType<typeof createTestApp>["runtime"];
  agentId: string;
  user: { cookie: string };
  createSession: () => Promise<string>;
  startRunJson: (
    sessionId: string,
    body: Record<string, unknown>,
  ) => Promise<Response>;
  startRunSse: (
    sessionId: string,
    body: Record<string, unknown>,
  ) => Promise<Response>;
  runRows: () => RunRow[];
  cleanup: () => Promise<void>;
}

function doneStream(): ReturnType<typeof createAssistantMessageEventStream> {
  return streamAssistant(
    buildAssistantMessage([{ type: "text", text: "done" }], "stop"),
    "stop",
  );
}

/** gate resolve 前流不结束，让 Run 停在 running。 */
function gatedStream(gate: Promise<void>): Models["streamSimple"] {
  return () => {
    const stream = createAssistantMessageEventStream();
    void gate.then(() => {
      stream.push({
        type: "done",
        reason: "stop",
        message: buildAssistantMessage(
          [{ type: "text", text: "done" }],
          "stop",
        ),
      });
    });
    return stream;
  };
}

async function setupRunApp(
  streamFn: Models["streamSimple"],
): Promise<RunAppContext> {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-idem-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const { app, cleanup, runtime } = runTestApp({
    store,
    streamSimple: streamFn,
    tools: createAiToolRegistry([]),
  });
  seedEnabledModel(runtime);
  const agentId = seedAgent(runtime, []);
  const user = await register(app, `run-idem-${Date.now()}@example.com`);
  return {
    app,
    runtime,
    agentId,
    user,
    async createSession() {
      const created = await app.request("/api/ai/sessions", {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "idempotency" }),
      });
      expect(created.status).toBe(200);
      return (await readSuccess<{ id: string }>(created)).data.id;
    },
    async startRunJson(sessionId, body) {
      return app.request(`/api/ai/sessions/${sessionId}/runs`, {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ agentId, input: "hello", ...body }),
      });
    },
    async startRunSse(sessionId, body) {
      return app.request(`/api/ai/sessions/${sessionId}/runs`, {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ agentId, input: "hello", ...body }),
      });
    },
    runRows: () =>
      runtime.db
        .select({
          id: aiAgentRuns.id,
          sessionId: aiAgentRuns.sessionId,
          status: aiAgentRuns.status,
          idempotencyKey: aiAgentRuns.idempotencyKey,
        })
        .from(aiAgentRuns)
        .all(),
    async cleanup() {
      cleanup();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function readRunId(response: Response): Promise<string> {
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await readSuccess<{ runId: string }>(response);
  return body.data.runId;
}

async function pollRunTerminal(
  app: RunAppContext["app"],
  headers: Record<string, string>,
  sessionId: string,
  runId: string,
): Promise<{ status: string }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.request(
      `/api/ai/sessions/${sessionId}/runs/${runId}`,
      { headers },
    );
    expect(response.status).toBe(200);
    const run = (await readSuccess<{ status: string }>(response)).data;
    if (
      ["completed", "failed", "aborted", "interrupted"].includes(run.status)
    ) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Run 未在等待时间内进入终态");
}

it("同 key 同 session 两次启动返回同一 runId，只创建一条 Run row", async () => {
  const ctx = await setupRunApp(() => doneStream());
  try {
    const sessionId = await ctx.createSession();
    const key = "order-create-001";
    const first = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const runId = await readRunId(first);

    const second = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const replayedRunId = await readRunId(second);
    expect(replayedRunId).toBe(runId);

    await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      runId,
    );
    expect(ctx.runRows()).toHaveLength(1);
  } finally {
    await ctx.cleanup();
  }
});

it("同 key 不同 session 返回 409 AI_IDEMPOTENCY_KEY_CONFLICT", async () => {
  const ctx = await setupRunApp(() => doneStream());
  try {
    const sessionA = await ctx.createSession();
    const sessionB = await ctx.createSession();
    const key = "shared-key-0001";
    const first = await ctx.startRunJson(sessionA, { idempotencyKey: key });
    expect(first.status).toBe(200);

    const conflict = await ctx.startRunJson(sessionB, { idempotencyKey: key });
    expect(conflict.status).toBe(409);
    expect((await readFailure(conflict)).error.code).toBe(
      ApiErrorCodes.AI_IDEMPOTENCY_KEY_CONFLICT,
    );

    // 等第一个 Run 终态后再断言行数，避免后台事务在 cleanup 后落库。
    const runId = (
      await readSuccess<{ runId: string }>(
        await ctx.startRunJson(sessionA, { idempotencyKey: key }),
      )
    ).data.runId;
    await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionA,
      runId,
    );
    expect(ctx.runRows()).toHaveLength(1);
  } finally {
    await ctx.cleanup();
  }
});

it("运行中 Run 同 key 重试返回同一 runId，不因 lane busy 409", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ctx = await setupRunApp(gatedStream(gate));
  try {
    const sessionId = await ctx.createSession();
    const key = "retry-running-01";
    const first = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const runId = await readRunId(first);
    await vi.waitFor(() => {
      expect(ctx.runRows()[0]?.status).toBe("running");
    });

    const retry = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const retryRunId = await readRunId(retry);
    expect(retryRunId).toBe(runId);

    release();
    await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      runId,
    );
    expect(ctx.runRows()).toHaveLength(1);
  } finally {
    await ctx.cleanup();
  }
});

it("lane busy 不消费 key：占端结束后同 key 请求创建新 Run", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ctx = await setupRunApp(gatedStream(gate));
  try {
    const sessionId = await ctx.createSession();
    const first = await ctx.startRunJson(sessionId, {});
    const runA = await readRunId(first);

    const key = "busy-key-0001";
    const busy = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    expect(busy.status).toBe(409);
    expect((await readFailure(busy)).error.code).toBe(
      ApiErrorCodes.AI_SESSION_BUSY,
    );

    release();
    await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      runA,
    );

    const next = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const runB = await readRunId(next);
    expect(runB).not.toBe(runA);
    await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      runB,
    );

    const rows = ctx.runRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === runB)?.idempotencyKey).toBe(key);
    expect(rows.find((row) => row.id === runA)?.idempotencyKey).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

it("两个 product_app 凭据使用相同 key 各自独立成 Run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-run-idem-scope-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const { app, cleanup, runtime } = runTestApp({
    store,
    streamSimple: () => doneStream(),
    tools: createAiToolRegistry([]),
  });
  try {
    seedEnabledModel(runtime);
    const agentId = seedAgent(runtime, []);
    const admin = await registerAdmin(app, runtime);
    const appA = await createAppCredential(
      app,
      admin.cookie,
      "Product A",
      "tenant-a",
      "project-a",
    );
    const appB = await createAppCredential(
      app,
      admin.cookie,
      "Product B",
      "tenant-a",
      "project-b",
    );
    const key = "scope-shared-01";

    const runA = await bearerStartRun(app, appA.secret, agentId, key);
    const runB = await bearerStartRun(app, appB.secret, agentId, key);
    expect(runA.runId).not.toBe(runB.runId);

    const rows = runtime.db
      .select({
        id: aiAgentRuns.id,
        idempotencyKey: aiAgentRuns.idempotencyKey,
      })
      .from(aiAgentRuns)
      .all();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.idempotencyKey === key)).toBe(true);

    const statusA = await pollRunTerminal(
      app,
      bearerHeaders(appA.secret),
      runA.sessionId,
      runA.runId,
    );
    const statusB = await pollRunTerminal(
      app,
      bearerHeaders(appB.secret),
      runB.sessionId,
      runB.runId,
    );
    expect(statusA.status).toBe("completed");
    expect(statusB.status).toBe("completed");
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("failed Run 同 key 重试返回既有 runId，不新建也不重跑", async () => {
  const ctx = await setupRunApp(() => streamProviderError());
  try {
    const sessionId = await ctx.createSession();
    const key = "failed-key-0001";
    const first = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const runId = await readRunId(first);
    const terminal = await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      runId,
    );
    expect(terminal.status).toBe("failed");

    const retry = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const retryRunId = await readRunId(retry);
    expect(retryRunId).toBe(runId);

    const after = await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      retryRunId,
    );
    expect(after.status).toBe("failed");
    expect(ctx.runRows()).toHaveLength(1);
  } finally {
    await ctx.cleanup();
  }
});

it("非法 idempotencyKey 返回 400 COMMON.INVALID_REQUEST", async () => {
  const ctx = await setupRunApp(() => doneStream());
  try {
    const sessionId = await ctx.createSession();
    for (const key of ["abc1234", "bad#key#value", "        "]) {
      const response = await ctx.startRunJson(sessionId, {
        idempotencyKey: key,
      });
      expect(response.status, `key=${key}`).toBe(400);
      expect((await readFailure(response)).error.code).toBe(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
      );
    }
    expect(ctx.runRows()).toHaveLength(0);
  } finally {
    await ctx.cleanup();
  }
});

it("同 key 的 SSE 模式重试回放完整事件流并以 terminal 事件结束", async () => {
  const ctx = await setupRunApp(() => doneStream());
  try {
    const sessionId = await ctx.createSession();
    const key = "sse-replay-0001";
    const first = await ctx.startRunJson(sessionId, { idempotencyKey: key });
    const runId = await readRunId(first);
    const terminal = await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      runId,
    );
    expect(terminal.status).toBe("completed");

    const replay = await ctx.startRunSse(sessionId, { idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSseEvents(await readSseBody(replay));
    expect(events.length).toBeGreaterThan(1);
    expect(events[0]?.runId).toBe(runId);
    expect(events[0]?.type).toBe("run.started");
    expect(events.at(-1)?.type).toBe("run.completed");
    for (const [index, event] of events.entries()) {
      expect(event.sequence).toBe(index + 1);
    }
    expect(ctx.runRows()).toHaveLength(1);
  } finally {
    await ctx.cleanup();
  }
});

it("内联配置 Run 的同 key 重试返回同一 runId，不新建 Run row", async () => {
  const ctx = await setupRunApp(() => doneStream());
  try {
    const sessionId = await ctx.createSession();
    const key = "inline-run-0001";
    // agentId 传 undefined 会被 JSON.stringify 丢弃，换成内联 config
    const first = await ctx.startRunJson(sessionId, {
      agentId: undefined,
      idempotencyKey: key,
      config: {
        model: { providerId: "openai", modelId: "gpt-4" },
        systemPrompt: "内联配置的幂等测试",
      },
    });
    const runId = await readRunId(first);

    const second = await ctx.startRunJson(sessionId, {
      agentId: undefined,
      idempotencyKey: key,
      config: {
        model: { providerId: "openai", modelId: "gpt-4" },
        systemPrompt: "内联配置的幂等测试",
      },
    });
    const replayedRunId = await readRunId(second);
    expect(replayedRunId).toBe(runId);

    await pollRunTerminal(
      ctx.app,
      { cookie: ctx.user.cookie },
      sessionId,
      runId,
    );
    expect(ctx.runRows()).toHaveLength(1);

    // 内联 Run 行的 agentId 为空
    const row = ctx.runRows()[0]!;
    const runRow = ctx.runtime.db
      .select({ agentId: aiAgentRuns.agentId })
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, row.id))
      .get();
    expect(runRow?.agentId).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

async function registerAdmin(
  app: RunAppContext["app"],
  runtime: RunAppContext["runtime"],
) {
  const admin = await register(app, `run-idem-admin-${Date.now()}@example.com`);
  const adminRole = runtime.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "admin"))
    .get()!;
  const permissionRows = runtime.db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, "ai:config:manage"))
    .all();
  for (const permission of permissionRows) {
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
    .where(eq(userRoles.userId, admin.user.id))
    .run();
  return admin;
}

async function createAppCredential(
  app: RunAppContext["app"],
  cookie: string,
  name: string,
  tenantId: string,
  projectId: string,
): Promise<{ secret: string }> {
  const response = await app.request("/api/ai/admin/applications", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name, tenantId, projectId }),
  });
  expect(response.status).toBe(200);
  const result = await readSuccess<{ secret: string }>(response);
  return { secret: result.data.secret };
}

async function bearerStartRun(
  app: RunAppContext["app"],
  secret: string,
  agentId: string,
  idempotencyKey: string,
): Promise<{ runId: string; sessionId: string }> {
  const headers = bearerHeaders(secret);
  const created = await app.request("/api/ai/sessions", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "bearer idempotency" }),
  });
  expect(created.status).toBe(200);
  const sessionId = (await readSuccess<{ id: string }>(created)).data.id;

  const started = await app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ agentId, input: "hello", idempotencyKey }),
  });
  const runId = await readRunId(started);
  return { runId, sessionId };
}

function bearerHeaders(secret: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secret}`,
    "X-AI-External-User-Id": "customer-1",
  };
}
