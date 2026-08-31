// AI 图片附件链路（上传、引用、能力硬校验、投影、下载）的集成测试。
// 每个用例用 helpers.ts 注入的临时 SQLite 和临时附件目录，不读写开发库。
// 假字节不做图片解码：attachment.service 只校验 MIME 声明和大小。
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
} from "@earendil-works/pi-ai";
import type {
  AgentTranscript,
  ApiSuccess,
  AiAttachment,
  AiUsage,
} from "@starter/contracts";
import {
  agentTranscriptUserMessageSchema,
  aiAttachmentSchema,
  ApiErrorCodes,
} from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import type { AiGateway, AiGatewayInput } from "@api/infra/ai/index.js";
import { createPiAgentExecutor } from "@api/infra/agent/index.js";
import { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import {
  aiAgentDefinitions,
  aiAgentRuns,
  aiAgentSessions,
  aiAttachments,
  aiEnabledModels,
  aiModelCalls,
  aiProviderConfigs,
  aiSystemPrompts,
} from "@api/infra/db/schema/index.js";
import { createAuthorizationRepository } from "@api/modules/authorization/index.js";
import { generateId } from "@api/shared/id.js";
import { modelsWith, parseSseEvents, readSseBody } from "./ai-run-harness.js";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

type TestApp = ReturnType<typeof createTestApp>;
type TestAppInstance = TestApp["app"];

/** openai 内置目录里 input 含 image 的模型，走正向链路。 */
const IMAGE_MODEL_ID = "gpt-4o";
/** openai 内置目录里 input 只有 text 的模型，走能力硬校验失败分支。 */
const TEXT_MODEL_ID = "gpt-4";
/** 图片能力统一查 runtime.ai.listModels 的静态目录，测试前先确认标记没有漂移。 */
const PROVIDER_ID = "openai";

const PNG_BYTES = new TextEncoder().encode("attachment-fake-png-bytes-A");
const WEBP_BYTES = new TextEncoder().encode("attachment-fake-webp-bytes-B");

const systemContext = {
  actorType: "system",
  actorId: "test:ai",
  requestId: null,
} as const;

const fakeUsage: AiUsage = {
  inputTokens: 3,
  outputTokens: 7,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 10,
};

const fakeCompletionContent = "看图回答";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function stubModel(modelId: string, input: Model<Api>["input"]): Model<Api> {
  return {
    id: modelId,
    name: `Attachment stub ${modelId}`,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: "https://example.test",
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 1024,
  };
}

function fakeAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: PROVIDER_ID,
    model: "attachment-stub-model",
    responseModel: "attachment-stub-model-2025",
    responseId: "attachment-stub-response-1",
    usage: {
      input: 5,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 8,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function textStream(
  text: string,
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: fakeAssistantMessage([], "pending") });
  stream.push({
    type: "text_delta",
    contentIndex: 0,
    delta: text,
    partial: fakeAssistantMessage([], "pending"),
  });
  stream.push({
    type: "done",
    reason: "stop",
    message: fakeAssistantMessage([{ type: "text", text }], "stop"),
  });
  return stream;
}

function gatedTextStream(
  gate: Promise<void>,
  text: string,
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  void gate.then(() => {
    const message = fakeAssistantMessage([{ type: "text", text }], "stop");
    stream.push({
      type: "start",
      partial: fakeAssistantMessage([], "pending"),
    });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: fakeAssistantMessage([], "pending"),
    });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function createFakeGateway() {
  const inputs: AiGatewayInput[] = [];
  const gateway: AiGateway = {
    async *stream(input) {
      inputs.push(input);
      yield {
        type: "text_delta",
        text: fakeCompletionContent,
        turnIndex: 0,
        contentIndex: 0,
        blockId: "0:0",
      };
      yield {
        type: "completed",
        turnIndex: 0,
        assistantMessage: {
          role: "assistant",
          blocks: [
            {
              type: "text",
              text: fakeCompletionContent,
              turnIndex: 0,
              contentIndex: 0,
              blockId: "0:0",
            },
          ],
        },
        stopReason: "stop",
        usage: fakeUsage,
        cost: null,
      };
    },
  };
  return { gateway, inputs };
}

async function uploadAttachment(
  app: TestAppInstance,
  headers: Record<string, string>,
  input: {
    bytes: Uint8Array;
    mimeType: string;
    sessionId?: string;
  },
): Promise<Response> {
  const form = new FormData();
  form.set(
    "file",
    new File([input.bytes], `image.${input.mimeType.split("/")[1] ?? "png"}`, {
      type: input.mimeType,
    }),
  );
  if (input.sessionId !== undefined) form.set("sessionId", input.sessionId);
  return app.request("/api/ai/attachments", {
    method: "POST",
    headers,
    body: form,
  });
}

async function uploadAndRead(
  app: TestAppInstance,
  headers: Record<string, string>,
  input: {
    bytes: Uint8Array;
    mimeType: string;
    sessionId?: string;
  },
): Promise<AiAttachment> {
  const response = await uploadAttachment(app, headers, input);
  expect(response.status).toBe(201);
  return aiAttachmentSchema.parse(
    (await readSuccess<AiAttachment>(response)).data,
  );
}

async function createSession(
  app: TestAppInstance,
  cookie: string,
): Promise<string> {
  const response = await app.request("/api/ai/sessions", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "attachments" }),
  });
  expect(response.status).toBe(200);
  return (await readSuccess<{ id: string }>(response)).data.id;
}

function seedEnabledModel(
  runtime: TestApp["runtime"],
  modelId: string,
): { providerId: string; modelId: string } {
  const now = new Date();
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: PROVIDER_ID,
      enabled: true,
      configRevision: 0,
      checkedConfigRevision: 0,
      authStatus: "ready",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  runtime.db
    .insert(aiEnabledModels)
    .values({
      providerId: PROVIDER_ID,
      modelId,
      enabledAt: now,
    })
    .onConflictDoNothing()
    .run();
  return { providerId: PROVIDER_ID, modelId };
}

function seedAgentWithModel(
  runtime: TestApp["runtime"],
  modelId: string,
): string {
  const id = generateId();
  const promptId = generateId();
  const now = new Date();
  runtime.db
    .insert(aiSystemPrompts)
    .values({
      id: promptId,
      name: `attachment-prompt-${promptId}`,
      content: "回答要简短。",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  runtime.db
    .insert(aiAgentDefinitions)
    .values({
      id,
      name: `attachment-agent-${id}`,
      description: "",
      status: "enabled",
      revision: 1,
      configJson: JSON.stringify({
        schemaVersion: 2,
        model: { providerId: PROVIDER_ID, modelId },
        systemPromptId: promptId,
        skillIds: [],
        toolRefs: [],
        outputContract: null,
        outputMode: "optional",
        thinkingLevel: "off",
        maxTurns: 8,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function createAttachmentRunApp(input: {
  store: ReturnType<typeof createPiSessionStore>;
  modelId: string;
  stubInput: Model<Api>["input"];
  streamSimple: Models["streamSimple"];
}): TestApp {
  const stub = stubModel(input.modelId, input.stubInput);
  const executor = createPiAgentExecutor({
    sessionStore: input.store,
    models: modelsWith(input.streamSimple, { model: stub }),
    resolveModel: () => stub,
    hasPermission: async () => true,
    requestTimeoutMs: 5000,
  });
  return createTestApp(
    {},
    {
      agentSessionStore: input.store,
      piAgentExecutor: executor,
    },
  );
}

async function startRunWithAttachments(
  app: TestAppInstance,
  cookie: string,
  sessionId: string,
  agentId: string,
  attachmentIds: string[],
): Promise<Response> {
  return app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: "POST",
    headers: {
      cookie,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      agentId,
      input: "这张图里有什么",
      attachmentIds,
    }),
  });
}

async function waitForRunCompleted(
  app: TestAppInstance,
  cookie: string,
  sessionId: string,
  runId: string,
): Promise<void> {
  await vi.waitFor(
    async () => {
      const detail = await app.request(
        `/api/ai/sessions/${sessionId}/runs/${runId}`,
        { headers: { cookie } },
      );
      const body = await readSuccess<{ status: string }>(detail);
      expect(body.data.status).toBe("completed");
    },
    { timeout: 10_000 },
  );
}

it("白名单内四种 MIME 上传成功，附件行按 starter_user 归属落库", async () => {
  const { app, cleanup, runtime } = createTestApp({});
  try {
    const user = await register(app, "att-upload@example.com");
    const sessionId = await createSession(app, user.cookie);

    for (const mimeType of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]) {
      const response = await uploadAttachment(
        app,
        { cookie: user.cookie },
        {
          bytes: PNG_BYTES,
          mimeType,
        },
      );
      expect(response.status).toBe(201);
      const item = aiAttachmentSchema.parse(
        (await readSuccess<AiAttachment>(response)).data,
      );
      expect(item.mimeType).toBe(mimeType);
      expect(item.size).toBe(PNG_BYTES.length);
      expect(item.sessionId).toBeNull();
    }

    const withSession = await uploadAndRead(
      app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId,
      },
    );
    expect(withSession.sessionId).toBe(sessionId);

    const rows = runtime.db.select().from(aiAttachments).all();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.principalKind).toBe("starter_user");
      expect(row.ownerUserId).toBe(user.user.id);
      expect(row.appId).toBeNull();
      expect(row.storagePath).toBeTruthy();
    }
    expect(rows.filter((row) => row.sessionId === sessionId)).toHaveLength(1);
  } finally {
    cleanup();
  }
});

it("超 5MB、白名单外 MIME、空文件与非法 session 归属的上传被拒绝", async () => {
  const { app, cleanup, runtime } = createTestApp({});
  try {
    const user = await register(app, "att-upload-deny@example.com");
    const other = await register(app, "att-upload-other@example.com");
    const otherSessionId = await createSession(app, other.cookie);

    const unauthenticated = await uploadAttachment(
      app,
      {},
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
      },
    );
    expect(unauthenticated.status).toBe(401);

    const tooLarge = await uploadAttachment(
      app,
      { cookie: user.cookie },
      {
        bytes: new Uint8Array(5 * 1024 * 1024 + 1),
        mimeType: "image/png",
      },
    );
    expect(tooLarge.status).toBe(400);
    expect((await readFailure(tooLarge)).error.code).toBe(
      ApiErrorCodes.AI_ATTACHMENT_TOO_LARGE,
    );

    for (const mimeType of ["image/bmp", "text/plain"]) {
      const rejected = await uploadAttachment(
        app,
        { cookie: user.cookie },
        {
          bytes: PNG_BYTES,
          mimeType,
        },
      );
      expect(rejected.status).toBe(400);
      expect((await readFailure(rejected)).error.code).toBe(
        ApiErrorCodes.AI_ATTACHMENT_TYPE_NOT_ALLOWED,
      );
    }

    const empty = await uploadAttachment(
      app,
      { cookie: user.cookie },
      {
        bytes: new Uint8Array(0),
        mimeType: "image/png",
      },
    );
    expect(empty.status).toBe(400);
    expect((await readFailure(empty)).error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );

    const missingSession = await uploadAttachment(
      app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId: generateId(),
      },
    );
    expect(missingSession.status).toBe(404);
    expect((await readFailure(missingSession)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    const foreignSession = await uploadAttachment(
      app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId: otherSessionId,
      },
    );
    expect(foreignSession.status).toBe(404);
    expect((await readFailure(foreignSession)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    expect(runtime.db.select().from(aiAttachments).all()).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("startRun 带 attachmentIds 时 user message 含 image 块与顶层 attachmentIds，纯文本请求不带 image 块", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-att-run-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const contexts: Context[] = [];
  const test = createAttachmentRunApp({
    store,
    modelId: IMAGE_MODEL_ID,
    stubInput: ["text", "image"],
    streamSimple: (_model, context) => {
      contexts.push(context);
      return textStream("收到图片");
    },
  });
  try {
    seedEnabledModel(test.runtime, IMAGE_MODEL_ID);
    const agentId = seedAgentWithModel(test.runtime, IMAGE_MODEL_ID);
    const user = await register(test.app, "att-run-image@example.com");
    const sessionId = await createSession(test.app, user.cookie);
    const first = await uploadAndRead(
      test.app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId,
      },
    );
    const second = await uploadAndRead(
      test.app,
      { cookie: user.cookie },
      {
        bytes: WEBP_BYTES,
        mimeType: "image/webp",
        sessionId,
      },
    );

    const started = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs`,
      {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          input: "这张图里有什么",
          attachmentIds: [first.id, second.id],
        }),
      },
    );
    expect(started.status).toBe(200);
    const events = parseSseEvents(await readSseBody(started));
    expect(events.at(-1)?.type).toBe("run.completed");

    expect(contexts).toHaveLength(1);
    const message = contexts[0]?.messages.at(-1);
    expect(message?.role).toBe("user");
    expect((message as { content: unknown }).content).toEqual([
      { type: "text", text: "这张图里有什么" },
      { type: "image", data: base64(PNG_BYTES), mimeType: "image/png" },
      { type: "image", data: base64(WEBP_BYTES), mimeType: "image/webp" },
    ]);
    expect((message as { attachmentIds?: unknown }).attachmentIds).toEqual([
      first.id,
      second.id,
    ]);

    // 回归：不带附件的请求 user message 只有 text 块，没有 image 块和顶层 attachmentIds
    const plain = await test.app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, input: "纯文本问题" }),
    });
    expect(plain.status).toBe(200);
    const plainEvents = parseSseEvents(await readSseBody(plain));
    expect(plainEvents.at(-1)?.type).toBe("run.completed");
    expect(contexts).toHaveLength(2);
    const plainMessage = contexts[1]?.messages.at(-1);
    expect(plainMessage?.role).toBe("user");
    expect((plainMessage as { content: unknown }).content).toEqual([
      { type: "text", text: "纯文本问题" },
    ]);
    expect(
      (plainMessage as { attachmentIds?: unknown }).attachmentIds,
    ).toBeUndefined();
  } finally {
    test.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("模型不支持图片时 startRun 报 AI_IMAGE_NOT_SUPPORTED，不建 Run 也不消费幂等键", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-att-cap-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const test = createAttachmentRunApp({
    store,
    modelId: TEXT_MODEL_ID,
    stubInput: ["text"],
    streamSimple: () => textStream("纯文本回复"),
  });
  try {
    seedEnabledModel(test.runtime, TEXT_MODEL_ID);
    const agentId = seedAgentWithModel(test.runtime, TEXT_MODEL_ID);
    const user = await register(test.app, "att-capability@example.com");
    const sessionId = await createSession(test.app, user.cookie);
    const attachment = await uploadAndRead(
      test.app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId,
      },
    );

    const idempotencyKey = "attach-capability-key";
    const rejected = await startRunWithAttachments(
      test.app,
      user.cookie,
      sessionId,
      agentId,
      [attachment.id],
    );
    expect(rejected.status).toBe(400);
    expect((await readFailure(rejected)).error.code).toBe(
      ApiErrorCodes.AI_IMAGE_NOT_SUPPORTED,
    );

    // 带上幂等键重发一次，验证两次都被拒且都不建 Run
    const rejectedWithKey = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs`,
      {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          agentId,
          input: "这张图里有什么",
          attachmentIds: [attachment.id],
          idempotencyKey,
        }),
      },
    );
    expect(rejectedWithKey.status).toBe(400);
    expect((await readFailure(rejectedWithKey)).error.code).toBe(
      ApiErrorCodes.AI_IMAGE_NOT_SUPPORTED,
    );
    expect(test.runtime.db.select().from(aiAgentRuns).all()).toHaveLength(0);

    // 同一幂等键去掉附件重试能成功启动，说明失败请求没有消费 key
    const retried = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs`,
      {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          input: "纯文本提问",
          idempotencyKey,
        }),
      },
    );
    expect(retried.status).toBe(200);
    const retriedEvents = parseSseEvents(await readSseBody(retried));
    expect(retriedEvents.at(-1)?.type).toBe("run.completed");

    const rows = test.runtime.db.select().from(aiAgentRuns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBe(idempotencyKey);
  } finally {
    test.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("模型不支持图片时 steer 与 followUp 带附件同样报 AI_IMAGE_NOT_SUPPORTED", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-att-ctrl-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const test = createAttachmentRunApp({
    store,
    modelId: TEXT_MODEL_ID,
    stubInput: ["text"],
    streamSimple: () => gatedTextStream(gate, "纯文本回复"),
  });
  try {
    seedEnabledModel(test.runtime, TEXT_MODEL_ID);
    const agentId = seedAgentWithModel(test.runtime, TEXT_MODEL_ID);
    const user = await register(test.app, "att-ctrl-capability@example.com");
    const sessionId = await createSession(test.app, user.cookie);
    const attachment = await uploadAndRead(
      test.app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId,
      },
    );

    const started = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs`,
      {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ agentId, input: "先回答一个问题" }),
      },
    );
    expect(started.status).toBe(200);
    const { runId } = (await readSuccess<{ runId: string }>(started)).data;

    const steer = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs/${runId}/steer`,
      {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "再看这张图",
          attachmentIds: [attachment.id],
        }),
      },
    );
    expect(steer.status).toBe(400);
    expect((await readFailure(steer)).error.code).toBe(
      ApiErrorCodes.AI_IMAGE_NOT_SUPPORTED,
    );

    const followUp = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs/${runId}/follow-ups`,
      {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "追问带图",
          attachmentIds: [attachment.id],
        }),
      },
    );
    expect(followUp.status).toBe(400);
    expect((await readFailure(followUp)).error.code).toBe(
      ApiErrorCodes.AI_IMAGE_NOT_SUPPORTED,
    );

    release();
    await waitForRunCompleted(test.app, user.cookie, sessionId, runId);
  } finally {
    test.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("模型不支持图片时 completion 带附件报 AI_IMAGE_NOT_SUPPORTED 且不写模型调用审计", async () => {
  const { gateway, inputs } = createFakeGateway();
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const user = await register(app, "att-completion-cap@example.com");
    const modelRef = seedEnabledModel(runtime, TEXT_MODEL_ID);
    const attachment = await uploadAndRead(
      app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
      },
    );

    const response = await app.request("/api/ai/completions", {
      method: "POST",
      headers: {
        cookie: user.cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelRef,
        input: "描述图片",
        attachmentIds: [attachment.id],
      }),
    });
    expect(response.status).toBe(400);
    expect((await readFailure(response)).error.code).toBe(
      ApiErrorCodes.AI_IMAGE_NOT_SUPPORTED,
    );
    expect(inputs).toHaveLength(0);
    expect(runtime.db.select().from(aiModelCalls).all()).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("越权引用：他人附件与挂错 session 的附件返回 AI_ATTACHMENT_NOT_FOUND 且不建 Run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-att-authz-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const test = createAttachmentRunApp({
    store,
    modelId: IMAGE_MODEL_ID,
    stubInput: ["text", "image"],
    streamSimple: () => textStream("回复"),
  });
  try {
    seedEnabledModel(test.runtime, IMAGE_MODEL_ID);
    const agentId = seedAgentWithModel(test.runtime, IMAGE_MODEL_ID);
    const owner = await register(test.app, "att-authz-owner@example.com");
    const other = await register(test.app, "att-authz-other@example.com");
    const sessionA = await createSession(test.app, owner.cookie);
    const sessionB = await createSession(test.app, owner.cookie);

    // 其他 starter_user 的附件
    const foreign = await uploadAndRead(
      test.app,
      { cookie: other.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
      },
    );
    const deniedForeign = await startRunWithAttachments(
      test.app,
      owner.cookie,
      sessionA,
      agentId,
      [foreign.id],
    );
    expect(deniedForeign.status).toBe(404);
    expect((await readFailure(deniedForeign)).error.code).toBe(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
    );

    // 挂了 session A 的附件在 session B 的请求里引用
    const scoped = await uploadAndRead(
      test.app,
      { cookie: owner.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId: sessionA,
      },
    );
    const deniedScope = await startRunWithAttachments(
      test.app,
      owner.cookie,
      sessionB,
      agentId,
      [scoped.id],
    );
    expect(deniedScope.status).toBe(404);
    expect((await readFailure(deniedScope)).error.code).toBe(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
    );

    expect(test.runtime.db.select().from(aiAgentRuns).all()).toHaveLength(0);
  } finally {
    test.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("completion 带 attachmentIds 时网关收到 image 块；他人附件与挂 session 的附件返回 404", async () => {
  const { gateway, inputs } = createFakeGateway();
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const owner = await register(app, "att-completion-owner@example.com");
    const other = await register(app, "att-completion-other@example.com");
    const modelRef = seedEnabledModel(runtime, IMAGE_MODEL_ID);
    const ownerSessionId = await createSession(app, owner.cookie);

    // 其他用户的附件
    const foreign = await uploadAndRead(
      app,
      { cookie: other.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
      },
    );
    const deniedForeign = await app.request("/api/ai/completions", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelRef,
        input: "描述图片",
        attachmentIds: [foreign.id],
      }),
    });
    expect(deniedForeign.status).toBe(404);
    expect((await readFailure(deniedForeign)).error.code).toBe(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
    );

    // 挂了 session 的附件不能在无状态 completion 里引用
    const scoped = await uploadAndRead(
      app,
      { cookie: owner.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId: ownerSessionId,
      },
    );
    const deniedScope = await app.request("/api/ai/completions", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelRef,
        input: "描述图片",
        attachmentIds: [scoped.id],
      }),
    });
    expect(deniedScope.status).toBe(404);
    expect((await readFailure(deniedScope)).error.code).toBe(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
    );
    expect(inputs).toHaveLength(0);

    const first = await uploadAndRead(
      app,
      { cookie: owner.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
      },
    );
    const second = await uploadAndRead(
      app,
      { cookie: owner.cookie },
      {
        bytes: WEBP_BYTES,
        mimeType: "image/webp",
      },
    );
    const response = await app.request("/api/ai/completions", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelRef,
        input: "描述这两张图片",
        attachmentIds: [first.id, second.id],
      }),
    });
    expect(response.status).toBe(200);
    const result = await readSuccess<{ content: string }>(response);
    expect(result.data.content).toBe(fakeCompletionContent);

    expect(inputs).toHaveLength(1);
    const message = inputs[0]?.messages[0];
    expect(message?.role).toBe("user");
    if (message?.role === "user") {
      expect(message.content).toEqual([
        {
          type: "text",
          text: "描述这两张图片",
          turnIndex: 0,
          contentIndex: 0,
          blockId: "0:0",
        },
        {
          type: "image",
          data: base64(PNG_BYTES),
          mimeType: "image/png",
          turnIndex: 0,
          contentIndex: 1,
          blockId: "0:1",
        },
        {
          type: "image",
          data: base64(WEBP_BYTES),
          mimeType: "image/webp",
          turnIndex: 0,
          contentIndex: 2,
          blockId: "0:2",
        },
      ]);
    }
  } finally {
    cleanup();
  }
});

it("attachmentIds 超过 4 张在请求 schema 层被拒绝", async () => {
  const { app, cleanup } = createTestApp({});
  try {
    const user = await register(app, "att-count@example.com");
    const sessionId = await createSession(app, user.cookie);
    const fiveIds = Array.from({ length: 5 }, () => generateId());

    const start = await app.request(`/api/ai/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { cookie: user.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: generateId(),
        input: "这张图里有什么",
        attachmentIds: fiveIds,
      }),
    });
    expect(start.status).toBe(400);
    expect((await readFailure(start)).error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );

    const completion = await app.request("/api/ai/completions", {
      method: "POST",
      headers: {
        cookie: user.cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: { providerId: PROVIDER_ID, modelId: IMAGE_MODEL_ID },
        input: "描述图片",
        attachmentIds: fiveIds,
      }),
    });
    expect(completion.status).toBe(400);
    expect((await readFailure(completion)).error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );
  } finally {
    cleanup();
  }
});

it("带图 Run 完成后 transcript 投影 images 引用，base64 不出边界", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-att-transcript-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  const test = createAttachmentRunApp({
    store,
    modelId: IMAGE_MODEL_ID,
    stubInput: ["text", "image"],
    streamSimple: () => textStream("收到图片"),
  });
  try {
    seedEnabledModel(test.runtime, IMAGE_MODEL_ID);
    const agentId = seedAgentWithModel(test.runtime, IMAGE_MODEL_ID);
    const user = await register(test.app, "att-transcript@example.com");
    const sessionId = await createSession(test.app, user.cookie);
    const attachment = await uploadAndRead(
      test.app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId,
      },
    );

    const started = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs`,
      {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          input: "这张图里有什么",
          attachmentIds: [attachment.id],
        }),
      },
    );
    expect(started.status).toBe(200);
    const events = parseSseEvents(await readSseBody(started));
    expect(events.at(-1)?.type).toBe("run.completed");

    const transcriptResponse = await test.app.request(
      `/api/ai/sessions/${sessionId}/transcript`,
      { headers: { cookie: user.cookie } },
    );
    expect(transcriptResponse.status).toBe(200);
    const raw = await transcriptResponse.text();
    const body = JSON.parse(raw) as ApiSuccess<AgentTranscript>;
    const transcript = body.data;
    const userItem = transcript.items.find(
      (item) => item.type === "user_message",
    );
    const parsed = agentTranscriptUserMessageSchema.parse(userItem);
    expect(parsed.content).toBe("这张图里有什么");
    expect(parsed.images).toEqual([
      {
        attachmentId: attachment.id,
        mimeType: "image/png",
        url: `/api/ai/attachments/${attachment.id}/content`,
      },
    ]);
    expect(
      transcript.items.find((item) => item.type === "assistant_message"),
    ).toBeDefined();
    expect(raw).not.toContain(base64(PNG_BYTES));
  } finally {
    test.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("附件下载返回原始字节与 Content-Type，他人下载 404", async () => {
  const { app, cleanup } = createTestApp({});
  try {
    const user = await register(app, "att-download@example.com");
    const other = await register(app, "att-download-other@example.com");
    const attachment = await uploadAndRead(
      app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
      },
    );

    const content = await app.request(
      `/api/ai/attachments/${attachment.id}/content`,
      { headers: { cookie: user.cookie } },
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("content-length")).toBe(
      String(PNG_BYTES.length),
    );
    expect(content.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(PNG_BYTES);

    const denied = await app.request(
      `/api/ai/attachments/${attachment.id}/content`,
      { headers: { cookie: other.cookie } },
    );
    expect(denied.status).toBe(404);
    expect((await readFailure(denied)).error.code).toBe(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
    );
  } finally {
    cleanup();
  }
});

it("steer 带附件时插入的 user message 含 image 块并送达模型", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-att-steer-"));
  const store = createPiSessionStore({
    cwd: directory,
    databasePath: join(directory, "agent-sessions.db"),
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalFirstCall!: () => void;
  const firstCall = new Promise<void>((resolve) => {
    signalFirstCall = resolve;
  });
  const contexts: Context[] = [];
  let calls = 0;
  const streamSimple: Models["streamSimple"] = (_model, context) => {
    calls += 1;
    contexts.push(context);
    signalFirstCall();
    return calls === 1
      ? gatedTextStream(gate, "第一轮回复")
      : textStream("第二轮回复");
  };
  const test = createAttachmentRunApp({
    store,
    modelId: IMAGE_MODEL_ID,
    stubInput: ["text", "image"],
    streamSimple,
  });
  try {
    seedEnabledModel(test.runtime, IMAGE_MODEL_ID);
    const agentId = seedAgentWithModel(test.runtime, IMAGE_MODEL_ID);
    const user = await register(test.app, "att-steer@example.com");
    const sessionId = await createSession(test.app, user.cookie);
    const attachment = await uploadAndRead(
      test.app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId,
      },
    );

    const started = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs`,
      {
        method: "POST",
        headers: {
          cookie: user.cookie,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ agentId, input: "先回答第一个问题" }),
      },
    );
    expect(started.status).toBe(200);
    const { runId } = (await readSuccess<{ runId: string }>(started)).data;

    // 等第一次模型请求发出后再 steer，保证消息进入运行中的 agent
    await firstCall;

    const steer = await test.app.request(
      `/api/ai/sessions/${sessionId}/runs/${runId}/steer`,
      {
        method: "POST",
        headers: { cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "再看这张图",
          attachmentIds: [attachment.id],
        }),
      },
    );
    expect(steer.status).toBe(200);

    release();
    await waitForRunCompleted(test.app, user.cookie, sessionId, runId);

    expect(contexts).toHaveLength(2);
    const steered = contexts[1]?.messages.at(-1);
    expect(steered?.role).toBe("user");
    expect((steered as { content: unknown }).content).toEqual([
      { type: "text", text: "再看这张图" },
      { type: "image", data: base64(PNG_BYTES), mimeType: "image/png" },
    ]);
    expect((steered as { attachmentIds?: unknown }).attachmentIds).toEqual([
      attachment.id,
    ]);
  } finally {
    test.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

it("product_app 凭证可上传附件并在 completion 中引用，跨 principal 引用被拒绝", async () => {
  const { gateway, inputs } = createFakeGateway();
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const admin = await register(app, "att-app-admin@example.com");
    expect(
      createAuthorizationRepository(runtime.db).bootstrapAdminByEmail(
        "att-app-admin@example.com",
        systemContext,
      ).kind,
    ).toBe("ok");
    const credentialResponse = await app.request("/api/ai/admin/applications", {
      method: "POST",
      headers: { cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Attachment Product",
        tenantId: "tenant-a",
        projectId: "project-a",
      }),
    });
    expect(credentialResponse.status).toBe(200);
    const credential = await readSuccess<{
      application: { appId: string };
      secret: string;
    }>(credentialResponse);
    const bearerHeaders = {
      Authorization: `Bearer ${credential.data.secret}`,
      "X-AI-External-User-Id": "customer-1",
    };
    const modelRef = seedEnabledModel(runtime, IMAGE_MODEL_ID);

    const uploaded = await uploadAndRead(app, bearerHeaders, {
      bytes: PNG_BYTES,
      mimeType: "image/png",
    });
    expect(uploaded.sessionId).toBeNull();

    const rows = runtime.db.select().from(aiAttachments).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      principalKind: "product_app",
      appId: credential.data.application.appId,
      ownerUserId: null,
    });

    // starter_user 上传的附件不能被 product_app 引用
    const user = await register(app, "att-app-user@example.com");
    const userAttachment = await uploadAndRead(
      app,
      { cookie: user.cookie },
      {
        bytes: WEBP_BYTES,
        mimeType: "image/webp",
      },
    );
    const denied = await app.request("/api/ai/completions", {
      method: "POST",
      headers: {
        ...bearerHeaders,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelRef,
        input: "描述图片",
        attachmentIds: [userAttachment.id],
      }),
    });
    expect(denied.status).toBe(404);
    expect((await readFailure(denied)).error.code).toBe(
      ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND,
    );

    const response = await app.request("/api/ai/completions", {
      method: "POST",
      headers: {
        ...bearerHeaders,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelRef,
        input: "描述图片",
        attachmentIds: [uploaded.id],
      }),
    });
    expect(response.status).toBe(200);
    expect(inputs).toHaveLength(1);
    const message = inputs[0]?.messages[0];
    expect(message?.role).toBe("user");
    if (message?.role === "user") {
      expect(message.content[0]).toMatchObject({
        type: "text",
        text: "描述图片",
      });
      expect(message.content[1]).toEqual({
        type: "image",
        data: base64(PNG_BYTES),
        mimeType: "image/png",
        turnIndex: 0,
        contentIndex: 1,
        blockId: "0:1",
      });
    }
  } finally {
    cleanup();
  }
});

it("携带 sessionId 上传的附件行随 session 删除级联清理", async () => {
  const { app, cleanup, runtime } = createTestApp({});
  try {
    const user = await register(app, "att-cascade@example.com");
    const sessionId = await createSession(app, user.cookie);
    await uploadAndRead(
      app,
      { cookie: user.cookie },
      {
        bytes: PNG_BYTES,
        mimeType: "image/png",
        sessionId,
      },
    );
    expect(runtime.db.select().from(aiAttachments).all()).toHaveLength(1);

    runtime.db
      .delete(aiAgentSessions)
      .where(eq(aiAgentSessions.id, sessionId))
      .run();
    expect(runtime.db.select().from(aiAttachments).all()).toHaveLength(0);
  } finally {
    cleanup();
  }
});
