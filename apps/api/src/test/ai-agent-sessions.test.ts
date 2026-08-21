import type {
  AgentMessage,
  CompactionEntry,
} from "@earendil-works/pi-agent-core";
import type { Logger } from "pino";
import { ApiErrorCodes } from "@starter/contracts";
import { expect, it, vi } from "vitest";

import type { AgentSessionStore } from "@api/infra/agent/index.js";
import {
  createAiAgentSessionRepository,
  createAiAgentSessionService,
} from "@api/modules/ai/session/index.js";
import type { AiAgentSessionRepository } from "@api/modules/ai/session/session.repository.js";
import { generateId } from "@api/shared/id.js";
import { starterRuntimeAccess } from "@api/modules/ai/principal.js";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

async function requestJson(
  app: ReturnType<typeof createTestApp>["app"],
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      cookie,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function makeUserMessage(text: string, runId: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
    runId,
  } as unknown as AgentMessage;
}

function makeAssistantMessage(
  text: string,
  runId: string,
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted" = "stop",
): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      // toolCall block 带 arguments，用于验证投影只取标识、不泄露入参
      {
        type: "toolCall",
        id: "tc-1",
        name: "read_skill",
        arguments: { skillId: "secret-skill-id" },
      },
    ],
    api: "anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-0",
    usage: {
      input: 11,
      output: 22,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 33,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
    runId,
  } as unknown as AgentMessage;
}

function makeToolResultMessage(
  toolCallId: string,
  toolName: string,
  runId: string,
  details: Record<string, unknown> = {
    status: "succeeded",
    errorCode: null,
    safeSummary: "traslated ok",
  },
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: "tool model text" }],
    details: { ...details, runId },
    isError: false,
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

it("session CRUD、owner 隔离、分页和幂等归档", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const a = await register(app, "session-a@example.com");
    const b = await register(app, "session-b@example.com");

    expect((await app.request("/api/ai/sessions")).status).toBe(401);
    expect(
      (await requestJson(app, "POST", "/api/ai/sessions", "", {})).status,
    ).toBe(401);

    const created = await requestJson(
      app,
      "POST",
      "/api/ai/sessions",
      a.cookie,
      {
        title: "  首轮会话  ",
      },
    );
    expect(created.status).toBe(200);
    const body = await readSuccess<{
      id: string;
      title: string;
      defaultAgentId: string | null;
      archivedAt: string | null;
    }>(created);
    expect(body.data.title).toBe("首轮会话");
    expect(body.data.defaultAgentId).toBeNull();
    expect(body.data.archivedAt).toBeNull();
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);

    // 主库与 Pi DB 使用同一 id
    expect(await runtime.agentSessionStore.listSessions()).toContain(
      body.data.id,
    );

    const defaultTitle = await readSuccess<{ title: string }>(
      await requestJson(app, "POST", "/api/ai/sessions", a.cookie, {}),
    );
    expect(defaultTitle.data.title).toBe("新会话");

    // owner 隔离：b 不能看到或读取 a 的 session
    const listB = await readSuccess<{ items: unknown[]; total: number }>(
      await app.request("/api/ai/sessions", {
        headers: { cookie: b.cookie },
      }),
    );
    expect(listB.data.items).toHaveLength(0);

    const crossRead = await app.request(`/api/ai/sessions/${body.data.id}`, {
      headers: { cookie: b.cookie },
    });
    expect(crossRead.status).toBe(404);
    expect((await readFailure(crossRead)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    // 缺失 id 探测同样返回 404
    const missing = await app.request(`/api/ai/sessions/${generateId()}`, {
      headers: { cookie: a.cookie },
    });
    expect(missing.status).toBe(404);

    // 更新 title
    const updated = await requestJson(
      app,
      "PATCH",
      `/api/ai/sessions/${body.data.id}`,
      a.cookie,
      { title: "改名" },
    );
    expect(updated.status).toBe(200);
    expect((await readSuccess<{ title: string }>(updated)).data.title).toBe(
      "改名",
    );

    // 归档
    const archived = await requestJson(
      app,
      "DELETE",
      `/api/ai/sessions/${body.data.id}`,
      a.cookie,
    );
    expect(archived.status).toBe(200);
    expect(
      (await readSuccess<{ archivedAt: string | null }>(archived)).data
        .archivedAt,
    ).not.toBeNull();

    // 归档幂等：再次 DELETE 成功
    const archivedAgain = await requestJson(
      app,
      "DELETE",
      `/api/ai/sessions/${body.data.id}`,
      a.cookie,
    );
    expect(archivedAgain.status).toBe(200);

    // 归档后 GET / PATCH / transcript 都按不存在处理
    expect(
      (
        await app.request(`/api/ai/sessions/${body.data.id}`, {
          headers: { cookie: a.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await requestJson(
          app,
          "PATCH",
          `/api/ai/sessions/${body.data.id}`,
          a.cookie,
          { title: "再改" },
        )
      ).status,
    ).toBe(404);
    // 归档 session 即使携带无效 defaultAgentId 也先返回 404（先资源后输入）
    expect(
      (
        await requestJson(
          app,
          "PATCH",
          `/api/ai/sessions/${body.data.id}`,
          a.cookie,
          { defaultAgentId: generateId() },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/ai/sessions/${body.data.id}/transcript`, {
          headers: { cookie: a.cookie },
        })
      ).status,
    ).toBe(404);

    // 归档 session 不出现在默认列表，且 Pi history 仍保留
    const listA = await readSuccess<{ items: { id: string }[]; total: number }>(
      await app.request("/api/ai/sessions", {
        headers: { cookie: a.cookie },
      }),
    );
    expect(listA.data.items.map((item) => item.id)).not.toContain(body.data.id);
    expect(await runtime.agentSessionStore.listSessions()).toContain(
      body.data.id,
    );
  } finally {
    cleanup();
  }
});

it("transcript 投影、过滤、内部字段与 cursor/limit", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const user = await register(app, "transcript@example.com");
    const session = await readSuccess<{ id: string }>(
      await requestJson(app, "POST", "/api/ai/sessions", user.cookie, {}),
    );
    const sessionId = session.data.id;
    const runId = generateId();
    const store = runtime.agentSessionStore;

    // 写入：user, user, assistant, toolResult, compaction, starter.run.v1, 未知 custom
    await store.appendMessage({
      sessionId,
      lane: "main",
      message: makeUserMessage("第一条用户消息", runId),
    });
    await store.appendMessage({
      sessionId,
      lane: "main",
      message: makeUserMessage("第二条用户消息", runId),
    });
    await store.appendMessage({
      sessionId,
      lane: "main",
      message: makeAssistantMessage("你好，我是助手", runId),
    });
    await store.appendMessage({
      sessionId,
      lane: "main",
      message: makeToolResultMessage("tc-1", "read_skill", runId),
    });
    await store.appendCompaction({
      sessionId,
      lane: "main",
      entry: {
        type: "compaction",
        id: generateId(),
        summary: "压缩摘要",
        retainedTail: [],
        tokensBefore: 100,
      } as unknown as Omit<CompactionEntry, "parentId" | "seq" | "timestamp">,
    });
    await store.appendRunTerminalEntry({
      sessionId,
      lane: "main",
      data: {
        schemaVersion: 1,
        runId,
        sessionId,
        lane: "main",
        agentId: generateId(),
        agentRevision: 1,
        status: "completed",
        finalEntryId: null,
        errorCode: null,
        finishedAt: Date.now(),
      },
    });
    await store.appendMessage({
      sessionId,
      lane: "main",
      message: {
        role: "custom",
        customType: "unknown.kind",
        content: "x",
        display: false,
        timestamp: Date.now(),
      } as unknown as AgentMessage,
    });

    const response = await app.request(
      `/api/ai/sessions/${sessionId}/transcript`,
      { headers: { cookie: user.cookie } },
    );
    expect(response.status).toBe(200);
    const body = await readSuccess<{
      items: Array<Record<string, unknown>>;
      nextCursor: number | null;
    }>(response);

    // 只包含四个可投影 item（过滤 starter.run.v1、未知 custom）
    const types = body.data.items.map((item) => item.type);
    expect(types).toEqual([
      "user_message",
      "user_message",
      "assistant_message",
      "tool_activity",
      "system",
    ]);
    // 升序 sequence
    expect(body.data.items.map((item) => Number(item.sequence))).toEqual(
      [1, 2, 3, 4, 5].map((n) => n),
    );
    // 无下一页：全部返回，nextCursor null
    expect(body.data.nextCursor).toBeNull();

    // 内部字段不泄露
    const raw = JSON.stringify(body.data.items);
    expect(raw).not.toContain("details");
    expect(raw).not.toContain("arguments");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("retainedTail");

    // item payload 断言
    const first = body.data.items[0] as {
      type: string;
      content: string;
      runId: string;
    };
    expect(first.content).toBe("第一条用户消息");
    expect(first.runId).toBe(runId);
    const assistant = body.data.items[2] as {
      status: string;
      model: { providerId: string; modelId: string };
      stopReason: string;
      errorCode: string | null;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
      toolCalls: Array<{ toolCallId: string; name: string }>;
    };
    expect(assistant).toMatchObject({
      status: "completed",
      stopReason: "stop",
      errorCode: null,
      model: { providerId: "anthropic", modelId: "claude-sonnet-4-0" },
    });
    // usage 投影（来自 Pi assistant entry 的 usage 字段）
    expect(assistant.usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 22,
      totalTokens: 33,
    });
    // toolCalls 只有标识，不含 arguments，且 toolCallId 与 tool_activity item 对得上
    expect(assistant.toolCalls).toEqual([
      { toolCallId: "tc-1", name: "read_skill" },
    ]);
    const tool = body.data.items[3] as {
      toolCallId: string;
      name: string;
      status: string;
      safeSummary: string;
    };
    expect(tool).toMatchObject({
      toolCallId: "tc-1",
      name: "read_skill",
      status: "succeeded",
      safeSummary: "traslated ok",
    });
    const system = body.data.items[4] as {
      kind: string;
      summary: string;
      tokensBefore: number;
    };
    expect(system).toMatchObject({
      kind: "compaction",
      summary: "压缩摘要",
      tokensBefore: 100,
    });

    // limit=2 分页（direction=forward 保持既有语义）：第一页 2 项，nextCursor = 第 2 条 raw entry 的 seq
    const page1 = await readSuccess<{
      items: Array<{ id: string }>;
      nextCursor: number | null;
    }>(
      await app.request(
        `/api/ai/sessions/${sessionId}/transcript?limit=2&direction=forward`,
        { headers: { cookie: user.cookie } },
      ),
    );
    expect(page1.data.items).toHaveLength(2);
    expect(page1.data.nextCursor).toBe(2);

    // 游标继续：第二页从 seq 3 开始
    const page2 = await readSuccess<{
      items: Array<Record<string, unknown>>;
      nextCursor: number | null;
    }>(
      await app.request(
        `/api/ai/sessions/${sessionId}/transcript?limit=2&direction=forward&cursor=${page1.data.nextCursor}`,
        { headers: { cookie: user.cookie } },
      ),
    );
    expect(page2.data.items.map((item) => Number(item.sequence))).toEqual([
      3, 4,
    ]);
    expect(page2.data.nextCursor).toBe(4);

    // 原始 entry 数量刚好等于 limit 时也没有下一页。
    const exactPage = await readSuccess<{
      items: Array<Record<string, unknown>>;
      nextCursor: number | null;
    }>(
      await app.request(
        `/api/ai/sessions/${sessionId}/transcript?limit=7&direction=forward`,
        { headers: { cookie: user.cookie } },
      ),
    );
    expect(exactPage.data.nextCursor).toBeNull();

    // 非法 lane 被契约拦截
    const badLane = await app.request(
      `/api/ai/sessions/${sessionId}/transcript?lane=..%2Fevil`,
      { headers: { cookie: user.cookie } },
    );
    expect(badLane.status).toBe(400);
  } finally {
    cleanup();
  }
});

it("transcript backward 默认取最新一页，游标往更早翻且 items 保持时间正序", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const user = await register(app, "transcript-backward@example.com");
    const session = await readSuccess<{ id: string }>(
      await requestJson(app, "POST", "/api/ai/sessions", user.cookie, {}),
    );
    const sessionId = session.data.id;
    const runId = generateId();
    const store = runtime.agentSessionStore;

    for (let index = 1; index <= 5; index += 1) {
      await store.appendMessage({
        sessionId,
        lane: "main",
        message: makeUserMessage(`消息 ${index}`, runId),
      });
    }

    type Page = {
      items: Array<{ sequence: number; content: string }>;
      nextCursor: number | null;
    };

    // 首屏不传 cursor，默认 backward：取最新两条，但返回时是时间正序
    const latest = await readSuccess<Page>(
      await app.request(`/api/ai/sessions/${sessionId}/transcript?limit=2`, {
        headers: { cookie: user.cookie },
      }),
    );
    expect(latest.data.items.map((item) => item.sequence)).toEqual([4, 5]);
    expect(latest.data.items.map((item) => item.content)).toEqual([
      "消息 4",
      "消息 5",
    ]);
    // nextCursor 指向本页最早一条，用它继续往更早翻
    expect(latest.data.nextCursor).toBe(4);

    const earlier = await readSuccess<Page>(
      await app.request(
        `/api/ai/sessions/${sessionId}/transcript?limit=2&cursor=${latest.data.nextCursor}`,
        { headers: { cookie: user.cookie } },
      ),
    );
    expect(earlier.data.items.map((item) => item.sequence)).toEqual([2, 3]);
    expect(earlier.data.nextCursor).toBe(2);

    // 最后一页只剩一条，没有更早的内容
    const oldest = await readSuccess<Page>(
      await app.request(
        `/api/ai/sessions/${sessionId}/transcript?limit=2&cursor=${earlier.data.nextCursor}`,
        { headers: { cookie: user.cookie } },
      ),
    );
    expect(oldest.data.items.map((item) => item.sequence)).toEqual([1]);
    expect(oldest.data.nextCursor).toBeNull();
  } finally {
    cleanup();
  }
});

it("assistant item 的 blocks 保留 text 与 thinking 的原始顺序，content 只拼 text", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const user = await register(app, "transcript-blocks@example.com");
    const session = await readSuccess<{ id: string }>(
      await requestJson(app, "POST", "/api/ai/sessions", user.cookie, {}),
    );
    const sessionId = session.data.id;
    const runId = generateId();

    await runtime.agentSessionStore.appendMessage({
      sessionId,
      lane: "main",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先想一下" },
          { type: "text", text: "先说一句" },
          {
            type: "toolCall",
            id: "tc-blocks",
            name: "read_skill",
            arguments: { skillId: "secret-skill-id" },
          },
          { type: "thinking", thinking: "再想一下" },
          { type: "text", text: "再说一句" },
        ],
        api: "anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-0",
        usage: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
        runId,
      } as unknown as AgentMessage,
    });

    const body = await readSuccess<{
      items: Array<{
        type: string;
        content: string;
        blocks?: Array<{ type: string; text: string }>;
        toolCalls?: Array<{ toolCallId: string; name: string }>;
      }>;
    }>(
      await app.request(`/api/ai/sessions/${sessionId}/transcript`, {
        headers: { cookie: user.cookie },
      }),
    );
    const assistant = body.data.items[0];
    expect(assistant?.type).toBe("assistant_message");
    // blocks 按 message.content 原顺序，toolCall 块不进 blocks
    expect(assistant?.blocks).toEqual([
      { type: "thinking", text: "先想一下" },
      { type: "text", text: "先说一句" },
      { type: "thinking", text: "再想一下" },
      { type: "text", text: "再说一句" },
    ]);
    // content 语义不变，只拼 text 块
    expect(assistant?.content).toBe("先说一句再说一句");
    expect(assistant?.toolCalls).toEqual([
      { toolCallId: "tc-blocks", name: "read_skill" },
    ]);
    // 工具入参不进协议
    expect(JSON.stringify(body.data.items)).not.toContain("secret-skill-id");
  } finally {
    cleanup();
  }
});

it("只读一致性检查报告两类 orphan，不修改数据", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const user = await register(app, "consistency@example.com");
    const service = createAiAgentSessionService({
      repository: createAiAgentSessionRepository(runtime.db),
      sessionStore: runtime.agentSessionStore,
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      } as unknown as Logger,
    });
    const { aiAgentSessions } = await import("@api/modules/ai/ai.schema.js");

    // keepId：主库与 Pi 都有（一致）
    const keepId = generateId();
    await runtime.agentSessionStore.createSession({ id: keepId });
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: keepId,
        ownerId: user.user.id,
        title: "一致",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    // mainOnlyId：只有主库索引（missingInPi）
    const mainOnlyId = generateId();
    await runtime.db
      .insert(aiAgentSessions)
      .values({
        id: mainOnlyId,
        ownerId: user.user.id,
        title: "孤儿",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    // orphanPiId：只有 Pi session（missingInMain）
    const orphanPiId = generateId();
    await runtime.agentSessionStore.createSession({ id: orphanPiId });

    const report = await service.checkConsistency();
    expect(report.missingInPi).toEqual([mainOnlyId]);
    expect(report.missingInMain).toEqual([orphanPiId]);

    // 检查不删除数据
    expect(await runtime.agentSessionStore.listSessions()).toEqual(
      expect.arrayContaining([keepId, orphanPiId]),
    );
  } finally {
    cleanup();
  }
});

it("主库写入失败补偿删除 Pi Session；补偿失败记录日志", async () => {
  const { cleanup } = createTestApp();
  try {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    const fakeStore: AgentSessionStore = {
      createSession: vi.fn().mockResolvedValue({ id: "x" }) as never,
      deleteSession: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockResolvedValue([]),
    } as unknown as AgentSessionStore;

    const fakeRepository = {
      create: () => {
        throw new Error("db write failed");
      },
    } as unknown as AiAgentSessionRepository;

    // 场景 1：主库失败，Pi Session 被补偿删除
    const service = createAiAgentSessionService({
      repository: fakeRepository,
      sessionStore: fakeStore,
      logger,
    });
    await expect(
      service.create({}, starterRuntimeAccess(generateId()), "req-1"),
    ).rejects.toMatchObject({
      code: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
      status: 500,
    });
    expect(fakeStore.deleteSession).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();

    // 场景 2：补偿删除也失败，记录 sessionId 和 cause
    const failingDeleteStore = {
      createSession: vi.fn().mockResolvedValue({ id: "y" }) as never,
      deleteSession: vi
        .fn()
        .mockRejectedValue(new Error("delete failed")) as never,
    } as unknown as AgentSessionStore;
    const logger2 = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const service2 = createAiAgentSessionService({
      repository: fakeRepository,
      sessionStore: failingDeleteStore,
      logger: logger2,
    });
    await expect(
      service2.create({}, starterRuntimeAccess(generateId())),
    ).rejects.toMatchObject({
      status: 500,
    });
    expect(failingDeleteStore.deleteSession).toHaveBeenCalled();
    expect(logger2.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.any(String) }),
      expect.any(String),
    );
  } finally {
    cleanup();
  }
});

it("defaultAgentId 必须引用存在的 enabled Agent", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const user = await register(app, "default-agent@example.com");
    const { aiAgentDefinitions } = await import("@api/modules/ai/ai.schema.js");
    // 直接造一个 draft 和 enabled agent
    const draftId = generateId();
    const enabledId = generateId();
    const now = new Date();
    runtime.db
      .insert(aiAgentDefinitions)
      .values([
        {
          id: draftId,
          name: "draft-agent",
          description: "",
          status: "draft",
          revision: 1,
          configJson: JSON.stringify({
            schemaVersion: 1,
            model: null,
            systemPromptId: null,
            skillIds: [],
            toolNames: [],
            thinkingLevel: "off",
            maxTurns: 8,
          }),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: enabledId,
          name: "enabled-agent",
          description: "",
          status: "enabled",
          revision: 1,
          configJson: JSON.stringify({
            schemaVersion: 1,
            model: null,
            systemPromptId: null,
            skillIds: [],
            toolNames: [],
            thinkingLevel: "off",
            maxTurns: 8,
          }),
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    // 引用不存在的 agent
    const missing = await requestJson(
      app,
      "POST",
      "/api/ai/sessions",
      user.cookie,
      { defaultAgentId: generateId() },
    );
    expect(missing.status).toBe(400);
    expect((await readFailure(missing)).error.code).toBe(
      ApiErrorCodes.COMMON_INVALID_REQUEST,
    );

    // 引用 draft agent → 409
    const draft = await requestJson(
      app,
      "POST",
      "/api/ai/sessions",
      user.cookie,
      { defaultAgentId: draftId },
    );
    expect(draft.status).toBe(409);
    expect((await readFailure(draft)).error.code).toBe(
      ApiErrorCodes.AI_AGENT_NOT_ENABLED,
    );

    // 引用 enabled agent → 成功
    const ok = await requestJson(app, "POST", "/api/ai/sessions", user.cookie, {
      defaultAgentId: enabledId,
    });
    expect(ok.status).toBe(200);
    const body = await readSuccess<{ defaultAgentId: string | null }>(ok);
    expect(body.data.defaultAgentId).toBe(enabledId);
  } finally {
    cleanup();
  }
});
