import type {
  AiGateway,
  AiGatewayInput,
  AiModelMessage,
  AiModelToolCall,
} from "@api/infra/ai/index.js";
import { ApiErrorCodes } from "@starter/contracts";
import { expect, it } from "vitest";

import {
  aiEnabledModels,
  aiProviderConfigs,
  aiToolExecutions,
} from "@api/infra/db/schema/index.js";
import { createAiToolOrchestrator } from "@api/modules/ai/tool/tool-orchestrator.js";
import { createAiToolRegistry } from "@api/modules/ai/tool/tool-registry.js";
import { createTestAiTools } from "@api/modules/ai/tool/test-tools.js";
import { createAiUsageAuditRepository } from "@api/modules/ai/usage-audit/usage-audit.repository.js";
import {
  createAiInvocationRunner,
  createAiUsageAuditService,
} from "@api/modules/ai/usage-audit/usage-audit.service.js";

import { createTestApp, readSuccess, register } from "./helpers.js";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: 2,
} as const;

it("测试工具集注册：7 个工具名称与 schema 全部合法", () => {
  const tools = createTestAiTools();
  expect(tools).toHaveLength(7);
  const registry = createAiToolRegistry(tools);
  expect(registry.list().map((tool) => tool.name)).toEqual([
    "echo",
    "get_current_time",
    "add_numbers",
    "random_number",
    "fail_tool",
    "slow_tool",
    "admin_secret",
  ]);
});

it("env 开关启用时 runtime 注册测试工具，不配置时为空", () => {
  const enabled = createTestApp({ AI_TEST_TOOLS_ENABLED: "true" });
  try {
    expect(enabled.runtime.aiTools.list()).toHaveLength(7);
  } finally {
    enabled.cleanup();
  }

  const disabled = createTestApp();
  try {
    expect(disabled.runtime.aiTools.list()).toEqual([]);
  } finally {
    disabled.cleanup();
  }
});

it("echo 全链路：工具调用成功、回填模型上下文、审计 succeeded 且不含参数", async () => {
  const captured: AiGatewayInput[] = [];
  const gateway = scriptedGateway(
    [toolCall("echo", { text: "hello-tool" }, 0, 0)],
    captured,
  );
  const { app, cleanup, runtime } = createTestApp(
    {},
    { aiGateway: gateway, aiTools: createAiToolRegistry(createTestAiTools()) },
  );
  try {
    const owner = await register(app, "tool-echo@example.com");
    const model = seedModel(runtime);
    const conversationId = await createConversation(app, owner.cookie);
    const { events } = await sendMessage(
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
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_activity",
          name: "echo",
          status: "succeeded",
          errorCode: null,
        }),
      ]),
    );
    const executions = runtime.db.select().from(aiToolExecutions).all();
    expect(executions).toEqual([
      expect.objectContaining({ toolName: "echo", status: "succeeded" }),
    ]);
    expect(JSON.stringify(executions)).not.toContain("hello-tool");
    expect(JSON.stringify(captured)).toContain("hello-tool");
  } finally {
    cleanup();
  }
});

it("add_numbers 与 random_number 直接执行结果正确", async () => {
  const registry = createAiToolRegistry(createTestAiTools());
  const context = {
    userId: "unit-user",
    requestId: "unit-request",
    signal: new AbortController().signal,
  };

  const add = registry.find("add_numbers");
  expect(add).toBeDefined();
  const addResult = await add!.execute(context, { a: 2, b: 3 });
  expect(addResult.modelText).toBe("5");

  const random = registry.find("random_number");
  expect(random).toBeDefined();
  for (let i = 0; i < 20; i += 1) {
    const result = await random!.execute(context, { min: 1, max: 3 });
    expect(["1", "2", "3"]).toContain(result.modelText);
  }

  const time = registry.find("get_current_time");
  expect(time).toBeDefined();
  const timeResult = await time!.execute(context, {});
  expect(new Date(timeResult.modelText).toString()).not.toBe("Invalid Date");
});

it("fail_tool 走 orchestrator 失败路径：failed + AI_TOOL_FAILED + 审计", async () => {
  const { events } = await runOrchestratorWithTools(
    [toolCall("fail_tool", {}, 0, 0)],
    "fail-tool-user",
    "fail-tool-request",
  );
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tool_activity",
        name: "fail_tool",
        status: "failed",
        errorCode: ApiErrorCodes.AI_TOOL_FAILED,
      }),
    ]),
  );
  const activity = events.find((event) => event.type === "tool_activity");
  expect(activity).toEqual(expect.objectContaining({ safeSummary: null }));
});

it("admin_secret 无权限时返回 forbidden + AI_TOOL_FORBIDDEN", async () => {
  const { events } = await runOrchestratorWithTools(
    [toolCall("admin_secret", {}, 0, 0)],
    "no-permission-user",
    "forbidden-request",
  );
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tool_activity",
        name: "admin_secret",
        status: "forbidden",
        errorCode: ApiErrorCodes.AI_TOOL_FORBIDDEN,
      }),
    ]),
  );
  expect(JSON.stringify(events)).not.toContain("admin-secret-value");
});

it("slow_tool 超过工具超时返回 timed_out + AI_TOOL_TIMED_OUT", async () => {
  const { events, error } = await runOrchestratorWithTools(
    [toolCall("slow_tool", { seconds: 4 }, 0, 0)],
    "slow-tool-user",
    "slow-tool-request",
    { generationTimeoutMs: 30_000 },
  );
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tool_activity",
        name: "slow_tool",
        status: "timed_out",
        errorCode: ApiErrorCodes.AI_TOOL_TIMED_OUT,
      }),
    ]),
  );
  expect(error).toMatchObject({
    code: ApiErrorCodes.AI_TOOL_TIMED_OUT,
  });
}, 15_000);

async function runOrchestratorWithTools(
  calls: AiModelToolCall[],
  userId: string,
  requestId: string,
  deps: { generationTimeoutMs?: number } = {},
) {
  const { cleanup, runtime } = createTestApp(
    {},
    { aiGateway: scriptedGateway(calls) },
  );
  try {
    const audit = createAiUsageAuditService(
      createAiUsageAuditRepository(runtime.db),
      runtime.logger,
    );
    const orchestrator = createAiToolOrchestrator({
      invocationRunner: createAiInvocationRunner(runtime.aiGateway, audit),
      registry: createAiToolRegistry(createTestAiTools()),
      audit,
      hasPermission: async () => false,
      logger: runtime.logger,
      generationTimeoutMs: deps.generationTimeoutMs,
    });
    const events = [];
    let error: unknown = null;
    try {
      for await (const event of orchestrator.stream({
        model: { providerId: "openai", modelId: "test" },
        messages: [userMessage("use a tool")],
        userId,
        requestId,
        conversationId: "orchestrator-conversation",
        generationId: "orchestrator-generation",
        initialTurnIndex: 0,
        requestTimeoutMs: 5000,
      })) {
        events.push(event);
      }
    } catch (caught) {
      error = caught;
    }
    return { events, error };
  } finally {
    cleanup();
  }
}

function userMessage(text: string): AiModelMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text,
        turnIndex: 0,
        contentIndex: 0,
        blockId: "0:0",
      },
    ],
    timestamp: Date.now(),
  };
}

function scriptedGateway(
  calls: AiModelToolCall[],
  captured: AiGatewayInput[] = [],
): AiGateway {
  let callCount = 0;
  return {
    async *stream(input) {
      captured.push(input);
      if (callCount === 0) {
        callCount += 1;
        for (const call of calls) {
          yield {
            type: "tool_call_completed",
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            turnIndex: call.turnIndex,
            contentIndex: call.contentIndex,
            blockId: call.blockId,
          };
        }
        yield {
          type: "completed",
          turnIndex: input.turnIndex,
          assistantMessage: { role: "assistant", blocks: calls },
          stopReason: "tool_use",
          usage,
          cost: null,
        };
        return;
      }
      yield {
        type: "text_delta",
        text: "done",
        turnIndex: input.turnIndex,
        contentIndex: 0,
        blockId: `${input.turnIndex}:0`,
      };
      yield {
        type: "completed",
        turnIndex: input.turnIndex,
        assistantMessage: {
          role: "assistant",
          blocks: [
            {
              type: "text",
              text: "done",
              turnIndex: input.turnIndex,
              contentIndex: 0,
              blockId: `${input.turnIndex}:0`,
            },
          ],
        },
        stopReason: "stop",
        usage,
        cost: null,
      };
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

async function createConversation(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
): Promise<string> {
  const response = await app.request("/api/ai/conversations", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Test tools" }),
  });
  return (await readSuccess<{ id: string }>(response)).data.id;
}

async function sendMessage(
  app: ReturnType<typeof createTestApp>["app"],
  conversationId: string,
  cookie: string,
  model: { providerId: string; modelId: string },
) {
  const response = await app.request(
    `/api/ai/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "use a tool", model }),
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
