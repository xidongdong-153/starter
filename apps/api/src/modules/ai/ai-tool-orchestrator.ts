import type {
  AiToolActivityEvent,
  AiToolActivityStatus,
  AiToolErrorCode,
  Permission,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";
import type { Logger } from "pino";

import type {
  AiGatewayEvent,
  AiModelMessage,
  AiModelToolCall,
} from "@api/infra/ai/index.js";
import { AiGatewayError } from "@api/infra/ai/index.js";
import { AppError } from "@api/shared/app-error.js";

import type { AiToolRegistry } from "./ai-tool-registry.js";
import type {
  AiInvocationRunner,
  AiUsageAuditService,
} from "./ai-usage-audit.service.js";
import { resolveToolExecutionTimeout } from "./ai-usage-audit.service.js";

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS_PER_ROUND = 8;
const MAX_GENERATION_MS = 120_000;
const MAX_CONTEXT_MESSAGES = 50;
const MAX_CONTEXT_CHARS = 100_000;
const MAX_TOOL_ARGUMENT_CHARS = 16_000;
const MAX_TOOL_RESULT_CHARS = 16_000;
const MAX_SAFE_SUMMARY_CHARS = 1000;

export interface AiToolOrchestratorInput {
  model: { providerId: string; modelId: string };
  messages: AiModelMessage[];
  systemPrompt?: string;
  userId: string;
  requestId: string;
  conversationId: string;
  generationId: string;
  initialTurnIndex: number;
  sessionId?: string;
  signal?: AbortSignal;
  requestTimeoutMs: number;
}

export type AiToolOrchestratorEvent =
  | Exclude<AiGatewayEvent, { type: "tool_call_completed" }>
  | AiToolActivityEvent;

interface ToolOutcome {
  activity: AiToolActivityEvent;
  modelText: string;
  isError: boolean;
  terminal: "cancelled" | "timed_out" | null;
}

interface AiToolOrchestratorDeps {
  invocationRunner: AiInvocationRunner;
  registry: AiToolRegistry;
  audit: AiUsageAuditService;
  hasPermission: (userId: string, permission: Permission) => Promise<boolean>;
  logger: Logger;
  generationTimeoutMs?: number;
}

export function createAiToolOrchestrator(deps: AiToolOrchestratorDeps) {
  return {
    async *stream(
      input: AiToolOrchestratorInput,
    ): AsyncGenerator<AiToolOrchestratorEvent> {
      const messages = [...input.messages];
      const generationTimeoutMs = deps.generationTimeoutMs ?? MAX_GENERATION_MS;
      const deadline = Date.now() + generationTimeoutMs;
      const deadlineController = new AbortController();
      const deadlineTimer = setTimeout(
        () => deadlineController.abort(),
        generationTimeoutMs,
      );
      const signal = input.signal
        ? AbortSignal.any([input.signal, deadlineController.signal])
        : deadlineController.signal;
      let toolRounds = 0;
      let turnIndex = input.initialTurnIndex;

      try {
        while (true) {
          assertContextLimit(messages);
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) throw totalTimeoutError();

          let modelCallId: string | null = null;
          let completed: Extract<AiGatewayEvent, { type: "completed" }> | null =
            null;
          const modelTimeoutIsGenerationDeadline =
            remainingMs <= input.requestTimeoutMs;
          try {
            for await (const event of deps.invocationRunner.stream(
              {
                requestId: input.requestId,
                userId: input.userId,
                scenario: "conversation",
                conversationId: input.conversationId,
                generationId: input.generationId,
                timeoutMs: input.requestTimeoutMs,
                generationRemainingMs: remainingMs,
                onStarted: (id) => {
                  modelCallId = id;
                },
              },
              {
                model: input.model,
                messages,
                systemPrompt: input.systemPrompt,
                tools: deps.registry.list().map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                })),
                sessionId: input.sessionId,
                turnIndex,
                signal,
              },
            )) {
              if (event.type === "text_delta") yield event;
              else if (event.type === "completed") completed = event;
            }
          } catch (error) {
            if (
              !input.signal?.aborted &&
              (deadlineController.signal.aborted ||
                (modelTimeoutIsGenerationDeadline &&
                  error instanceof AiGatewayError &&
                  error.kind === "timeout"))
            ) {
              throw totalTimeoutError();
            }
            throw error;
          }

          if (!completed) throw new AiGatewayError("upstream");
          if (completed.stopReason !== "tool_use") {
            yield completed;
            return;
          }

          if (toolRounds >= MAX_TOOL_ROUNDS) throw toolRoundLimitError();
          const calls = completed.assistantMessage.blocks.filter(
            (block): block is AiModelToolCall => block.type === "tool_call",
          );
          if (calls.length === 0) throw new AiGatewayError("upstream");
          assertToolCallMetadata(calls);
          if (calls.length > MAX_TOOL_CALLS_PER_ROUND) {
            throw toolCallLimitError();
          }

          messages.push(toContextAssistantMessage(completed.assistantMessage));
          const roundController = new AbortController();
          const outcomes = await Promise.all(
            calls.map((call) =>
              executeToolCall({
                call,
                modelCallId,
                userId: input.userId,
                requestId: input.requestId,
                generationRemainingMs: Math.max(1, deadline - Date.now()),
                signal,
                roundController,
                deps,
              }),
            ),
          );

          for (const outcome of outcomes) {
            yield outcome.activity;
            messages.push({
              role: "tool_result",
              toolCallId: outcome.activity.toolCallId,
              toolName: outcome.activity.name,
              content: outcome.modelText,
              isError: outcome.isError,
              timestamp: Date.now(),
            });
          }

          if (input.signal?.aborted) throw requestCancelledError();
          if (deadlineController.signal.aborted) throw totalTimeoutError();
          if (outcomes.some((outcome) => outcome.terminal === "timed_out")) {
            throw toolTimeoutError();
          }
          if (outcomes.some((outcome) => outcome.terminal === "cancelled")) {
            throw requestCancelledError();
          }

          toolRounds += 1;
          turnIndex += 1;
        }
      } finally {
        clearTimeout(deadlineTimer);
      }
    },
  };
}

export type AiToolOrchestrator = ReturnType<typeof createAiToolOrchestrator>;

async function executeToolCall(input: {
  call: AiModelToolCall;
  modelCallId: string | null;
  userId: string;
  requestId: string;
  generationRemainingMs: number;
  signal: AbortSignal;
  roundController: AbortController;
  deps: AiToolOrchestratorDeps;
}): Promise<ToolOutcome> {
  const tool = input.deps.registry.find(input.call.name);
  const timeoutMs = resolveToolExecutionTimeout(
    tool?.timeoutMs,
    input.generationRemainingMs,
  );
  const auditHandle = input.deps.audit.beginToolExecution({
    modelCallId: input.modelCallId,
    toolName: input.call.name,
    timeoutMs,
  });
  const finish = (
    status: Exclude<AiToolActivityStatus, "running" | "interrupted">,
    errorCode: AiToolErrorCode | null,
    modelText: string,
    isError: boolean,
    safeSummary: string | null,
    terminal: ToolOutcome["terminal"] = null,
  ): ToolOutcome => {
    input.deps.audit.finalizeToolExecution(auditHandle, status, errorCode);
    logToolResult(input.deps.logger, input, status, errorCode);
    return {
      activity: {
        type: "tool_activity",
        toolCallId: input.call.id,
        name: input.call.name,
        status,
        errorCode,
        safeSummary,
        turnIndex: input.call.turnIndex,
        contentIndex: input.call.contentIndex,
        blockId: input.call.blockId,
      },
      modelText,
      isError,
      terminal,
    };
  };

  if (!tool) {
    return finish(
      "not_found",
      ApiErrorCodes.AI_TOOL_NOT_FOUND,
      "The requested tool is not available.",
      true,
      null,
    );
  }
  if (serializedLength(input.call.arguments) > MAX_TOOL_ARGUMENT_CHARS) {
    return invalidArguments(finish);
  }
  const parsed = tool.inputSchema.safeParse(input.call.arguments);
  if (!parsed.success) return invalidArguments(finish);
  if (input.signal.aborted) {
    return finish(
      "cancelled",
      ApiErrorCodes.AI_TOOL_CANCELLED,
      "The tool was cancelled.",
      true,
      null,
      "cancelled",
    );
  }
  if (
    tool.requiredPermission &&
    !(await safeHasPermission(
      input.deps,
      input.userId,
      tool.requiredPermission,
    ))
  ) {
    return finish(
      "forbidden",
      ApiErrorCodes.AI_TOOL_FORBIDDEN,
      "Permission denied for this tool.",
      true,
      null,
    );
  }

  const timeoutController = new AbortController();
  const deadlineBound =
    input.generationRemainingMs <= (tool?.timeoutMs ?? 5000);
  let timedOut = false;
  const timeout = deadlineBound
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
        input.roundController.abort();
      }, timeoutMs);
  const toolSignal = AbortSignal.any([
    input.signal,
    input.roundController.signal,
    timeoutController.signal,
  ]);

  try {
    const result = await executeWithAbort(
      Promise.resolve().then(() => {
        if (toolSignal.aborted) throw new Error("aborted");
        return tool.execute(
          {
            userId: input.userId,
            requestId: input.requestId,
            signal: toolSignal,
          },
          parsed.data,
        );
      }),
      toolSignal,
    );
    if (
      typeof result.modelText !== "string" ||
      (result.safeSummary !== null && typeof result.safeSummary !== "string") ||
      result.modelText.length > MAX_TOOL_RESULT_CHARS ||
      (result.safeSummary?.length ?? 0) > MAX_SAFE_SUMMARY_CHARS
    ) {
      return finish(
        "failed",
        ApiErrorCodes.AI_TOOL_FAILED,
        "The tool returned an invalid result.",
        true,
        null,
      );
    }
    return finish(
      "succeeded",
      null,
      result.modelText,
      false,
      result.safeSummary,
    );
  } catch {
    if (timedOut) {
      return finish(
        "timed_out",
        ApiErrorCodes.AI_TOOL_TIMED_OUT,
        "The tool timed out.",
        true,
        null,
        "timed_out",
      );
    }
    if (toolSignal.aborted) {
      return finish(
        "cancelled",
        ApiErrorCodes.AI_TOOL_CANCELLED,
        "The tool was cancelled.",
        true,
        null,
        "cancelled",
      );
    }
    return finish(
      "failed",
      ApiErrorCodes.AI_TOOL_FAILED,
      "The tool failed.",
      true,
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function invalidArguments(
  finish: (
    status: "invalid_arguments",
    errorCode: AiToolErrorCode,
    modelText: string,
    isError: true,
    safeSummary: null,
  ) => ToolOutcome,
): ToolOutcome {
  return finish(
    "invalid_arguments",
    ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
    "The tool arguments are invalid.",
    true,
    null,
  );
}

async function safeHasPermission(
  deps: AiToolOrchestratorDeps,
  userId: string,
  permission: Permission,
): Promise<boolean> {
  try {
    return await deps.hasPermission(userId, permission);
  } catch {
    return false;
  }
}

function executeWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function assertToolCallMetadata(calls: AiModelToolCall[]): void {
  for (const call of calls) {
    if (
      call.id.length === 0 ||
      call.id.length > 240 ||
      call.name.length === 0 ||
      call.name.length > 240
    ) {
      throw new AiGatewayError("upstream");
    }
  }
}

function toContextAssistantMessage(
  message: Extract<AiGatewayEvent, { type: "completed" }>["assistantMessage"],
): Extract<AiGatewayEvent, { type: "completed" }>["assistantMessage"] {
  return {
    ...message,
    blocks: message.blocks.map((block) => {
      if (
        block.type !== "tool_call" ||
        serializedLength(block.arguments) <= MAX_TOOL_ARGUMENT_CHARS
      ) {
        return block;
      }
      return {
        ...block,
        arguments: { error: "arguments_too_large" },
      };
    }),
  };
}

function assertContextLimit(messages: AiModelMessage[]): void {
  if (messages.length > MAX_CONTEXT_MESSAGES) {
    throw contextLimitError("messages", MAX_CONTEXT_MESSAGES);
  }
  const chars = messages.reduce((total, message) => {
    if (message.role === "tool_result") return total + message.content.length;
    if (message.role === "user") {
      return (
        total +
        message.content.reduce((sum, block) => sum + block.text.length, 0)
      );
    }
    return (
      total +
      message.blocks.reduce((sum, block) => {
        if (block.type === "text") return sum + block.text.length;
        return sum + serializedLength(block.arguments);
      }, 0)
    );
  }, 0);
  if (chars > MAX_CONTEXT_CHARS) {
    throw contextLimitError("characters", MAX_CONTEXT_CHARS);
  }
}

function logToolResult(
  logger: Logger,
  input: { call: AiModelToolCall; requestId: string },
  status: AiToolActivityStatus,
  errorCode: AiToolErrorCode | null,
): void {
  const payload = {
    event: status === "succeeded" ? "ai.tool.completed" : "ai.tool.failed",
    requestId: input.requestId,
    toolCallId: input.call.id,
    toolName: input.call.name,
    status,
    errorCode,
  };
  if (status === "succeeded") logger.info(payload, "ai tool completed");
  else logger.warn(payload, "ai tool failed");
}

function contextLimitError(limit: string, max: number): AppError {
  return new AppError(
    ApiErrorCodes.AI_CONTEXT_LIMIT,
    "会话上下文超过限制",
    413,
    {
      limit,
      max,
    },
  );
}

function toolCallLimitError(): AppError {
  return new AppError(
    ApiErrorCodes.AI_GENERATION_TOOL_CALL_LIMIT,
    "单轮工具调用数量超过限制",
    409,
  );
}

function toolRoundLimitError(): AppError {
  return new AppError(
    ApiErrorCodes.AI_GENERATION_TOOL_ROUND_LIMIT,
    "工具调用轮数超过限制",
    409,
  );
}

function totalTimeoutError(): AppError {
  return new AppError(
    ApiErrorCodes.AI_GENERATION_TOOL_TOTAL_TIMEOUT,
    "工具调用总时间超过限制",
    504,
  );
}

function toolTimeoutError(): AppError {
  return new AppError(ApiErrorCodes.AI_TOOL_TIMED_OUT, "工具执行超时", 504);
}

function requestCancelledError(): AppError {
  return new AppError(ApiErrorCodes.AI_REQUEST_ABORTED, "模型请求已取消", 409);
}
