import type {
  AiGateway,
  AiGatewayEvent,
  AiModelMessage,
} from "@api/infra/ai/index.js";
import type { AiConversationStreamEvent, AiModelRef } from "@starter/contracts";
import {
  aiConversationStreamEventSchema,
  ApiErrorCodes,
} from "@starter/contracts";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { AiGatewayError } from "@api/infra/ai/index.js";
import {
  aiConversationMessages,
  aiConversations,
  aiEnabledModels,
  aiGenerations,
  aiProviderConfigs,
  user,
} from "@api/infra/db/schema/index.js";
import { createAiConversationRepository } from "@api/modules/ai/conversation/conversation.repository.js";
import { createAiConversationService } from "@api/modules/ai/conversation/conversation.service.js";
import { generateId } from "@api/shared/id.js";

import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

function completedEvent(input: {
  text: string;
  turnIndex: number;
}): Extract<AiGatewayEvent, { type: "completed" }> {
  return {
    type: "completed",
    turnIndex: input.turnIndex,
    assistantMessage: {
      role: "assistant",
      blocks: [
        {
          type: "text",
          text: input.text,
          turnIndex: input.turnIndex,
          contentIndex: 0,
          blockId: `${input.turnIndex}:0`,
        },
      ],
    },
    stopReason: "stop",
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
  };
}

function createConversationGateway(captured: AiModelMessage[][]): AiGateway {
  let failNext = true;
  return {
    async *stream(input) {
      captured.push(input.messages);
      const lastUser = [...input.messages]
        .reverse()
        .find((message) => message.role === "user");
      const prompt = lastUser?.role === "user" ? lastUser.content[0]?.text : "";

      if (prompt === "fail" && failNext) {
        failNext = false;
        throw new AiGatewayError("upstream");
      }

      if (prompt === "abort") {
        yield {
          type: "text_delta",
          text: "partial",
          turnIndex: input.turnIndex,
          contentIndex: 0,
          blockId: `${input.turnIndex}:0`,
        };
        await waitForAbort(input.signal);
        throw new AiGatewayError("aborted");
      }

      yield {
        type: "text_delta",
        text: prompt === "fail" ? "retried" : "answer",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      yield completedEvent({
        text: prompt === "fail" ? "retried" : "answer",
        turnIndex: input.turnIndex,
      });
    },
  };
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

function parseConversationStream(body: string): AiConversationStreamEvent[] {
  return body
    .trim()
    .split(/\r?\n\r?\n/)
    .filter((frame) => frame.startsWith("event:"))
    .map((frame) => {
      const lines = frame.split(/\r?\n/);
      const eventName = lines[0]?.slice("event: ".length);
      const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
      const event = aiConversationStreamEventSchema.parse(
        JSON.parse(data ?? "{}"),
      );
      expect(event.type).toBe(eventName);
      return event;
    });
}

function seedModel(
  runtime: ReturnType<typeof createTestApp>["runtime"],
): AiModelRef {
  const model = runtime.ai.listModels("openai")[0];
  if (!model) throw new Error("测试模型目录为空");
  const now = new Date();
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: model.providerId,
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
      providerId: model.providerId,
      modelId: model.modelId,
      enabledAt: now,
    })
    .run();
  return { providerId: model.providerId, modelId: model.modelId };
}

async function createConversation(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
): Promise<{ id: string; cookie: string }> {
  const response = await app.request("/api/ai/conversations", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "测试会话" }),
  });
  expect(response.status).toBe(200);
  return { id: (await readSuccess<{ id: string }>(response)).data.id, cookie };
}

async function sendMessage(
  app: ReturnType<typeof createTestApp>["app"],
  conversationId: string,
  cookie: string,
  input: { text: string; model: AiModelRef },
) {
  const response = await app.request(
    `/api/ai/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return { response, events: parseConversationStream(await response.text()) };
}

it("会话按 owner 隔离，并把连续轮次的 assistant 传给 Gateway", async () => {
  const captured: AiModelMessage[][] = [];
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway(captured) },
  );
  try {
    const owner = await register(app, "conversation-owner@example.com");
    const other = await register(app, "conversation-other@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);

    const hidden = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      {
        headers: { cookie: other.cookie },
      },
    );
    expect(hidden.status).toBe(404);
    expect((await readFailure(hidden)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    const first = await sendMessage(app, conversation.id, owner.cookie, {
      text: "first",
      model,
    });
    expect(first.response.status).toBe(200);
    expect(first.events.map((event) => event.type)).toEqual([
      "start",
      "text_delta",
      "completed",
    ]);

    const second = await sendMessage(app, conversation.id, owner.cookie, {
      text: "second",
      model,
    });
    expect(second.response.status).toBe(200);
    expect(captured[1]?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      {
        headers: { cookie: owner.cookie },
      },
    );
    const messages = (
      await readSuccess<{ messages: Array<{ role: string }> }>(detail)
    ).data.messages;
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    const otherList = await app.request("/api/ai/conversations", {
      headers: { cookie: other.cookie },
    });
    expect(
      (await readSuccess<{ items: unknown[] }>(otherList)).data.items,
    ).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("首条消息标题不拆分 Unicode 字符且不超过契约上限", async () => {
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway([]) },
  );
  try {
    const owner = await register(app, "conversation-title@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    await sendMessage(app, conversation.id, owner.cookie, {
      text: "\u{1F642}".repeat(61),
      model,
    });

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { headers: { cookie: owner.cookie } },
    );
    const title = (await readSuccess<{ title: string }>(detail)).data.title;
    expect(title).toBe("\u{1F642}".repeat(60));
    expect(title).toHaveLength(120);
  } finally {
    cleanup();
  }
});

it("retry 复用原 user 消息，只增加新的 generation 和 assistant", async () => {
  const captured: AiModelMessage[][] = [];
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway(captured) },
  );
  try {
    const owner = await register(app, "conversation-retry@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const failed = await sendMessage(app, conversation.id, owner.cookie, {
      text: "fail",
      model,
    });
    expect(failed.events).toEqual([
      expect.objectContaining({ type: "start" }),
      expect.objectContaining({
        type: "error",
        code: ApiErrorCodes.AI_UPSTREAM_ERROR,
      }),
    ]);
    const source = failed.events[0];
    if (source?.type !== "start") throw new Error("缺少 generation start");

    const retryResponse = await app.request(
      `/api/ai/conversations/${conversation.id}/retry`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: source.generationId, model }),
      },
    );
    const retryEvents = parseConversationStream(await retryResponse.text());
    expect(retryResponse.status).toBe(200);
    expect(retryEvents.map((event) => event.type)).toEqual([
      "start",
      "text_delta",
      "completed",
    ]);

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      {
        headers: { cookie: owner.cookie },
      },
    );
    const messages = (
      await readSuccess<{
        messages: Array<{ role: string; generationId: string | null }>;
      }>(detail)
    ).data.messages;
    expect(messages.filter((message) => message.role === "user")).toHaveLength(
      1,
    );
    expect(
      messages.filter((message) => message.role === "assistant"),
    ).toHaveLength(2);
    expect(
      captured[1]?.filter((message) => message.role === "user"),
    ).toHaveLength(1);

    const sourceGeneration = runtime.db
      .select()
      .from(aiGenerations)
      .where(eq(aiGenerations.id, source.generationId))
      .get();
    const retryGeneration = runtime.db
      .select()
      .from(aiGenerations)
      .where(eq(aiGenerations.retryOfGenerationId, source.generationId))
      .get();
    expect(sourceGeneration).toMatchObject({ status: "failed" });
    expect(retryGeneration).toMatchObject({
      status: "succeeded",
      retryOfGenerationId: source.generationId,
      userMessageId: sourceGeneration?.userMessageId,
    });

    const retryAgain = await app.request(
      `/api/ai/conversations/${conversation.id}/retry`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: source.generationId, model }),
      },
    );
    expect(retryAgain.status).toBe(409);
    expect((await readFailure(retryAgain)).error.code).toBe(
      ApiErrorCodes.AI_RETRY_NOT_ALLOWED,
    );
  } finally {
    cleanup();
  }
});

it("stop 保留 assistant partial，下一轮仍能读取该 assistant", async () => {
  const captured: AiModelMessage[][] = [];
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway(captured) },
  );
  try {
    const owner = await register(app, "conversation-stop@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const response = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "abort", model }),
      },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("缺少 SSE body");
    const decoder = new TextDecoder();
    let body = "";
    let generationId: string | undefined;
    while (!generationId || !body.includes('"type":"text_delta"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
      const startMatch = body.match(
        /data: (\{[^\n]*"type":"start"[^\n]*\})\r?\n\r?\n/,
      );
      if (startMatch?.[1]) {
        const start = aiConversationStreamEventSchema.parse(
          JSON.parse(startMatch[1]),
        );
        generationId =
          start.type === "start" ? start.generationId : generationId;
      }
    }
    if (!generationId) throw new Error("缺少 generation ID");

    const stop = await app.request(
      `/api/ai/conversations/${conversation.id}/generations/${generationId}/stop`,
      { method: "POST", headers: { cookie: owner.cookie } },
    );
    expect(stop.status).toBe(202);
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    reader.releaseLock();
    expect(parseConversationStream(body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text_delta", text: "partial" }),
        expect.objectContaining({
          type: "error",
          code: ApiErrorCodes.AI_REQUEST_ABORTED,
        }),
      ]),
    );

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      {
        headers: { cookie: owner.cookie },
      },
    );
    const messages = (
      await readSuccess<{
        messages: Array<{
          status: string;
          blocks: Array<{ type: string; text?: string }>;
        }>;
      }>(detail)
    ).data.messages;
    expect(messages[1]).toMatchObject({
      status: "aborted",
      blocks: [{ type: "text", text: "partial" }],
    });
    expect(
      runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.id, generationId))
        .get(),
    ).toMatchObject({
      status: "aborted",
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    });
    expect(
      runtime.db
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.id, conversation.id))
        .get(),
    ).toMatchObject({ status: "idle", activeGenerationId: null });

    const continued = await sendMessage(app, conversation.id, owner.cookie, {
      text: "continue",
      model,
    });
    expect(continued.response.status).toBe(200);
    const partialAssistant = captured[1]?.find(
      (message) => message.role === "assistant",
    );
    expect(partialAssistant).toMatchObject({
      role: "assistant",
      blocks: [expect.objectContaining({ type: "text", text: "partial" })],
    });
  } finally {
    cleanup();
  }
});

it("timeout 保留 partial 并只发送一个 error 终态", async () => {
  const gateway: AiGateway = {
    async *stream(input) {
      yield {
        type: "text_delta",
        text: "partial-timeout",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      throw new AiGatewayError("timeout");
    },
  };
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const owner = await register(app, "conversation-timeout@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const sent = await sendMessage(app, conversation.id, owner.cookie, {
      text: "timeout",
      model,
    });

    expect(sent.events.map((event) => event.type)).toEqual([
      "start",
      "text_delta",
      "error",
    ]);
    expect(sent.events.at(-1)).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
    });
    const generationId =
      sent.events[0]?.type === "start"
        ? sent.events[0].generationId
        : undefined;
    expect(
      runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.id, generationId ?? ""))
        .get(),
    ).toMatchObject({
      status: "failed",
      errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
    });
    const assistant = runtime.db
      .select()
      .from(aiConversationMessages)
      .where(
        and(
          eq(aiConversationMessages.generationId, generationId ?? ""),
          eq(aiConversationMessages.role, "assistant"),
        ),
      )
      .get();
    expect(assistant).toMatchObject({ status: "failed" });
    expect(assistant?.contentJson).toContain("partial-timeout");
  } finally {
    cleanup();
  }
});

it("完整 tool arguments 不进入会话 SSE 和数据库", async () => {
  const marker = "private-tool-arguments-marker";
  const gateway: AiGateway = {
    async *stream(input) {
      const toolCall = {
        id: "call-1",
        name: "lookup",
        arguments: { query: marker },
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      yield { type: "tool_call_completed", ...toolCall };
      yield {
        type: "completed",
        turnIndex: input.turnIndex,
        assistantMessage: {
          role: "assistant",
          blocks: [{ type: "tool_call", ...toolCall }],
        },
        stopReason: "tool_use",
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
      };
    },
  };
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const owner = await register(app, "conversation-marker@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const response = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "use tool", model }),
      },
    );
    const body = await response.text();
    const events = parseConversationStream(body);

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "tool_activity",
      "tool_activity",
      "tool_activity",
      "tool_activity",
      "error",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_GENERATION_TOOL_ROUND_LIMIT,
    });
    expect(body).not.toContain(marker);
    const stored = runtime.db
      .select({ contentJson: aiConversationMessages.contentJson })
      .from(aiConversationMessages)
      .where(eq(aiConversationMessages.conversationId, conversation.id))
      .all();
    expect(JSON.stringify(stored)).not.toContain(marker);
    expect(stored.at(-1)?.contentJson).toContain('"type":"tool_activity"');
  } finally {
    cleanup();
  }
});

it("客户端取消读取后保留 partial 并终止 generation", async () => {
  const gateway: AiGateway = {
    async *stream(input) {
      yield {
        type: "text_delta",
        text: "partial-disconnect",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      await waitForAbort(input.signal);
      throw new AiGatewayError("aborted");
    },
  };
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const owner = await register(app, "conversation-disconnect@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const response = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "disconnect", model }),
      },
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("缺少 SSE body");
    const decoder = new TextDecoder();
    let body = "";
    let generationId: string | undefined;
    while (!generationId || !body.includes("partial-disconnect")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
      const startMatch = body.match(
        /data: (\{[^\n]*"type":"start"[^\n]*\})\r?\n\r?\n/,
      );
      if (startMatch?.[1]) {
        const start = aiConversationStreamEventSchema.parse(
          JSON.parse(startMatch[1]),
        );
        generationId =
          start.type === "start" ? start.generationId : generationId;
      }
    }
    if (!generationId) throw new Error("缺少 generation ID");

    await reader.cancel();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const generation = runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.id, generationId))
        .get();
      if (generation?.status === "aborted") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(
      runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.id, generationId))
        .get(),
    ).toMatchObject({
      status: "aborted",
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    });
    expect(
      runtime.db
        .select()
        .from(aiConversationMessages)
        .where(
          and(
            eq(aiConversationMessages.generationId, generationId),
            eq(aiConversationMessages.role, "assistant"),
          ),
        )
        .get(),
    ).toMatchObject({
      status: "aborted",
      contentJson: expect.stringContaining("partial-disconnect"),
    });
  } finally {
    cleanup();
  }
});

it("上下文超过 100000 个文本字符时，不新增消息", async () => {
  const captured: AiModelMessage[][] = [];
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway(captured) },
  );
  try {
    const owner = await register(app, "conversation-limit@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const first = await sendMessage(app, conversation.id, owner.cookie, {
      text: "x".repeat(100_000),
      model,
    });
    expect(first.response.status).toBe(200);

    const rejected = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "x", model }),
      },
    );
    expect(rejected.status).toBe(413);
    expect((await readFailure(rejected)).error.code).toBe(
      ApiErrorCodes.AI_CONTEXT_LIMIT,
    );

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      {
        headers: { cookie: owner.cookie },
      },
    );
    const detailData = await readSuccess<{ messages: unknown[] }>(detail);
    const messages = detailData.data.messages;
    expect(messages).toHaveLength(2);
  } finally {
    cleanup();
  }
});

it("上下文超过 50 条消息时，不新增消息", async () => {
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway([]) },
  );
  try {
    const owner = await register(app, "conversation-message-limit@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    for (let index = 0; index < 25; index += 1) {
      const sent = await sendMessage(app, conversation.id, owner.cookie, {
        text: `turn-${index}`,
        model,
      });
      expect(sent.response.status).toBe(200);
    }

    const rejected = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "too-many", model }),
      },
    );
    expect(rejected.status).toBe(413);
    expect((await readFailure(rejected)).error.code).toBe(
      ApiErrorCodes.AI_CONTEXT_LIMIT,
    );

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { headers: { cookie: owner.cookie } },
    );
    const detailData = await readSuccess<{ messages: unknown[] }>(detail);
    const messages = detailData.data.messages;
    expect(messages).toHaveLength(50);
  } finally {
    cleanup();
  }
});

it("会话所有权同时保护发送、停止和删除", async () => {
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway([]) },
  );
  try {
    const owner = await register(app, "conversation-owner-actions@example.com");
    const other = await register(app, "conversation-other-actions@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);

    const deleteByOther = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { method: "DELETE", headers: { cookie: other.cookie } },
    );
    expect(deleteByOther.status).toBe(404);
    expect((await readFailure(deleteByOther)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    const sendByOther = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: other.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "forbidden", model }),
      },
    );
    expect(sendByOther.status).toBe(404);
    expect((await readFailure(sendByOther)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    const ownerSend = await sendMessage(app, conversation.id, owner.cookie, {
      text: "owned",
      model,
    });
    const start = ownerSend.events.find((event) => event.type === "start");
    if (!start || start.type !== "start") throw new Error("缺少 generation ID");

    const stopByOther = await app.request(
      `/api/ai/conversations/${conversation.id}/generations/${start.generationId}/stop`,
      { method: "POST", headers: { cookie: other.cookie } },
    );
    expect(stopByOther.status).toBe(404);
    expect((await readFailure(stopByOther)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    const deleteByOwner = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
    );
    expect(deleteByOwner.status).toBe(200);
    expect(
      (
        await app.request(`/api/ai/conversations/${conversation.id}`, {
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(404);
  } finally {
    cleanup();
  }
});

it("并发发送使用 CAS，只创建一个 generation", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const captured: AiModelMessage[][] = [];
  const gateway: AiGateway = {
    async *stream(input) {
      markStarted();
      captured.push(input.messages);
      yield {
        type: "text_delta",
        text: "held",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      await gate;
      yield completedEvent({ text: "held", turnIndex: input.turnIndex });
    },
  };
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const owner = await register(app, "conversation-cas@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const firstRequest = app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "first", model }),
      },
    );
    await started;

    const secondRequest = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "second", model }),
      },
    );
    expect(secondRequest.status).toBe(409);
    expect((await readFailure(secondRequest)).error.code).toBe(
      ApiErrorCodes.AI_GENERATION_ACTIVE,
    );

    release();
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
    expect(parseConversationStream(await firstResponse.text())).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "completed" })]),
    );
    expect(captured).toHaveLength(1);
    expect(
      runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.conversationId, conversation.id))
        .all(),
    ).toHaveLength(1);
  } finally {
    cleanup();
  }
});

it("删除生成中的会话不会被旧 stream 复活", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gateway: AiGateway = {
    async *stream(input) {
      markStarted();
      yield {
        type: "text_delta",
        text: "partial",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      await waitForAbort(input.signal);
      throw new AiGatewayError("aborted");
    },
  };
  const { app, cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const owner = await register(app, "conversation-delete-race@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const streamRequest = app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "abort", model }),
      },
    );
    await started;

    const deleted = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
    );
    expect(deleted.status).toBe(200);
    const streamResponse = await streamRequest;
    await streamResponse.text();

    expect(
      runtime.db
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.id, conversation.id))
        .all(),
    ).toHaveLength(0);
    expect(
      runtime.db
        .select()
        .from(aiConversationMessages)
        .where(eq(aiConversationMessages.conversationId, conversation.id))
        .all(),
    ).toHaveLength(0);
    expect(
      runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.conversationId, conversation.id))
        .all(),
    ).toHaveLength(0);
  } finally {
    cleanup();
  }
});

it("旧 generation 的终态不会清除新 active generation", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const owner = await register(app, "conversation-old-finally@example.com");
    const conversation = await createConversation(app, owner.cookie);
    const now = new Date();
    const oldUserMessageId = generateId();
    const oldAssistantMessageId = generateId();
    const oldGenerationId = generateId();
    const newUserMessageId = generateId();
    const newAssistantMessageId = generateId();
    const newGenerationId = generateId();

    runtime.db
      .insert(aiConversationMessages)
      .values([
        {
          id: oldUserMessageId,
          conversationId: conversation.id,
          sequence: 1,
          role: "user",
          contentJson: "[]",
          status: "completed",
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
        {
          id: newUserMessageId,
          conversationId: conversation.id,
          sequence: 3,
          role: "user",
          contentJson: "[]",
          status: "completed",
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
      ])
      .run();
    runtime.db
      .insert(aiGenerations)
      .values([
        {
          id: oldGenerationId,
          conversationId: conversation.id,
          ownerId: owner.user.id,
          status: "generating",
          userMessageId: oldUserMessageId,
          startedAt: now,
        },
        {
          id: newGenerationId,
          conversationId: conversation.id,
          ownerId: owner.user.id,
          status: "generating",
          userMessageId: newUserMessageId,
          startedAt: now,
        },
      ])
      .run();
    runtime.db
      .insert(aiConversationMessages)
      .values([
        {
          id: oldAssistantMessageId,
          conversationId: conversation.id,
          sequence: 2,
          role: "assistant",
          contentJson: "[]",
          status: "streaming",
          generationId: oldGenerationId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: newAssistantMessageId,
          conversationId: conversation.id,
          sequence: 4,
          role: "assistant",
          contentJson: "[]",
          status: "streaming",
          generationId: newGenerationId,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
    runtime.db
      .update(aiConversations)
      .set({
        status: "generating",
        activeGenerationId: newGenerationId,
      })
      .where(eq(aiConversations.id, conversation.id))
      .run();

    createAiConversationRepository(runtime.db).finalizeGeneration({
      assistantContentJson: "[]",
      assistantMessageId: oldAssistantMessageId,
      assistantStatus: "aborted",
      conversationId: conversation.id,
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
      finishedAt: new Date(),
      generationId: oldGenerationId,
      generationStatus: "aborted",
      model: { providerId: "openai", modelId: "gpt-4o" },
      ownerId: owner.user.id,
      stopReason: null,
    });

    expect(
      runtime.db
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.id, conversation.id))
        .get(),
    ).toMatchObject({
      status: "generating",
      activeGenerationId: newGenerationId,
    });
    expect(
      runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.id, newGenerationId))
        .get(),
    ).toMatchObject({ status: "generating" });
  } finally {
    cleanup();
  }
});

it("启动恢复遗留 generating generation，并保留 partial assistant", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const owner = await register(app, "conversation-recovery@example.com");
    const now = new Date();
    const conversationId = generateId();
    const userMessageId = generateId();
    const generationId = generateId();
    const assistantMessageId = generateId();
    runtime.db
      .insert(aiConversations)
      .values({
        id: conversationId,
        ownerId: owner.user.id,
        title: "recovery",
        status: "generating",
        activeGenerationId: generationId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    runtime.db
      .insert(aiConversationMessages)
      .values({
        id: userMessageId,
        conversationId,
        sequence: 1,
        role: "user",
        contentJson: "[]",
        status: "completed",
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      })
      .run();
    runtime.db
      .insert(aiGenerations)
      .values({
        id: generationId,
        conversationId,
        ownerId: owner.user.id,
        status: "generating",
        userMessageId,
        startedAt: now,
      })
      .run();
    runtime.db
      .insert(aiConversationMessages)
      .values({
        id: assistantMessageId,
        conversationId,
        sequence: 2,
        role: "assistant",
        contentJson: JSON.stringify([
          {
            type: "text",
            text: "partial",
            turnIndex: 0,
            contentIndex: 0,
            blockId: "0:0",
          },
        ]),
        status: "streaming",
        generationId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    createAiConversationService(
      createAiConversationRepository(runtime.db),
      runtime.aiGateway,
      {
        isAllowed: () => true,
        resolve: async (_ownerId, requestedModel) =>
          requestedModel ?? { providerId: "openai", modelId: "gpt-4o-mini" },
      },
    );

    const recoveredGeneration = runtime.db
      .select()
      .from(aiGenerations)
      .where(eq(aiGenerations.id, generationId))
      .get();
    const recoveredAssistant = runtime.db
      .select()
      .from(aiConversationMessages)
      .where(eq(aiConversationMessages.id, assistantMessageId))
      .get();
    const recoveredConversation = runtime.db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .get();
    expect(recoveredGeneration).toMatchObject({
      status: "interrupted",
      errorCode: ApiErrorCodes.AI_GENERATION_INTERRUPTED,
    });
    expect(recoveredAssistant).toMatchObject({
      status: "interrupted",
      errorCode: ApiErrorCodes.AI_GENERATION_INTERRUPTED,
    });
    expect(recoveredConversation).toMatchObject({
      status: "idle",
      activeGenerationId: null,
    });

    const detail = await app.request(
      `/api/ai/conversations/${conversationId}`,
      {
        headers: { cookie: owner.cookie },
      },
    );
    expect(detail.status).toBe(200);
    expect(
      (
        await readSuccess<{ messages: Array<{ status: string }> }>(detail)
      ).data.messages.map((message) => message.status),
    ).toEqual(["completed", "interrupted"]);
  } finally {
    cleanup();
  }
});

it("历史模型失效后仍可读，但新调用拒绝该模型", async () => {
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway([]) },
  );
  try {
    const owner = await register(app, "conversation-model-revoked@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    const sent = await sendMessage(app, conversation.id, owner.cookie, {
      text: "historical",
      model,
    });
    expect(sent.response.status).toBe(200);
    runtime.db
      .delete(aiEnabledModels)
      .where(
        and(
          eq(aiEnabledModels.providerId, model.providerId),
          eq(aiEnabledModels.modelId, model.modelId),
        ),
      )
      .run();

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { headers: { cookie: owner.cookie } },
    );
    const detailData = (
      await readSuccess<{
        lastModel: AiModelRef | null;
        messages: unknown[];
      }>(detail)
    ).data;
    expect(detailData.lastModel).toEqual(model);
    expect(detailData.messages).toHaveLength(2);

    const rejected = await app.request(
      `/api/ai/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "new", model }),
      },
    );
    expect(rejected.status).toBe(403);
    expect((await readFailure(rejected)).error.code).toBe(
      ApiErrorCodes.AI_MODEL_NOT_ALLOWED,
    );
    expect(
      runtime.db
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.conversationId, conversation.id))
        .all(),
    ).toHaveLength(1);
  } finally {
    cleanup();
  }
});

it("migration 提供 cascade 和 conversation 内 sequence 唯一性", async () => {
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: createConversationGateway([]) },
  );
  try {
    const owner = await register(app, "conversation-migration@example.com");
    const model = seedModel(runtime);
    const conversation = await createConversation(app, owner.cookie);
    await sendMessage(app, conversation.id, owner.cookie, {
      text: "one",
      model,
    });
    await sendMessage(app, conversation.id, owner.cookie, {
      text: "two",
      model,
    });

    const detail = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { headers: { cookie: owner.cookie } },
    );
    const messages = (
      await readSuccess<{
        messages: Array<{ id: string; sequence: number }>;
      }>(detail)
    ).data.messages;
    expect(messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4]);
    expect(() =>
      runtime.db
        .insert(aiConversationMessages)
        .values({
          id: crypto.randomUUID(),
          conversationId: conversation.id,
          sequence: 1,
          role: "user",
          contentJson: "[]",
          status: "completed",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run(),
    ).toThrow();

    const conversationIndexes = runtime.database.sqlite.pragma(
      "index_list('ai_conversations')",
    ) as Array<{ name: string }>;
    const generationIndexes = runtime.database.sqlite.pragma(
      "index_list('ai_generations')",
    ) as Array<{ name: string }>;
    expect(conversationIndexes.map((index) => index.name)).toContain(
      "ai_conversations_owner_updated_idx",
    );
    expect(generationIndexes.map((index) => index.name)).toContain(
      "ai_generations_owner_conversation_idx",
    );
    const conversationIndexColumns = runtime.database.sqlite.pragma(
      "index_info('ai_conversations_owner_updated_idx')",
    ) as Array<{ name: string }>;
    const generationIndexColumns = runtime.database.sqlite.pragma(
      "index_info('ai_generations_owner_conversation_idx')",
    ) as Array<{ name: string }>;
    expect(conversationIndexColumns.map((column) => column.name)).toEqual([
      "owner_id",
      "updated_at",
      "id",
    ]);
    expect(generationIndexColumns.map((column) => column.name)).toEqual([
      "owner_id",
      "conversation_id",
      "started_at",
      "id",
    ]);

    const messageForeignKeys = runtime.database.sqlite.pragma(
      "foreign_key_list('ai_conversation_messages')",
    ) as Array<{ from: string; on_delete: string; table: string }>;
    const generationForeignKeys = runtime.database.sqlite.pragma(
      "foreign_key_list('ai_generations')",
    ) as Array<{ from: string; on_delete: string; table: string }>;
    expect(messageForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "conversation_id",
          table: "ai_conversations",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          from: "generation_id",
          table: "ai_generations",
          on_delete: "SET NULL",
        }),
      ]),
    );
    expect(generationForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "conversation_id",
          table: "ai_conversations",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          from: "retry_of_generation_id",
          table: "ai_generations",
          on_delete: "SET NULL",
        }),
        expect.objectContaining({
          from: "user_message_id",
          table: "ai_conversation_messages",
          on_delete: "CASCADE",
        }),
      ]),
    );

    const deleted = await app.request(
      `/api/ai/conversations/${conversation.id}`,
      { method: "DELETE", headers: { cookie: owner.cookie } },
    );
    expect(deleted.status).toBe(200);
    expect(runtime.db.select().from(aiConversationMessages).all()).toHaveLength(
      0,
    );
    expect(runtime.db.select().from(aiGenerations).all()).toHaveLength(0);
    expect(runtime.db.select().from(aiConversations).all()).toHaveLength(0);

    await createConversation(app, owner.cookie);
    runtime.db.delete(user).where(eq(user.id, owner.user.id)).run();
    expect(runtime.db.select().from(aiConversations).all()).toHaveLength(0);
  } finally {
    cleanup();
  }
});
