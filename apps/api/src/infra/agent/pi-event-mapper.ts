import type {
  AgentEvent,
  AgentMessage,
  Entry,
} from "@earendil-works/pi-agent-core";
import type { ApiErrorCode, HarnessEvent } from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";

import type { AgentSessionHandle } from "./pi-session-store.js";
import { generateId } from "@api/shared/id.js";
import type { PiToolResultDetails } from "./pi-tool-adapter.js";

export interface EventSequencer {
  next: () => number;
}

export function createEventSequencer(start = 0): EventSequencer {
  let sequence = start;
  return {
    next() {
      sequence += 1;
      return sequence;
    },
  };
}

export interface PiEventMapperOptions {
  session: AgentSessionHandle;
  sessionId: string;
  runId: string;
  lane: string;
  sequencer: EventSequencer;
  getAssistantErrorCode?: () => ApiErrorCode | null;
  onEntryAppended?: (entry: Entry) => void;
  onToolExecutionStart?: (input: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    signal?: AbortSignal;
  }) => void | Promise<void>;
  onToolExecutionEnd?: (input: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }) => PiToolResultDetails | null;
}

interface PendingToolExecution {
  toolCallId: string;
  name: string;
  result: PiToolResultDetails | null;
  isError: boolean;
}

export class PiEventMapper {
  private readonly pendingMessageIds = new WeakMap<object, string>();
  private readonly pendingTools = new Map<string, PendingToolExecution>();
  private activeAssistant: { id: string } | undefined;
  private _lastAssistantEntryId: string | null = null;
  private _lastAssistantMessage: AgentMessage | undefined;

  constructor(private readonly options: PiEventMapperOptions) {}

  get lastAssistantEntryId(): string | null {
    return this._lastAssistantEntryId;
  }

  get lastAssistantMessage(): AgentMessage | undefined {
    return this._lastAssistantMessage;
  }

  async map(
    event: AgentEvent,
    signal?: AbortSignal,
  ): Promise<readonly HarnessEvent[]> {
    switch (event.type) {
      case "message_start":
        return this.mapMessageStart(event.message);
      case "message_update":
        return this.mapMessageUpdate(
          event.message,
          event.assistantMessageEvent,
        );
      case "message_end":
        return this.mapMessageEnd(event.message);
      case "tool_execution_start":
        await this.options.onToolExecutionStart?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          signal,
        });
        return [
          this.event("tool.started", {
            toolCallId: event.toolCallId,
            name: event.toolName,
          }),
        ];
      case "tool_execution_update":
        return [
          this.event("tool.progress", {
            toolCallId: event.toolCallId,
            name: event.toolName,
            safeSummary: readSafeSummary(event.partialResult),
          }),
        ];
      case "tool_execution_end":
        this.pendingTools.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          name: event.toolName,
          result:
            this.options.onToolExecutionEnd?.({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: event.result,
              isError: event.isError,
            }) ?? readToolDetails(event.result),
          isError: event.isError,
        });
        return [];
      case "agent_start":
      case "agent_end":
      case "turn_start":
      case "turn_end":
        return [];
    }
  }

  private mapMessageStart(message: AgentMessage): readonly HarnessEvent[] {
    if (message.role === "assistant") {
      const messageId = generateEntryId();
      this.activeAssistant = { id: messageId };
      return [
        this.event("message.started", {
          messageId,
          role: "assistant",
        }),
      ];
    }

    this.pendingMessageIds.set(message, generateEntryId());
    return [];
  }

  private mapMessageUpdate(
    message: AgentMessage,
    assistantMessageEvent: Extract<
      AgentEvent,
      { type: "message_update" }
    >["assistantMessageEvent"],
  ): readonly HarnessEvent[] {
    if (
      message.role !== "assistant" ||
      assistantMessageEvent.type !== "text_delta"
    ) {
      return [];
    }
    const messageId = this.activeAssistant?.id;
    if (!messageId) return [];
    return [
      this.event("message.delta", {
        messageId,
        delta: assistantMessageEvent.delta,
      }),
    ];
  }

  private async mapMessageEnd(
    message: AgentMessage,
  ): Promise<readonly HarnessEvent[]> {
    if (message.role === "assistant") {
      const messageId = this.activeAssistant?.id ?? generateEntryId();
      const entry = await this.options.session.appendMessage(
        this.options.lane,
        message,
        messageId,
      );
      this.options.onEntryAppended?.(entry);
      this.activeAssistant = undefined;
      this._lastAssistantEntryId = entry.id;
      this._lastAssistantMessage = message;
      return [
        this.event("message.completed", {
          messageId: entry.id,
          role: "assistant",
          content: assistantText(message),
          stopReason: toHarnessStopReason(message),
          errorCode: this.assistantErrorCode(message),
        }),
      ];
    }

    const pending =
      message.role === "toolResult"
        ? this.pendingTools.get(message.toolCallId)
        : undefined;
    const persistedMessage =
      message.role === "toolResult"
        ? sanitizeToolResultMessage(message, pending?.result)
        : message;
    const entryId = this.pendingMessageIds.get(message) ?? generateEntryId();
    this.pendingMessageIds.delete(message);
    const entry = await this.options.session.appendMessage(
      this.options.lane,
      persistedMessage,
      entryId,
    );
    this.options.onEntryAppended?.(entry);
    if (message.role !== "toolResult") return [];

    const persistedToolResult = persistedMessage as Extract<
      AgentMessage,
      { role: "toolResult" }
    >;
    const pendingTool = this.pendingTools.get(message.toolCallId);
    this.pendingTools.delete(message.toolCallId);
    const details =
      pendingTool?.result ?? readToolDetails(persistedToolResult.details);
    const status =
      details?.status ??
      (pendingTool?.isError || message.isError ? "failed" : "succeeded");
    const errorCode =
      details?.errorCode ??
      (status === "succeeded" ? null : ApiErrorCodes.AI_TOOL_FAILED);
    return [
      this.event("tool.completed", {
        toolCallId: message.toolCallId,
        name: message.toolName,
        status,
        errorCode,
        safeSummary: details?.safeSummary ?? null,
        entryId: entry.id,
      }),
    ];
  }

  private assistantErrorCode(message: AgentMessage): ApiErrorCode | null {
    if (message.role !== "assistant") return null;
    if (message.stopReason !== "error" && message.stopReason !== "aborted") {
      return null;
    }
    return (
      this.options.getAssistantErrorCode?.() ??
      (message.stopReason === "aborted"
        ? ApiErrorCodes.AI_REQUEST_ABORTED
        : ApiErrorCodes.AI_UPSTREAM_ERROR)
    );
  }

  private event<T extends HarnessEvent["type"]>(
    type: T,
    data: Extract<HarnessEvent, { type: T }>["data"],
  ): Extract<HarnessEvent, { type: T }> {
    return {
      version: 1,
      eventId: generateEntryId(),
      sequence: this.options.sequencer.next(),
      sessionId: this.options.sessionId,
      runId: this.options.runId,
      lane: this.options.lane,
      createdAt: new Date().toISOString(),
      type,
      data,
    } as Extract<HarnessEvent, { type: T }>;
  }
}

export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;
  private failure: unknown;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined });
    }
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.failure = error;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({
            done: false,
            value: this.values.shift() as T,
          });
        }
        if (this.closed) {
          if (this.failure) return Promise.reject(this.failure);
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

function readToolDetails(value: unknown): PiToolResultDetails | null {
  if (!isRecord(value)) return null;
  const details = isRecord(value.details) ? value.details : value;
  const status = details.status;
  if (
    status !== "succeeded" &&
    status !== "not_found" &&
    status !== "invalid_arguments" &&
    status !== "forbidden" &&
    status !== "failed" &&
    status !== "timed_out" &&
    status !== "cancelled" &&
    status !== "interrupted"
  ) {
    return null;
  }
  return {
    status,
    errorCode: readErrorCode(details.errorCode),
    safeSummary: readSafeSummary(value),
    modelText: typeof details.modelText === "string" ? details.modelText : "",
    terminate: value.terminate === true || details.terminate === true,
  };
}

function readSafeSummary(value: unknown): string | null {
  if (isRecord(value)) {
    const direct = value.safeSummary;
    const nested = isRecord(value.details) ? value.details.safeSummary : null;
    value = direct ?? nested;
  }
  return typeof value === "string" ? value.slice(0, 1000) : null;
}

function readErrorCode(value: unknown): ApiErrorCode | null {
  if (typeof value !== "string") return null;
  return Object.values(ApiErrorCodes).includes(value as ApiErrorCode)
    ? (value as ApiErrorCode)
    : null;
}

function sanitizeToolResultMessage(
  message: Extract<AgentMessage, { role: "toolResult" }>,
  overrideDetails: PiToolResultDetails | null | undefined = undefined,
): Extract<AgentMessage, { role: "toolResult" }> {
  const details = overrideDetails ?? readToolDetails(message.details);
  const safeDetails =
    details ??
    (message.isError
      ? {
          status: "failed" as const,
          errorCode: ApiErrorCodes.AI_TOOL_FAILED,
          safeSummary: null,
          modelText: "The tool failed.",
          terminate: false,
        }
      : message.details);
  return {
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content:
      message.isError && safeDetails
        ? [{ type: "text", text: safeDetails.modelText }]
        : message.content,
    ...(safeDetails === undefined ? {} : { details: safeDetails }),
    ...(message.usage === undefined ? {} : { usage: message.usage }),
    ...(message.addedToolNames === undefined
      ? {}
      : { addedToolNames: message.addedToolNames }),
    isError: message.isError,
    timestamp: message.timestamp,
  };
}
function assistantText(
  message: Extract<AgentMessage, { role: "assistant" }>,
): string {
  return message.content
    .filter(
      (block): block is Extract<typeof block, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

function toHarnessStopReason(
  message: Extract<AgentMessage, { role: "assistant" }>,
): "stop" | "length" | "tool_use" | null {
  if (message.stopReason === "stop") return "stop";
  if (message.stopReason === "length") return "length";
  if (message.stopReason === "toolUse") return "tool_use";
  return null;
}

function generateEntryId(): string {
  return generateId();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
