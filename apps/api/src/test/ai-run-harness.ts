import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Model,
  Models,
} from "@earendil-works/pi-ai";
import type { CompactionSettings } from "@earendil-works/pi-agent-core";
import type { TelemetryContext } from "@earendil-works/pi-telemetry";
import type { AgentThinkingLevel } from "@starter/contracts";
import { expect } from "vitest";
import { z } from "zod";

import { createPiAgentExecutor } from "@api/infra/agent/index.js";
import type { AppLogger } from "@api/infra/log/index.js";
import type { createPiSessionStore } from "@api/infra/agent/pi-session-store.js";
import {
  aiAgentDefinitions,
  aiEnabledModels,
  aiProviderConfigs,
  aiSystemPrompts,
} from "@api/infra/db/schema/index.js";
import { createAiRunLifecycleRepository } from "@api/modules/ai/run/index.js";
import {
  createAiToolRegistry,
  defineAiTool,
} from "@api/modules/ai/tool/tool-registry.js";
import { createAiUsageAuditRepository } from "@api/modules/ai/usage-audit/usage-audit.repository.js";
import { createAiUsageAuditService } from "@api/modules/ai/usage-audit/usage-audit.service.js";
import { generateId } from "@api/shared/id.js";

import { createTestApp, readSuccess } from "./helpers.js";

/**
 * Agent Run 的 app 级测试底座。
 *
 * 用真实的 Pi Executor、原生模型流、Turn/Step 生命周期仓库和用量审计，
 * 只把 Provider 的 `streamSimple` 换成测试桩，所以事件、SQLite 记录和 span
 * 都是真实链路产出的。telemetry 和用量审计可以按用例关掉。
 */
export const streamModel: Model<Api> = {
  id: "gpt-4",
  name: "Telemetry model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 1024,
};

export function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: streamModel.api,
    provider: streamModel.provider,
    model: streamModel.id,
    responseModel: "telemetry-model-2025",
    responseId: "provider-response-1",
    usage: {
      input: 11,
      output: 7,
      cacheRead: 1,
      cacheWrite: 2,
      reasoning: 3,
      totalTokens: 18,
      cost: {
        input: 0.001,
        output: 0.002,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.003,
      },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

export function streamAssistant(
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
        partial,
      });
    }
    if (block.type === "thinking") {
      stream.push({
        type: "thinking_start",
        contentIndex,
        partial,
      });
      stream.push({
        type: "thinking_delta",
        contentIndex,
        delta: block.thinking,
        partial,
      });
      stream.push({
        type: "thinking_end",
        contentIndex,
        content: block.thinking,
        partial,
      });
    }
    if (block.type === "toolCall") {
      stream.push({
        type: "toolcall_end",
        contentIndex,
        toolCall: block,
        partial,
      });
    }
  }
  stream.push({ type: "done", reason, message });
  return stream;
}

export function streamProviderError(): ReturnType<
  typeof createAssistantMessageEventStream
> {
  const stream = createAssistantMessageEventStream();
  const failed = assistantMessage([], "error");
  failed.errorMessage = "SECRET-PROVIDER-ERROR";
  stream.push({ type: "start", partial: assistantMessage([], "pending") });
  stream.push({ type: "error", reason: "error", error: failed });
  return stream;
}

export function modelsWith(
  streamSimple: Models["streamSimple"],
  overrides: {
    model?: Model<Api>;
    completeSimple?: Models["completeSimple"];
  } = {},
): Models {
  return {
    getModel: () => overrides.model ?? streamModel,
    getAuth: async () => ({ auth: { apiKey: "test" }, source: "test" }),
    streamSimple,
    ...(overrides.completeSimple
      ? { completeSimple: overrides.completeSimple }
      : {}),
  } as unknown as Models;
}

export function seedEnabledModel(
  runtime: ReturnType<typeof createTestApp>["runtime"],
): void {
  const now = new Date();
  runtime.db
    .insert(aiProviderConfigs)
    .values({
      providerId: streamModel.provider,
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
      providerId: streamModel.provider,
      modelId: streamModel.id,
      enabledAt: now,
    })
    .onConflictDoNothing()
    .run();
}

export function seedAgent(
  runtime: ReturnType<typeof createTestApp>["runtime"],
  toolRefs: Array<{ name: string; version: string }>,
  options: { maxTurns?: number; thinkingLevel?: AgentThinkingLevel } = {},
): string {
  const id = generateId();
  const promptId = generateId();
  const now = new Date();
  runtime.db
    .insert(aiSystemPrompts)
    .values({
      id: promptId,
      name: `telemetry-prompt-${promptId}`,
      content: "SECRET-SYSTEM-PROMPT",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  runtime.db
    .insert(aiAgentDefinitions)
    .values({
      id,
      name: `telemetry-agent-${now.getTime()}`,
      description: "",
      status: "enabled",
      revision: 1,
      configJson: JSON.stringify({
        schemaVersion: 2,
        model: { providerId: streamModel.provider, modelId: streamModel.id },
        systemPromptId: promptId,
        skillIds: [],
        toolRefs,
        outputContract: null,
        outputMode: "optional",
        thinkingLevel: options.thinkingLevel ?? "off",
        maxTurns: options.maxTurns ?? 8,
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export async function createSessionId(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
): Promise<string> {
  const created = await app.request("/api/ai/sessions", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "telemetry" }),
  });
  const body = await readSuccess<{ id: string }>(created);
  return body.data.id;
}

export async function startRunAndReadSse(
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  input: { agentId: string; input: string },
): Promise<{ sessionId: string; runId: string; events: RunSseEvent[] }> {
  const sessionId = await createSessionId(app, cookie);
  const started = await app.request(`/api/ai/sessions/${sessionId}/runs`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (started.status !== 200) {
    throw new Error(`Run 启动失败: ${started.status} ${await started.text()}`);
  }
  const events = parseSseEvents(await readSseBody(started));
  const runId = events[0]?.runId ?? "";
  expect(runId).toBeTruthy();
  return { sessionId, runId, events };
}

export interface RunSseEvent {
  eventId: string;
  type: string;
  runId: string;
  sequence: number;
  turnIndex: number | null;
  stepId: string | null;
  modelCallId: string | null;
  toolCallId: string | null;
  toolExecutionId: string | null;
  data: Record<string, unknown>;
}

export async function readSseBody(response: Response): Promise<string> {
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

export function parseSseEvents(body: string): RunSseEvent[] {
  const events: RunSseEvent[] = [];
  const dataLines: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
      continue;
    }
    if (line.trim() === "" && dataLines.length > 0) {
      events.push(JSON.parse(dataLines.join("\n")) as RunSseEvent);
      dataLines.length = 0;
    }
  }
  return events;
}

export function runTestApp(input: {
  store: ReturnType<typeof createPiSessionStore>;
  telemetry?: TelemetryContext;
  streamSimple: Models["streamSimple"];
  tools: ReturnType<typeof createAiToolRegistry>;
  /** 关掉用量审计，用来验证 span 和关联 ID 不依赖审计注入。 */
  withAudit?: boolean;
  /** 覆盖模型，例如用小 contextWindow 触发 compaction。 */
  model?: Model<Api>;
  /** executor 的安全日志出口，用来断言被拒绝的工具上报。 */
  logger?: AppLogger;
  /** compaction 摘要请求的返回值。 */
  completeSimple?: Models["completeSimple"];
  compaction?: Partial<CompactionSettings>;
}) {
  const withAudit = input.withAudit ?? true;
  const model = input.model ?? streamModel;
  return createTestApp(
    {},
    {
      agentSessionStore: input.store,
      ...(input.telemetry ? { telemetryContext: input.telemetry } : {}),
      aiTools: input.tools,
      piAgentExecutorFactory: (runtime) => {
        const usage = createAiUsageAuditService(
          createAiUsageAuditRepository(runtime.db),
          runtime.logger,
        );
        return createPiAgentExecutor({
          sessionStore: input.store,
          models: modelsWith(input.streamSimple, {
            model,
            ...(input.completeSimple
              ? { completeSimple: input.completeSimple }
              : {}),
          }),
          resolveModel: () => model,
          hasPermission: async () => true,
          ...(withAudit
            ? {
                audit: usage.createAgentModelCallAudit(),
                toolAudit: usage.createAgentToolExecutionAudit(),
              }
            : {}),
          lifecycle: createAiRunLifecycleRepository(runtime.db),
          ...(input.logger ? { logger: input.logger } : {}),
          requestTimeoutMs: 5000,
          ...(input.compaction ? { compaction: input.compaction } : {}),
        });
      },
    },
  );
}

export function lookupTool() {
  return createAiToolRegistry([
    defineAiTool({
      name: "lookup",
      version: "1.0.0",
      description: "Look up a value",
      inputSchema: z.object({ value: z.string() }),
      timeoutMs: 1000,
      scope: "platform",
      requiredPermission: null,
      execute: async () => ({
        modelText: "SECRET-TOOL-RESULT",
        safeSummary: "looked up",
      }),
    }),
  ]);
}
