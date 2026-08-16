import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  Models,
  StopReason,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";
import { ModelsError } from "@earendil-works/pi-ai";

import type { AiCost, AiUsage } from "@starter/contracts";

import type {
  AiGateway,
  AiGatewayErrorDetails,
  AiGatewayErrorKind,
  AiGatewayInput,
  AiGatewayStopReason,
  AiModelAssistantMessage,
  AiModelContentBlock,
  AiModelContentMetadata,
  AiModelMessage,
  AiModelToolCall,
} from "./ai-gateway.types.js";
import { createSdkTool } from "./ai-tool-schema.js";

export class AiGatewayError extends Error {
  readonly code: AiGatewayErrorKind;
  readonly usage: AiUsage | null;
  readonly cost: AiCost | null;
  readonly stopReason: AiGatewayStopReason | null;

  constructor(
    readonly kind: AiGatewayErrorKind,
    details: AiGatewayErrorDetails = {},
  ) {
    super(`AI gateway error: ${kind}`);
    this.name = "AiGatewayError";
    this.code = kind;
    this.usage = details.usage ?? null;
    this.cost = details.cost ?? null;
    this.stopReason = details.stopReason ?? null;
  }
}

export function createAiGateway(
  models: Models,
  timeoutMs: number,
  getProviderRequestEnv: (
    providerId: string,
  ) => Record<string, string> = () => ({}),
): AiGateway {
  return {
    async *stream(input) {
      const model = models.getModel(
        input.model.providerId,
        input.model.modelId,
      );
      if (!model) throw new AiGatewayError("model_not_found");

      const effectiveTimeoutMs = input.timeoutMs ?? timeoutMs;
      const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);
      const abortState: { cause: "aborted" | "timeout" | null } = {
        cause: input.signal?.aborted ? "aborted" : null,
      };
      const markAbortCause = (cause: "aborted" | "timeout") => {
        abortState.cause ??= cause;
      };
      const onInputAbort = () => markAbortCause("aborted");
      const onTimeoutAbort = () => markAbortCause("timeout");
      input.signal?.addEventListener("abort", onInputAbort, { once: true });
      timeoutSignal.addEventListener("abort", onTimeoutAbort, { once: true });
      const signal = AbortSignal.any(
        input.signal ? [input.signal, timeoutSignal] : [timeoutSignal],
      );
      const toolCalls = new Map<number, AiModelToolCall>();
      let completed = false;

      try {
        const env = getProviderRequestEnv(input.model.providerId);
        const auth = await models.getAuth(model, { env, signal });
        if (!auth) throw new AiGatewayError("auth");

        const stream = models.streamSimple(
          model,
          createSdkContext(input, model),
          {
            signal,
            env,
            timeoutMs: effectiveTimeoutMs,
            maxRetries: 0,
            maxTokens: Math.min(model.maxTokens, 2048),
            sessionId: input.sessionId,
          },
        );

        for await (const event of stream) {
          if (event.type === "text_delta") {
            yield {
              type: "text_delta",
              text: event.delta,
              ...contentMetadata(input.turnIndex, event.contentIndex),
            };
            continue;
          }

          if (event.type === "toolcall_end") {
            toolCalls.set(event.contentIndex, {
              type: "tool_call",
              id: event.toolCall.id,
              name: event.toolCall.name,
              arguments: event.toolCall.arguments as unknown,
              ...contentMetadata(input.turnIndex, event.contentIndex),
            });
            continue;
          }

          if (event.type === "error") {
            throw errorFromStreamEvent(
              event.reason,
              event.error.usage,
              abortState.cause,
              timeoutSignal,
              input.signal,
            );
          }

          if (event.type !== "done") continue;

          const usage = toUsage(event.message.usage);
          const cost = toCost(event.message.usage);
          if (abortState.cause) {
            throw new AiGatewayError(abortState.cause, {
              usage,
              cost,
              stopReason:
                event.reason === "deferred"
                  ? "deferred"
                  : normalizeStopReason(event.reason),
            });
          }
          if (event.reason === "deferred") {
            throw new AiGatewayError("upstream", {
              usage,
              cost,
              stopReason: "deferred",
            });
          }

          const assistantMessage = toModelAssistantMessage(
            event.message,
            input.turnIndex,
          );
          const stopReason = normalizeStopReason(event.reason);
          const completedToolCalls = validateCompletedToolCalls(
            assistantMessage,
            toolCalls,
            stopReason,
            usage,
            cost,
          );
          for (const toolCall of completedToolCalls) {
            yield { ...toolCall, type: "tool_call_completed" };
          }

          completed = true;
          yield {
            type: "completed",
            turnIndex: input.turnIndex,
            assistantMessage,
            stopReason,
            usage,
            cost,
          };
        }

        if (!completed) throw new AiGatewayError("upstream");
      } catch (error) {
        if (error instanceof AiGatewayError) throw error;
        if (abortState.cause === "timeout") throw new AiGatewayError("timeout");
        if (abortState.cause === "aborted" || isAbortError(error)) {
          throw new AiGatewayError("aborted");
        }
        if (
          error instanceof ModelsError &&
          (error.code === "auth" || error.code === "oauth")
        ) {
          throw new AiGatewayError("auth");
        }
        throw new AiGatewayError("upstream");
      } finally {
        input.signal?.removeEventListener("abort", onInputAbort);
        timeoutSignal.removeEventListener("abort", onTimeoutAbort);
      }
    },
  };
}

function createSdkContext(
  input: AiGatewayInput,
  model: Model<string>,
): Context {
  return {
    systemPrompt: input.systemPrompt,
    messages: input.messages.map((message) => toSdkMessage(message, model)),
    tools: input.tools?.map(createSdkTool),
  };
}

function toSdkMessage(message: AiModelMessage, model: Model<string>): Message {
  const timestamp = message.timestamp ?? Date.now();
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content.map((block) => ({
        type: "text",
        text: block.text,
      })),
      timestamp,
    };
  }
  if (message.role === "tool_result") {
    return {
      role: "toolResult",
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: [{ type: "text", text: message.content }],
      isError: message.isError,
      timestamp,
    };
  }
  return {
    role: "assistant",
    content: message.blocks.map(toSdkAssistantContent),
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptySdkUsage(),
    stopReason: "stop",
    timestamp,
  };
}

function toSdkAssistantContent(block: AiModelContentBlock) {
  if (block.type === "text") return { type: "text" as const, text: block.text };
  return {
    type: "toolCall" as const,
    id: block.id,
    name: block.name,
    arguments: toToolArguments(block.arguments),
  };
}

function toToolArguments(value: unknown): ToolCall["arguments"] {
  if (isRecord(value)) return value;
  return { value };
}

function toModelAssistantMessage(
  message: AssistantMessage,
  turnIndex: number,
): AiModelAssistantMessage {
  const blocks: AiModelContentBlock[] = [];
  for (const [contentIndex, block] of message.content.entries()) {
    const metadata = contentMetadata(turnIndex, contentIndex);
    if (block.type === "text") {
      blocks.push({ type: "text", text: block.text, ...metadata });
    } else if (block.type === "toolCall") {
      blocks.push({
        type: "tool_call",
        id: block.id,
        name: block.name,
        arguments: block.arguments as unknown,
        ...metadata,
      });
    }
  }
  return {
    role: "assistant",
    blocks,
    timestamp: message.timestamp,
  };
}

function validateCompletedToolCalls(
  assistantMessage: AiModelAssistantMessage,
  cached: ReadonlyMap<number, AiModelToolCall>,
  stopReason: "stop" | "length" | "tool_use",
  usage: AiUsage,
  cost: AiCost | null,
): AiModelToolCall[] {
  if (stopReason !== "tool_use") return [];

  const finalCalls = assistantMessage.blocks.filter(
    (block): block is AiModelToolCall => block.type === "tool_call",
  );
  if (finalCalls.length === 0 || finalCalls.length !== cached.size) {
    throw new AiGatewayError("upstream", { usage, cost, stopReason });
  }

  for (const finalCall of finalCalls) {
    const streamedCall = cached.get(finalCall.contentIndex);
    if (
      !streamedCall ||
      streamedCall.id !== finalCall.id ||
      streamedCall.name !== finalCall.name ||
      !sameJsonValue(streamedCall.arguments, finalCall.arguments)
    ) {
      throw new AiGatewayError("upstream", { usage, cost, stopReason });
    }
  }
  return finalCalls;
}

function contentMetadata(
  turnIndex: number,
  contentIndex: number,
): AiModelContentMetadata {
  return {
    turnIndex,
    contentIndex,
    blockId: `${turnIndex}:${contentIndex}`,
  };
}

function normalizeStopReason(
  reason: Exclude<StopReason, "pending" | "error" | "aborted" | "deferred">,
): "stop" | "length" | "tool_use" {
  if (reason === "length") return "length";
  if (reason === "toolUse") return "tool_use";
  return "stop";
}

function errorFromStreamEvent(
  reason: "error" | "aborted",
  usage: Usage | undefined,
  abortCause: "aborted" | "timeout" | null,
  timeoutSignal: AbortSignal,
  inputSignal: AbortSignal | undefined,
): AiGatewayError {
  const details: AiGatewayErrorDetails = {
    usage: toUsageOrNull(usage),
    cost: toCost(usage),
    stopReason: reason,
  };
  if (abortCause === "timeout" || (!abortCause && timeoutSignal.aborted)) {
    return new AiGatewayError("timeout", details);
  }
  if (
    abortCause === "aborted" ||
    (!abortCause && inputSignal?.aborted) ||
    reason === "aborted"
  ) {
    return new AiGatewayError("aborted", details);
  }
  return new AiGatewayError("upstream", details);
}

function toUsageOrNull(usage: Usage | undefined): AiUsage | null {
  return usage ? toUsage(usage) : null;
}

function toUsage(usage: Usage): AiUsage {
  return {
    inputTokens: numberOrNull(usage.input),
    outputTokens: numberOrNull(usage.output),
    cacheReadTokens: numberOrNull(usage.cacheRead),
    cacheWriteTokens: numberOrNull(usage.cacheWrite),
    cacheWrite1hTokens: numberOrNull(usage.cacheWrite1h),
    reasoningTokens: numberOrNull(usage.reasoning),
    totalTokens: numberOrNull(usage.totalTokens),
  };
}

function toCost(usage: Usage | undefined): AiCost | null {
  if (!usage?.cost) return null;
  const input = numberOrNull(usage.cost.input);
  const output = numberOrNull(usage.cost.output);
  const cacheRead = numberOrNull(usage.cost.cacheRead);
  const cacheWrite = numberOrNull(usage.cost.cacheWrite);
  const total = numberOrNull(usage.cost.total);
  if (
    input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null ||
    total === null
  ) {
    return null;
  }
  return { currency: "USD", input, output, cacheRead, cacheWrite, total };
}

function emptySdkUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  );
}
