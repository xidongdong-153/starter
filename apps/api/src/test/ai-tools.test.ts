import type {
  AiGateway,
  AiGatewayEvent,
  AiGatewayInput,
  AiModelToolCall,
} from "@api/infra/ai/index.js";
import type { AiToolActivityEvent, AiToolErrorCode } from "@starter/contracts";
import { ApiErrorCodes, PermissionKeys } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { AiGatewayError } from "@api/infra/ai/index.js";
import {
  aiConversationMessages,
  aiEnabledModels,
  aiProviderConfigs,
  aiToolExecutions,
} from "@api/infra/db/schema/index.js";
import { createAiToolOrchestrator } from "@api/modules/ai/tool/tool-orchestrator.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";
import {
  createAiUsageAuditRepository,
  type AiUsageAuditRepository,
} from "@api/modules/ai/usage-audit/usage-audit.repository.js";
import {
  createAiInvocationRunner,
  createAiUsageAuditService,
} from "@api/modules/ai/usage-audit/usage-audit.service.js";

import { createTestApp, readSuccess, register } from "./helpers.js";

const marker = "TOOL_SECRET_MARKER_73a9";
const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 2,
} as const;

it("生产 runtime 默认使用空工具注册表，并拒绝非法注册项", () => {
  const { cleanup, runtime } = createTestApp();
  try {
    expect(runtime.aiTools.list()).toEqual([]);
    expect(() =>
      createAiToolRegistry([
        defineAiTool({
          name: "bad name",
          description: "invalid",
          inputSchema: z.object({}),
          timeoutMs: 1000,
          requiredPermission: null,
          async execute() {
            return { modelText: "ok", safeSummary: null };
          },
        }),
      ]),
    ).toThrow("AI 工具名称无效");
  } finally {
    cleanup();
  }
});

it("合法工具执行后回填第二轮，并只持久化脱敏 activity", async () => {
  const captured: AiGatewayInput[] = [];
  const gateway = scriptedGateway(
    [toolCall("lookup", { query: marker }, 0, 0)],
    captured,
  );
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      description: "Look up a deterministic test value",
      inputSchema: z.object({ query: z.string() }),
      timeoutMs: 1000,
      requiredPermission: null,
      async execute(_context, input) {
        expect(input.query).toBe(marker);
        return {
          modelText: `private-result:${marker}`,
          safeSummary: "查询完成",
        };
      },
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: gateway, aiTools: registry },
  );
  try {
    const owner = await register(app, "tool-success@example.com");
    const model = seedModel(runtime);
    const conversationId = await createConversation(app, owner.cookie);
    const { body, events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      model,
    );

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "tool_activity",
      "text_delta",
      "completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "tool_activity",
      name: "lookup",
      status: "succeeded",
      errorCode: null,
      safeSummary: "查询完成",
    });
    expect(captured).toHaveLength(2);
    expect(captured[1]?.messages.at(-1)).toMatchObject({
      role: "tool_result",
      content: `private-result:${marker}`,
      isError: false,
    });

    const storedMessages = runtime.db
      .select({ contentJson: aiConversationMessages.contentJson })
      .from(aiConversationMessages)
      .where(eq(aiConversationMessages.conversationId, conversationId))
      .all();
    const storedAudit = runtime.db.select().from(aiToolExecutions).all();
    expect(JSON.stringify(storedMessages)).not.toContain(marker);
    expect(JSON.stringify(storedAudit)).not.toContain(marker);
    expect(body).not.toContain(marker);
    expect(storedMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentJson: expect.stringContaining("lookup"),
        }),
      ]),
    );
  } finally {
    cleanup();
  }
});

it("unknown、非法参数和无权限调用不执行 handler，但都有审计终态", async () => {
  const invalidHandler = vi.fn();
  const forbiddenHandler = vi.fn();
  const calls = [
    toolCall("missing", { secret: marker }, 0, 0),
    toolCall("strict_count", { count: marker }, 0, 1),
    toolCall("admin_only", { value: marker }, 0, 2),
  ];
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "strict_count",
      description: "Accept only a numeric count",
      inputSchema: z.object({ count: z.number() }),
      timeoutMs: 1000,
      requiredPermission: null,
      execute: invalidHandler,
    }),
    defineAiTool({
      name: "admin_only",
      description: "Require a permission the operator does not have",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      requiredPermission: PermissionKeys.AI_USAGE_READ,
      execute: forbiddenHandler,
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: scriptedGateway(calls), aiTools: registry },
  );
  try {
    const owner = await register(app, "tool-rejected@example.com");
    const conversationId = await createConversation(
      app,
      owner.cookie,
      seedModel(runtime),
    );
    const { events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      seedExistingModel(runtime),
    );

    expect(invalidHandler).not.toHaveBeenCalled();
    expect(forbiddenHandler).not.toHaveBeenCalled();
    const activities = events.filter(
      (event): event is AiToolActivityEvent => event.type === "tool_activity",
    );
    expect(activities.map((activity) => activity.status)).toEqual([
      "not_found",
      "invalid_arguments",
      "forbidden",
    ]);
    expect(activities.map((activity) => activity.errorCode)).toEqual([
      ApiErrorCodes.AI_TOOL_NOT_FOUND,
      ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
      ApiErrorCodes.AI_TOOL_FORBIDDEN,
    ] satisfies AiToolErrorCode[]);
    expect(
      runtime.db
        .select({ status: aiToolExecutions.status })
        .from(aiToolExecutions)
        .all()
        .map((row) => row.status)
        .sort(),
    ).toEqual(["forbidden", "invalid_arguments", "not_found"]);
  } finally {
    cleanup();
  }
});

it("toolcall completed 后 Provider 失败时不启动 handler 或 tool audit", async () => {
  const handler = vi.fn();
  const call = toolCall("never_run", { value: marker }, 0, 0);
  const gateway: AiGateway = {
    async *stream() {
      yield toolCallCompletedEvent(call);
      throw new AiGatewayError("upstream");
    },
  };
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "never_run",
      description: "Must not run without a successful tool-use terminal event",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      requiredPermission: null,
      execute: handler,
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: gateway, aiTools: registry },
  );
  try {
    const owner = await register(app, "tool-gated@example.com");
    const conversationId = await createConversation(
      app,
      owner.cookie,
      seedModel(runtime),
    );
    const { events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      seedExistingModel(runtime),
    );

    expect(handler).not.toHaveBeenCalled();
    expect(runtime.db.select().from(aiToolExecutions).all()).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_UPSTREAM_ERROR,
    });
  } finally {
    cleanup();
  }
});

it("并行工具反向完成时仍按模型 call 顺序发送结果", async () => {
  const registry = createAiToolRegistry([
    delayedTool("slow", 30),
    delayedTool("fast", 1),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      aiGateway: scriptedGateway([
        toolCall("slow", {}, 0, 0),
        toolCall("fast", {}, 0, 1),
      ]),
      aiTools: registry,
    },
  );
  try {
    const owner = await register(app, "tool-parallel@example.com");
    const conversationId = await createConversation(
      app,
      owner.cookie,
      seedModel(runtime),
    );
    const { events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      seedExistingModel(runtime),
    );
    expect(
      events
        .filter((event) => event.type === "tool_activity")
        .map((event) => event.name),
    ).toEqual(["slow", "fast"]);
  } finally {
    cleanup();
  }
});

it("工具 timeout 会取消 signal、结束审计并停止下一轮 Provider", async () => {
  let calls = 0;
  let handlerSignal: AbortSignal | undefined;
  let siblingSignal: AbortSignal | undefined;
  const gateway = scriptedGateway(
    [toolCall("wait", {}, 0, 0), toolCall("sibling", {}, 0, 1)],
    undefined,
    () => {
      calls += 1;
    },
  );
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "wait",
      description: "Wait until the execution signal is cancelled",
      inputSchema: z.object({}),
      timeoutMs: 100,
      requiredPermission: null,
      async execute(context) {
        handlerSignal = context.signal;
        await waitForToolAbort(context.signal);
        return { modelText: "unreachable", safeSummary: null };
      },
    }),
    defineAiTool({
      name: "sibling",
      description: "Wait for a sibling timeout to cancel this execution",
      inputSchema: z.object({}),
      timeoutMs: 1000,
      requiredPermission: null,
      async execute(context) {
        siblingSignal = context.signal;
        await waitForToolAbort(context.signal);
        return { modelText: "unreachable", safeSummary: null };
      },
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: gateway, aiTools: registry },
  );
  try {
    const owner = await register(app, "tool-timeout@example.com");
    const conversationId = await createConversation(
      app,
      owner.cookie,
      seedModel(runtime),
    );
    const { events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      seedExistingModel(runtime),
    );

    expect(calls).toBe(1);
    expect(handlerSignal?.aborted).toBe(true);
    expect(siblingSignal?.aborted).toBe(true);
    expect(
      events
        .filter((event) => event.type === "tool_activity")
        .map((event) => event.status),
    ).toEqual(["timed_out", "cancelled"]);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_TOOL_TIMED_OUT,
    });
    expect(
      runtime.db
        .select({ status: aiToolExecutions.status })
        .from(aiToolExecutions)
        .all()
        .map((row) => row.status)
        .sort(),
    ).toEqual(["cancelled", "timed_out"]);
  } finally {
    cleanup();
  }
});

it("工具结果让动态 Context 超限时不发起下一轮模型调用", async () => {
  let calls = 0;
  const gateway = scriptedGateway(
    [toolCall("large_result", {}, 0, 0)],
    undefined,
    () => {
      calls += 1;
    },
  );
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "large_result",
      description: "Return a large model-facing result",
      inputSchema: z.object({}),
      timeoutMs: 1000,
      requiredPermission: null,
      async execute() {
        return { modelText: "r".repeat(16_000), safeSummary: null };
      },
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: gateway, aiTools: registry },
  );
  try {
    const owner = await register(app, "tool-context@example.com");
    const model = seedModel(runtime);
    const conversationId = await createConversation(app, owner.cookie, model);
    const { events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      model,
      "x".repeat(90_000),
    );

    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_CONTEXT_LIMIT,
    });
  } finally {
    cleanup();
  }
});

it("超大 arguments 不执行 handler，回填 sentinel 并保持 invalid_arguments 终态", async () => {
  const oversized = "x".repeat(16_001);
  const captured: AiGatewayInput[] = [];
  const handler = vi.fn();
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "strict_query",
      description: "Accept a bounded query string",
      inputSchema: z.object({ query: z.string() }),
      timeoutMs: 1000,
      requiredPermission: null,
      execute: handler,
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      aiGateway: scriptedGateway(
        [toolCall("strict_query", { query: oversized }, 0, 0)],
        captured,
      ),
      aiTools: registry,
    },
  );
  try {
    const owner = await register(app, "tool-oversized@example.com");
    const model = seedModel(runtime);
    const conversationId = await createConversation(app, owner.cookie);
    const { body, events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      model,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(events[1]).toMatchObject({
      type: "tool_activity",
      status: "invalid_arguments",
      errorCode: ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
    });
    expect(events.at(-1)).toMatchObject({ type: "completed" });
    expect(captured[1]?.messages.at(-2)).toMatchObject({
      role: "assistant",
      blocks: [
        expect.objectContaining({
          type: "tool_call",
          name: "strict_query",
          arguments: { error: "arguments_too_large" },
        }),
      ],
    });
    expect(runtime.db.select().from(aiToolExecutions).all()).toEqual([
      expect.objectContaining({ status: "invalid_arguments" }),
    ]);
    expect(body).not.toContain(oversized.slice(0, 500));
  } finally {
    cleanup();
  }
});

it("handler 普通失败回填错误结果并继续第二轮，最终 generation 成功", async () => {
  const captured: AiGatewayInput[] = [];
  const handler = vi.fn(async () => {
    throw new Error(`handler-failure-${marker}`);
  });
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "boom",
      description: "Always fail",
      inputSchema: z.object({}),
      timeoutMs: 1000,
      requiredPermission: null,
      execute: handler,
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      aiGateway: scriptedGateway([toolCall("boom", {}, 0, 0)], captured),
      aiTools: registry,
    },
  );
  try {
    const owner = await register(app, "tool-failed@example.com");
    const model = seedModel(runtime);
    const conversationId = await createConversation(app, owner.cookie);
    const { body, events } = await sendMessage(
      app,
      conversationId,
      owner.cookie,
      model,
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "tool_activity",
      "text_delta",
      "completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "tool_activity",
      status: "failed",
      errorCode: ApiErrorCodes.AI_TOOL_FAILED,
    });
    expect(captured[1]?.messages.at(-1)).toMatchObject({
      role: "tool_result",
      content: "The tool failed.",
      isError: true,
    });
    expect(runtime.db.select().from(aiToolExecutions).all()).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
    expect(body).not.toContain(marker);
  } finally {
    cleanup();
  }
});

it("单轮 9 个调用在执行前失败，4 个工具轮次后只允许一次最终模型调用", async () => {
  const excessiveCalls = Array.from({ length: 9 }, (_, index) =>
    toolCall(`missing_${index}`, {}, 0, index),
  );
  const first = createTestApp(
    {},
    {
      aiGateway: scriptedGateway(excessiveCalls),
      aiTools: createAiToolRegistry([]),
    },
  );
  try {
    const owner = await register(first.app, "tool-call-limit@example.com");
    const model = seedModel(first.runtime);
    const conversationId = await createConversation(first.app, owner.cookie);
    const { events } = await sendMessage(
      first.app,
      conversationId,
      owner.cookie,
      model,
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_GENERATION_TOOL_CALL_LIMIT,
    });
    expect(first.runtime.db.select().from(aiToolExecutions).all()).toEqual([]);
  } finally {
    first.cleanup();
  }

  let providerCalls = 0;
  const repeatedGateway: AiGateway = {
    async *stream(input) {
      providerCalls += 1;
      const call = toolCall("missing", {}, input.turnIndex, 0);
      yield completedToolUse(input.turnIndex, [call]);
    },
  };
  const second = createTestApp(
    {},
    {
      aiGateway: repeatedGateway,
      aiTools: createAiToolRegistry([]),
    },
  );
  try {
    const owner = await register(second.app, "tool-round-limit@example.com");
    const model = seedModel(second.runtime);
    const conversationId = await createConversation(second.app, owner.cookie);
    const { events } = await sendMessage(
      second.app,
      conversationId,
      owner.cookie,
      model,
    );
    expect(providerCalls).toBe(5);
    expect(
      events.filter((event) => event.type === "tool_activity"),
    ).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: ApiErrorCodes.AI_GENERATION_TOOL_ROUND_LIMIT,
    });
  } finally {
    second.cleanup();
  }
});

it("停止 generation 会取消运行中的工具并关闭审计 running 状态", async () => {
  let startedResolve: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  const registry = createAiToolRegistry([
    defineAiTool({
      name: "wait_for_stop",
      description: "Wait until the generation is stopped",
      inputSchema: z.object({}),
      timeoutMs: 5000,
      requiredPermission: null,
      async execute(context) {
        startedResolve?.();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
        return { modelText: "unreachable", safeSummary: null };
      },
    }),
  ]);
  const { app, cleanup, runtime } = createTestApp(
    {},
    {
      aiGateway: scriptedGateway([toolCall("wait_for_stop", {}, 0, 0)]),
      aiTools: registry,
    },
  );
  try {
    const owner = await register(app, "tool-cancel@example.com");
    const model = seedModel(runtime);
    const conversationId = await createConversation(app, owner.cookie);
    const response = await app.request(
      `/api/ai/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "wait", model }),
      },
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("缺少 SSE body");
    const decoder = new TextDecoder();
    let body = "";
    let generationId: string | undefined;
    while (!generationId) {
      const next = await reader.read();
      if (next.done) break;
      body += decoder.decode(next.value, { stream: true });
      const match = body.match(/"generationId":"([^"]+)"/);
      generationId = match?.[1];
    }
    if (!generationId) throw new Error("缺少 generationId");
    await started;

    const stopped = await app.request(
      `/api/ai/conversations/${conversationId}/generations/${generationId}/stop`,
      { method: "POST", headers: { cookie: owner.cookie } },
    );
    expect(stopped.status).toBe(202);
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      body += decoder.decode(next.value, { stream: true });
    }
    const events = parseStreamEvents(body);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_activity",
          status: "cancelled",
          errorCode: ApiErrorCodes.AI_TOOL_CANCELLED,
        }),
        expect.objectContaining({
          type: "error",
          code: ApiErrorCodes.AI_REQUEST_ABORTED,
        }),
      ]),
    );
    expect(runtime.db.select().from(aiToolExecutions).all()).toEqual([
      expect.objectContaining({ status: "cancelled" }),
    ]);
  } finally {
    cleanup();
  }
});

it("tool 审计 begin 或 finalize 失败不改变 handler 和模型事件流", async () => {
  const { cleanup, runtime } = createTestApp();
  try {
    const logError = vi
      .spyOn(runtime.logger, "error")
      .mockImplementation(() => undefined);
    const handler = vi.fn(async () => ({
      modelText: `private-result:${marker}`,
      safeSummary: "执行完成",
    }));

    for (const failure of ["begin", "finalize"] as const) {
      const beginToolExecution = vi.fn(() => {
        if (failure === "begin") throw new Error(`sensitive-${marker}`);
      });
      const finalizeToolExecution = vi.fn(() => {
        if (failure === "finalize") throw new Error(`sensitive-${marker}`);
      });
      const repository = {
        recoverInterrupted: vi.fn(),
        beginModelCall: vi.fn(),
        finalizeModelCall: vi.fn(),
        beginToolExecution,
        finalizeToolExecution,
        findModelCall: vi.fn(),
        listModelCalls: vi.fn(() => ({ items: [], total: 0 })),
        listToolExecutions: vi.fn(() => []),
      } as unknown as AiUsageAuditRepository;
      const audit = createAiUsageAuditService(repository, runtime.logger);
      const gateway = scriptedGateway([
        toolCall("audit_failure", { value: marker }, 0, 0),
      ]);
      const orchestrator = createAiToolOrchestrator({
        invocationRunner: createAiInvocationRunner(gateway, audit),
        registry: createAiToolRegistry([
          defineAiTool({
            name: "audit_failure",
            description: "Verify audit failures are isolated",
            inputSchema: z.object({ value: z.string() }),
            timeoutMs: 1000,
            requiredPermission: null,
            execute: handler,
          }),
        ]),
        audit,
        hasPermission: async () => false,
        logger: runtime.logger,
      });
      const events = [];
      for await (const event of orchestrator.stream({
        model: { providerId: "openai", modelId: "test" },
        messages: [userMessage("use audit tool")],
        userId: "audit-user",
        requestId: `audit-${failure}`,
        conversationId: "audit-conversation",
        generationId: "audit-generation",
        initialTurnIndex: 0,
        requestTimeoutMs: 5000,
      })) {
        events.push(event);
      }

      expect(events.map((event) => event.type)).toEqual([
        "tool_activity",
        "text_delta",
        "completed",
      ]);
      expect(beginToolExecution).toHaveBeenCalledOnce();
      expect(finalizeToolExecution).toHaveBeenCalledTimes(
        failure === "begin" ? 0 : 1,
      );
      expect(JSON.stringify(beginToolExecution.mock.calls)).not.toContain(
        marker,
      );
      expect(JSON.stringify(events)).not.toContain(marker);
    }

    expect(handler).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(marker);
  } finally {
    cleanup();
  }
});

it("generation 总预算到期时中止 Gateway 并返回稳定错误码", async () => {
  let gatewaySignal: AbortSignal | undefined;
  const gateway: AiGateway = {
    async *stream(input) {
      gatewaySignal = input.signal;
      await new Promise<void>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(new AiGatewayError("aborted")),
          { once: true },
        );
      });
    },
  };
  const { cleanup, runtime } = createTestApp({}, { aiGateway: gateway });
  try {
    const audit = createAiUsageAuditService(
      createAiUsageAuditRepository(runtime.db),
      runtime.logger,
    );
    const orchestrator = createAiToolOrchestrator({
      invocationRunner: createAiInvocationRunner(gateway, audit),
      registry: createAiToolRegistry([]),
      audit,
      hasPermission: async () => false,
      logger: runtime.logger,
      generationTimeoutMs: 20,
    });
    const consume = async () => {
      for await (const _event of orchestrator.stream({
        model: { providerId: "openai", modelId: "test" },
        messages: [userMessage("wait")],
        userId: "missing-user",
        requestId: "total-timeout-request",
        conversationId: "missing-conversation",
        generationId: "missing-generation",
        initialTurnIndex: 0,
        requestTimeoutMs: 5000,
      })) {
        // 消费完整流以触发 generator 的 finally 和超时映射。
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: ApiErrorCodes.AI_GENERATION_TOOL_TOTAL_TIMEOUT,
    });
    expect(gatewaySignal?.aborted).toBe(true);
  } finally {
    cleanup();
  }
});

function userMessage(text: string) {
  return {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text,
        turnIndex: 0,
        contentIndex: 0,
        blockId: "0:0",
      },
    ],
    timestamp: Date.now(),
  };
}

async function waitForToolAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function scriptedGateway(
  calls: AiModelToolCall[],
  captured: AiGatewayInput[] = [],
  onCall: () => void = () => undefined,
): AiGateway {
  let callCount = 0;
  return {
    async *stream(input) {
      onCall();
      captured.push(input);
      if (callCount === 0) {
        callCount += 1;
        for (const call of calls) {
          yield toolCallCompletedEvent(call);
        }
        yield completedToolUse(input.turnIndex, calls);
        return;
      }
      yield {
        type: "text_delta",
        text: "done",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      yield completedText(input.turnIndex, "done");
    },
  };
}

function toolCall(
  name: string,
  argumentsValue: unknown,
  turnIndex: number,
  contentIndex: number,
): AiModelToolCall {
  return {
    type: "tool_call",
    id: `${name}-${contentIndex}`,
    name,
    arguments: argumentsValue,
    turnIndex,
    contentIndex,
    blockId: `${turnIndex}:${contentIndex}`,
  };
}

function toolCallCompletedEvent(
  call: AiModelToolCall,
): Extract<AiGatewayEvent, { type: "tool_call_completed" }> {
  return {
    type: "tool_call_completed",
    id: call.id,
    name: call.name,
    arguments: call.arguments,
    turnIndex: call.turnIndex,
    contentIndex: call.contentIndex,
    blockId: call.blockId,
  };
}

function completedToolUse(
  turnIndex: number,
  calls: AiModelToolCall[],
): Extract<AiGatewayEvent, { type: "completed" }> {
  return {
    type: "completed",
    turnIndex,
    assistantMessage: { role: "assistant", blocks: calls },
    stopReason: "tool_use",
    usage,
    cost: null,
  };
}

function completedText(
  turnIndex: number,
  text: string,
): Extract<AiGatewayEvent, { type: "completed" }> {
  return {
    type: "completed",
    turnIndex,
    assistantMessage: {
      role: "assistant",
      blocks: [
        {
          type: "text",
          text,
          turnIndex,
          contentIndex: 0,
          blockId: `${turnIndex}:0`,
        },
      ],
    },
    stopReason: "stop",
    usage,
    cost: null,
  };
}

function delayedTool(name: string, delayMs: number) {
  return defineAiTool({
    name,
    description: `Complete ${name} after a deterministic delay`,
    inputSchema: z.object({}),
    timeoutMs: 1000,
    requiredPermission: null,
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { modelText: name, safeSummary: name };
    },
  });
}

function seedModel(runtime: ReturnType<typeof createTestApp>["runtime"]) {
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

function seedExistingModel(
  runtime: ReturnType<typeof createTestApp>["runtime"],
) {
  const model = runtime.ai.listModels("openai")[0];
  if (!model) throw new Error("测试模型目录为空");
  return { providerId: model.providerId, modelId: model.modelId };
}

async function createConversation(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  _model?: { providerId: string; modelId: string },
): Promise<string> {
  const response = await app.request("/api/ai/conversations", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Tool test" }),
  });
  return (await readSuccess<{ id: string }>(response)).data.id;
}

async function sendMessage(
  app: ReturnType<typeof createTestApp>["app"],
  conversationId: string,
  cookie: string,
  model: { providerId: string; modelId: string },
  text = "use a tool",
) {
  const response = await app.request(
    `/api/ai/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model }),
    },
  );
  const body = await response.text();
  const events = parseStreamEvents(body);
  return { body, events };
}

function parseStreamEvents(body: string) {
  return body
    .trim()
    .split(/\r?\n\r?\n/)
    .filter((frame) => frame.startsWith("event:"))
    .map((frame) => {
      const data = frame
        .split(/\r?\n/)
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      return JSON.parse(data ?? "{}") as {
        type: string;
        [key: string]: unknown;
      };
    });
}
