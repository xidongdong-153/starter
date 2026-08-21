import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  harnessEventSchema,
  type AgentRun,
  type AgentTranscript,
  type HarnessEvent,
} from "@starter/contracts";
import { eq } from "drizzle-orm";
import { createParser } from "eventsource-parser";
import { expect, it } from "vitest";

import {
  createPiAgentExecutor,
  createPiSessionStore,
} from "@api/infra/agent/index.js";
import {
  aiAgentDefinitions,
  aiEnabledModels,
  aiProviderConfigs,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from "@api/infra/db/schema/index.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";
import { generateId } from "@api/shared/id.js";
import { z } from "zod";

import { createTestApp, readSuccess, register } from "./helpers.js";

const model: Model<Api> = {
  id: "cross-product-model",
  name: "Cross product model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 1024,
};

interface ProductClient {
  createSession: (title: string) => Promise<{ id: string }>;
  startRun: (sessionId: string, agentId: string) => Promise<Response>;
  getRun: (sessionId: string, runId: string) => Promise<Response>;
  abortRun: (sessionId: string, runId: string) => Promise<Response>;
  getTranscript: (sessionId: string) => Promise<Response>;
}

it("产品后端通过公开 Bearer HTTP/SSE 完成 Run 并按 scope 恢复 Transcript", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-cross-product-"));
  const store = createPiSessionStore({
    databasePath: join(directory, "agent-sessions.db"),
    cwd: directory,
  });
  const executor = createPiAgentExecutor({
    sessionStore: store,
    resolveModel: (ref) => ({
      ...model,
      id: ref.modelId,
      provider: ref.providerId,
    }),
    streamFn: (
      _model: Model<Api>,
      _context: Context,
      _options?: SimpleStreamOptions,
    ) => delayedCompletedStream("cross product answer"),
    hasPermission: async () => true,
  });
  const scopedTool = defineAiTool({
    name: "scoped_lookup",
    version: "1.0.0",
    description: "Project-scoped lookup",
    inputSchema: z.object({}),
    timeoutMs: 1000,
    scope: { tenantId: "tenant-a", projectId: "project-a" },
    requiredPermission: null,
    async execute() {
      return { modelText: "ok", safeSummary: "ok" };
    },
  });
  const { app, runtime, cleanup } = createTestApp(
    {},
    {
      agentSessionStore: store,
      piAgentExecutor: executor,
      aiTools: createAiToolRegistry([scopedTool]),
    },
  );

  try {
    const admin = await registerAiAdmin(app, runtime);
    const promptResponse = await app.request("/api/ai/system-prompts", {
      method: "POST",
      headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `cross-product-prompt-${Date.now()}`,
        content: "Return a concise answer.",
      }),
    });
    expect(promptResponse.status).toBe(200);
    const prompt = await readSuccess<{ id: string }>(promptResponse);
    const agentId = seedAgent(runtime, prompt.data.id);
    const first = await createAppCredential(
      app,
      admin.cookie,
      "Chat product",
      "tenant-a",
      "project-a",
    );
    const second = await createAppCredential(
      app,
      admin.cookie,
      "Other product",
      "tenant-a",
      "project-b",
    );
    const client = createProductClient(app, first.secret, "customer-1", {
      subjectType: "ticket",
      subjectId: "ticket-42",
    });

    const session = await client.createSession("Product chat");
    const response = await client.startRun(session.id, agentId);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const raw = await response.text();
    const events = parseSseByArbitraryChunks(raw);
    expect(events.length).toBeGreaterThan(0);
    expect(
      events.every((event) => harnessEventSchema.safeParse(event).success),
    ).toBe(true);
    expect(events.every((event) => event.runId === events[0]?.runId)).toBe(
      true,
    );
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    const terminal = events.filter((event) =>
      ["run.completed", "run.failed", "run.aborted"].includes(event.type),
    );
    expect(terminal).toHaveLength(1);
    expect(terminal[0]?.type).toBe("run.completed");

    const runId = events[0]?.runId;
    if (!runId) throw new Error("SSE 缺少 runId");
    const runResponse = await client.getRun(session.id, runId);
    expect(runResponse.status).toBe(200);
    const run = await readSuccess<AgentRun>(runResponse);
    expect(run.data.status).toBe("completed");
    expect(run.data.live).toBeNull();

    const transcriptResponse = await client.getTranscript(session.id);
    expect(transcriptResponse.status).toBe(200);
    const transcript = await readSuccess<AgentTranscript>(transcriptResponse);
    expect(JSON.stringify(transcript.data)).toContain("cross product answer");

    const otherProject = createProductClient(app, second.secret, "customer-1");
    expect((await otherProject.getRun(session.id, runId)).status).toBe(404);
    expect((await otherProject.abortRun(session.id, runId)).status).toBe(404);
    const otherProjectSession =
      await otherProject.createSession("Other project");
    const unavailableToolRun = await otherProject.startRun(
      otherProjectSession.id,
      agentId,
    );
    expect(unavailableToolRun.status).toBe(400);
    const otherUser = createProductClient(app, first.secret, "customer-2");
    expect((await otherUser.getTranscript(session.id)).status).toBe(404);

    const disconnectedSession = await client.createSession("Disconnected chat");
    const disconnectedResponse = await client.startRun(
      disconnectedSession.id,
      agentId,
    );
    const reader = disconnectedResponse.body?.getReader();
    if (!reader) throw new Error("SSE 缺少 response body");
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);
    const firstEvents = parseSseByArbitraryChunks(
      new TextDecoder().decode(firstChunk.value),
      false,
    );
    expect(firstEvents.length).toBeGreaterThan(0);
    const disconnectedRunId = firstEvents[0]?.runId;
    if (!disconnectedRunId) throw new Error("首个 SSE chunk 缺少 runId");
    await reader.cancel();
    const recoveredRun = await waitForTerminalRun(
      client,
      disconnectedSession.id,
      disconnectedRunId,
    );
    expect(recoveredRun.status).toBe("completed");
    const recoveredTranscript = await readSuccess<AgentTranscript>(
      await client.getTranscript(disconnectedSession.id),
    );
    expect(JSON.stringify(recoveredTranscript.data)).toContain(
      "cross product answer",
    );

    const secretMarker = first.secret;
    const publicData = JSON.stringify({
      events,
      run: run.data,
      transcript: transcript.data,
    });
    expect(publicData).not.toContain(secretMarker);
    expect(publicData).not.toContain("inputSchema");
    expect(publicData).not.toContain("providerSecret");

    await app.request(`/api/ai/admin/applications/${first.appId}/revoke`, {
      method: "POST",
      headers: { Cookie: admin.cookie },
    });
    expect((await client.getTranscript(session.id)).status).toBe(401);
  } finally {
    cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("sse parser 接受 heartbeat 和任意 chunk 边界", () => {
  const event = harnessEventSchema.parse({
    version: 1,
    eventId: generateId(),
    runId: generateId(),
    sessionId: generateId(),
    lane: "main",
    sequence: 1,
    createdAt: new Date().toISOString(),
    type: "run.started",
    data: {
      agentId: generateId(),
      agentRevision: 1,
      model: { providerId: "openai", modelId: "gpt-test" },
    },
  });
  const raw = `: heartbeat\n\nid: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  expect(parseSseByArbitraryChunks(raw)).toEqual([event]);
});

function createProductClient(
  app: ReturnType<typeof createTestApp>["app"],
  secret: string,
  externalUserId: string,
  subject?: { subjectType: string; subjectId: string },
): ProductClient {
  const headers = {
    Authorization: `Bearer ${secret}`,
    "X-AI-External-User-Id": externalUserId,
    ...(subject
      ? {
          "X-AI-Subject-Type": subject.subjectType,
          "X-AI-Subject-Id": subject.subjectId,
        }
      : {}),
  };
  return {
    async createSession(title) {
      const response = await app.request("/api/ai/sessions", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      expect(response.status).toBe(200);
      return (await readSuccess<{ id: string }>(response)).data;
    },
    startRun: async (sessionId, agentId) =>
      app.request(`/api/ai/sessions/${sessionId}/runs`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, input: "hello" }),
      }),
    getRun: async (sessionId, runId) =>
      app.request(`/api/ai/sessions/${sessionId}/runs/${runId}`, { headers }),
    abortRun: async (sessionId, runId) =>
      app.request(`/api/ai/sessions/${sessionId}/runs/${runId}/abort`, {
        method: "POST",
        headers,
      }),
    getTranscript: async (sessionId) =>
      app.request(`/api/ai/sessions/${sessionId}/transcript`, { headers }),
  };
}

function parseSseByArbitraryChunks(
  raw: string,
  consume = true,
): HarnessEvent[] {
  const events: HarnessEvent[] = [];
  const parser = createParser({
    onEvent(message) {
      events.push(
        harnessEventSchema.parse(JSON.parse(message.data) as unknown),
      );
    },
  });
  const chunkSizes = [1, 7, 3, 19, 2, 31];
  let offset = 0;
  let index = 0;
  while (offset < raw.length) {
    const size = chunkSizes[index % chunkSizes.length] ?? 1;
    parser.feed(raw.slice(offset, offset + size));
    offset += size;
    index += 1;
  }
  if (consume) parser.reset({ consume: true });
  return events;
}

function delayedCompletedStream(text: string) {
  const stream = createAssistantMessageEventStream();
  const pending = assistantMessage([], "pending");
  const completed = assistantMessage([{ type: "text", text }], "stop");
  setTimeout(() => {
    stream.push({ type: "start", partial: pending });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: pending,
    });
    stream.push({ type: "done", reason: "stop", message: completed });
  }, 20);
  return stream;
}

async function waitForTerminalRun(
  client: ProductClient,
  sessionId: string,
  runId: string,
): Promise<AgentRun> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await client.getRun(sessionId, runId);
    expect(response.status).toBe(200);
    const run = (await readSuccess<AgentRun>(response)).data;
    if (
      ["completed", "failed", "aborted", "interrupted"].includes(run.status)
    ) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Run 未在等待时间内进入终态");
}

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

async function registerAiAdmin(
  app: ReturnType<typeof createTestApp>["app"],
  runtime: ReturnType<typeof createTestApp>["runtime"],
) {
  const admin = await register(app, `cross-product-${Date.now()}@example.com`);
  const role = runtime.db
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
        roleId: role.id,
        permissionId: permission.id,
        assignedAt: new Date(),
        assignedBy: null,
      })
      .onConflictDoNothing()
      .run();
  }
  runtime.db
    .update(userRoles)
    .set({ roleId: role.id })
    .where(eq(userRoles.userId, admin.user.id))
    .run();
  return admin;
}

async function createAppCredential(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  name: string,
  tenantId: string,
  projectId: string,
): Promise<{ appId: string; secret: string }> {
  const response = await app.request("/api/ai/admin/applications", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name, tenantId, projectId }),
  });
  expect(response.status).toBe(200);
  const result = await readSuccess<{
    application: { appId: string };
    secret: string;
  }>(response);
  return { appId: result.data.application.appId, secret: result.data.secret };
}

function seedAgent(
  runtime: ReturnType<typeof createTestApp>["runtime"],
  systemPromptId: string,
): string {
  const catalogModel = runtime.ai.listModels("openai")[0];
  if (!catalogModel) throw new Error("测试模型目录为空");
  const modelRef = {
    providerId: catalogModel.providerId,
    modelId: catalogModel.modelId,
  };
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
  const id = generateId();
  runtime.db
    .insert(aiAgentDefinitions)
    .values({
      id,
      name: `cross-product-agent-${now.getTime()}`,
      description: "",
      status: "enabled",
      revision: 1,
      configJson: JSON.stringify({
        schemaVersion: 1,
        model: modelRef,
        systemPromptId,
        skillIds: [],
        toolNames: ["scoped_lookup"],
        thinkingLevel: "off",
        maxTurns: 8,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}
