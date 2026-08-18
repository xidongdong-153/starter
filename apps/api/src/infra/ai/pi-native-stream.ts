import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
  Usage,
} from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  ModelsError,
} from "@earendil-works/pi-ai";
import type {
  AiCost,
  AiModelCallResult,
  AiModelCallStopReason,
  AiModelRef,
  AiUsage,
  ApiErrorCode,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";

export interface PiModelCallAudit {
  beginModelCall: (input: {
    id?: string;
    runId: string;
    userId: string;
    requestId: string;
    model: AiModelRef;
    timeoutMs: number;
    startedAt: Date;
  }) => string | null;
  finalizeModelCall: (input: {
    id: string;
    requestId: string;
    startedAt: Date;
    finishedAt: Date;
    result: Exclude<AiModelCallResult, "running">;
    stopReason: AiModelCallStopReason | null;
    errorCode: string | null;
    usage: AiUsage;
    cost: AiCost | null;
  }) => void;
}

export interface PiNativeStreamOptions {
  models: Models;
  timeoutMs: number;
  getProviderRequestEnv?: (providerId: string) => Record<string, string>;
  audit?: PiModelCallAudit;
  runId: string;
  userId: string;
  requestId: string;
  sessionId?: string;
  onModelCallStarted?: (id: string | null) => void;
  onFailure?: (failure: PiStreamFailure) => void;
}

export interface PiStreamFailure {
  kind: "auth" | "timeout" | "aborted" | "upstream" | "model_not_found";
  errorCode: ApiErrorCode;
}

export function createPiNativeStreamFn(
  options: PiNativeStreamOptions,
): (
  model: Model<Api>,
  context: Context,
  streamOptions?: SimpleStreamOptions,
) => AssistantMessageEventStream {
  return (model, context, streamOptions = {}) => {
    const result = createAssistantMessageEventStream();
    void pumpStream(result, model, context, streamOptions, options);
    return result;
  };
}

export const createNativePiStreamFn = createPiNativeStreamFn;

async function pumpStream(
  result: AssistantMessageEventStream,
  model: Model<Api>,
  context: Context,
  streamOptions: SimpleStreamOptions,
  options: PiNativeStreamOptions,
): Promise<void> {
  const modelLookup = options.models.getModel;
  const listedModel =
    typeof modelLookup === "function"
      ? modelLookup.call(options.models, model.provider, model.id)
      : model;
  if (!listedModel) {
    const failure = streamFailure("model_not_found");
    result.push({
      type: "error",
      reason: "error",
      error: errorMessage(model, "model_not_found"),
    });
    try {
      options.onFailure?.(failure);
    } catch {
      // 失败回调不能阻止 StreamFn 结束。
    }
    return;
  }
  model = listedModel;

  const timeoutMs = Math.max(
    1,
    Math.min(streamOptions.timeoutMs ?? options.timeoutMs, options.timeoutMs),
  );
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const cause: { kind: PiStreamFailure["kind"] | null } = {
    kind: streamOptions.signal?.aborted ? "aborted" : null,
  };
  const onInputAbort = () => {
    cause.kind ??= "aborted";
  };
  const onTimeout = () => {
    cause.kind ??= "timeout";
  };
  streamOptions.signal?.addEventListener("abort", onInputAbort, { once: true });
  timeoutController.signal.addEventListener("abort", onTimeout, { once: true });
  const signal = AbortSignal.any(
    streamOptions.signal
      ? [streamOptions.signal, timeoutController.signal]
      : [timeoutController.signal],
  );
  const startedAt = new Date();
  let modelCallId: string | null = null;
  let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
  let finalized = false;

  const finalize = (
    resultValue: Exclude<AiModelCallResult, "running">,
    stopReason: AiModelCallStopReason | null,
    errorCode: string | null,
    usage: AiUsage,
    cost: AiCost | null,
  ) => {
    if (finalized) return;
    finalized = true;
    if (modelCallId) {
      try {
        options.audit?.finalizeModelCall({
          id: modelCallId,
          requestId: options.requestId,
          startedAt,
          finishedAt: new Date(),
          result: resultValue,
          stopReason,
          errorCode,
          usage,
          cost,
        });
      } catch {
        // 审计是 best-effort，不能阻断模型事件流。
      }
    }
  };

  try {
    try {
      modelCallId =
        options.audit?.beginModelCall({
          runId: options.runId,
          userId: options.userId,
          requestId: options.requestId,
          model: { providerId: model.provider, modelId: model.id },
          timeoutMs,
          startedAt,
        }) ?? null;
    } catch {
      modelCallId = null;
    }
    try {
      options.onModelCallStarted?.(modelCallId);
    } catch {
      // 观察回调不能改变 StreamFn 的行为。
    }

    const env = options.getProviderRequestEnv?.(model.provider) ?? {};
    const auth = await options.models.getAuth(model, {
      env,
      signal,
      ...(streamOptions.apiKey ? { apiKey: streamOptions.apiKey } : {}),
    });
    if (signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    if (!auth) {
      const failure = streamFailure("auth");
      const message = errorMessage(model, "auth");
      result.push({ type: "error", reason: "error", error: message });
      finalize("auth_failed", "error", failure.errorCode, emptyUsage(), null);
      options.onFailure?.(failure);
      return;
    }

    const upstream = options.models.streamSimple(model, context, {
      ...streamOptions,
      env,
      signal,
      timeoutMs,
      maxRetries: 0,
      maxTokens: Math.min(model.maxTokens, 2048),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    });
    let terminal = false;
    iterator = upstream[Symbol.asyncIterator]();
    while (true) {
      const next = await nextWithSignal(iterator, signal);
      if (next.done) break;
      const event = next.value;
      if (event.type === "done") {
        if (cause.kind === "aborted" || cause.kind === "timeout") {
          const failure = streamFailure(cause.kind);
          result.push({
            type: "error",
            reason: "aborted",
            error: sanitizeErrorMessage(event.message, model, failure.kind),
          });
          finalize(
            cause.kind === "timeout" ? "timed_out" : "cancelled",
            "aborted",
            failure.errorCode,
            toUsage(event.message.usage),
            toCost(event.message.usage),
          );
          options.onFailure?.(failure);
        } else if (event.reason === "deferred") {
          const failure = streamFailure("upstream");
          const message = errorMessage(model, "upstream");
          result.push({ type: "error", reason: "error", error: message });
          finalize(
            "upstream_failed",
            "deferred",
            failure.errorCode,
            toUsage(event.message.usage),
            toCost(event.message.usage),
          );
          options.onFailure?.(failure);
        } else {
          result.push({
            type: "done",
            reason: event.reason,
            message: sanitizeAssistantMessage(event.message),
          });
          finalize(
            "succeeded",
            normalizeStopReason(event.reason),
            null,
            toUsage(event.message.usage),
            toCost(event.message.usage),
          );
        }
        terminal = true;
        return;
      }
      if (event.type === "error") {
        const failure = streamFailure(
          cause.kind ?? (event.reason === "aborted" ? "aborted" : "upstream"),
        );
        result.push({
          type: "error",
          reason:
            failure.kind === "aborted" || failure.kind === "timeout"
              ? "aborted"
              : "error",
          error: sanitizeErrorMessage(event.error, model, failure.kind),
        });
        finalize(
          failure.kind === "timeout"
            ? "timed_out"
            : failure.kind === "aborted"
              ? "cancelled"
              : "upstream_failed",
          failure.kind === "timeout" || failure.kind === "aborted"
            ? "aborted"
            : "error",
          failure.errorCode,
          toUsage(event.error.usage),
          toCost(event.error.usage),
        );
        options.onFailure?.(failure);
        terminal = true;
        return;
      }
      result.push(sanitizeEvent(event));
    }

    if (!terminal) {
      const failure = streamFailure(cause.kind ?? "upstream");
      result.push({
        type: "error",
        reason:
          failure.kind === "aborted" || failure.kind === "timeout"
            ? "aborted"
            : "error",
        error: errorMessage(model, failure.kind),
      });
      finalize(
        failure.kind === "timeout"
          ? "timed_out"
          : failure.kind === "aborted"
            ? "cancelled"
            : "upstream_failed",
        failure.kind === "timeout" || failure.kind === "aborted"
          ? "aborted"
          : "error",
        failure.errorCode,
        emptyUsage(),
        null,
      );
      options.onFailure?.(failure);
    }
  } catch (error) {
    const failure = classifyFailure(error, cause.kind, signal);
    const message = errorMessage(model, failure.kind);
    result.push({
      type: "error",
      reason:
        failure.kind === "aborted" || failure.kind === "timeout"
          ? "aborted"
          : "error",
      error: message,
    });
    finalize(
      failure.kind === "timeout"
        ? "timed_out"
        : failure.kind === "aborted"
          ? "cancelled"
          : failure.kind === "auth"
            ? "auth_failed"
            : "upstream_failed",
      failure.kind === "timeout" || failure.kind === "aborted"
        ? "aborted"
        : "error",
      failure.errorCode,
      emptyUsage(),
      null,
    );
    options.onFailure?.(failure);
  } finally {
    if (typeof iterator?.return === "function") {
      try {
        await iterator.return();
      } catch {
        // 取消时尽力关闭 Provider iterator，保留原始终态。
      }
    }
    clearTimeout(timeout);
    streamOptions.signal?.removeEventListener("abort", onInputAbort);
    timeoutController.signal.removeEventListener("abort", onTimeout);
  }
}

function sanitizeEvent(
  event: Exclude<AssistantMessageEvent, { type: "done" | "error" }>,
): Exclude<AssistantMessageEvent, { type: "done" | "error" }> {
  if (event.type === "start") {
    return { type: "start", partial: sanitizeAssistantMessage(event.partial) };
  }
  if (event.type === "toolcall_end") {
    return {
      ...event,
      partial: sanitizeAssistantMessage(event.partial),
      toolCall: {
        type: "toolCall",
        id: event.toolCall.id,
        name: event.toolCall.name,
        arguments: event.toolCall.arguments,
      },
    };
  }
  return {
    ...event,
    partial: sanitizeAssistantMessage(event.partial),
  } as typeof event;
}

function sanitizeErrorMessage(
  message: AssistantMessage,
  model: Model<Api>,
  kind: PiStreamFailure["kind"],
): AssistantMessage {
  return {
    ...sanitizeAssistantMessage(message),
    stopReason: kind === "aborted" || kind === "timeout" ? "aborted" : "error",
    errorMessage: errorMessage(model, kind).errorMessage,
  };
}

function sanitizeAssistantMessage(message: AssistantMessage): AssistantMessage {
  return {
    role: "assistant",
    content: message.content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "thinking")
        return { type: "thinking", thinking: block.thinking };
      return {
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments: block.arguments,
      };
    }),
    api: message.api,
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    stopReason: message.stopReason,
    timestamp: message.timestamp,
    ...(message.errorMessage ? { errorMessage: "模型请求失败" } : {}),
  };
}

function errorMessage(
  model: Model<Api>,
  kind: PiStreamFailure["kind"] | "model_not_found",
): AssistantMessage {
  const reason =
    kind === "auth"
      ? "Provider 认证失败"
      : kind === "timeout"
        ? "模型请求超时"
        : kind === "aborted"
          ? "模型请求已取消"
          : kind === "model_not_found"
            ? "模型不存在"
            : "模型请求失败";
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyPiUsage(),
    stopReason: kind === "aborted" || kind === "timeout" ? "aborted" : "error",
    errorMessage: reason,
    timestamp: Date.now(),
  };
}

function streamFailure(kind: PiStreamFailure["kind"]): PiStreamFailure {
  return {
    kind,
    errorCode:
      kind === "auth"
        ? ApiErrorCodes.AI_PROVIDER_AUTH_FAILED
        : kind === "timeout"
          ? ApiErrorCodes.AI_UPSTREAM_TIMEOUT
          : kind === "aborted"
            ? ApiErrorCodes.AI_REQUEST_ABORTED
            : kind === "model_not_found"
              ? ApiErrorCodes.AI_MODEL_NOT_FOUND
              : ApiErrorCodes.AI_UPSTREAM_ERROR,
  };
}

function classifyFailure(
  error: unknown,
  cause: PiStreamFailure["kind"] | null,
  signal: AbortSignal,
): PiStreamFailure {
  if (cause === "timeout") return streamFailure("timeout");
  if (cause === "aborted" || signal.aborted) return streamFailure("aborted");
  if (
    error instanceof ModelsError &&
    (error.code === "auth" || error.code === "oauth")
  ) {
    return streamFailure("auth");
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return streamFailure("aborted");
  }
  return streamFailure("upstream");
}

async function nextWithSignal<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(new DOMException("The operation was aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function normalizeStopReason(
  reason: Extract<AssistantMessageEvent, { type: "done" }>["reason"],
): "stop" | "length" | "tool_use" | "deferred" {
  if (reason === "length") return "length";
  if (reason === "toolUse") return "tool_use";
  if (reason === "deferred") return "deferred";
  return "stop";
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

function toCost(usage: Usage): AiCost | null {
  const input = numberOrNull(usage.cost?.input);
  const output = numberOrNull(usage.cost?.output);
  const cacheRead = numberOrNull(usage.cost?.cacheRead);
  const cacheWrite = numberOrNull(usage.cost?.cacheWrite);
  const total = numberOrNull(usage.cost?.total);
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

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function emptyUsage(): AiUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  };
}

function emptyPiUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
