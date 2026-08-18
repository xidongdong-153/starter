import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
  AgentTranscriptItem,
  AgentToolStatus,
  ApiErrorCode,
} from "@starter/contracts";
import { ApiErrorCodes, uuidSchema } from "@starter/contracts";

import type { AiAgentSessionRecord } from "./session.repository.js";

type AssistantItem = Extract<
  AgentTranscriptItem,
  { type: "assistant_message" }
>;
type UserItem = Extract<AgentTranscriptItem, { type: "user_message" }>;

export function toAgentSession(record: AiAgentSessionRecord): {
  id: string;
  title: string;
  defaultAgentId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: record.id,
    title: record.title,
    defaultAgentId: record.defaultAgentId,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export interface SkippedTranscriptEntry {
  entryType: string;
  entryId: string;
  reason: string;
}

/**
 * 把 Pi 的中性 entry 投影为共享契约的 transcript item。
 *
 * 规则：
 * - `message` entry 按 role 分派为 user / assistant / tool activity。
 * - `compaction` entry 投影为 system item（runId 固定为 null）。
 * - `starter.run.v1`（custom）及其它 Pi 内部 entry 过滤，不投影，并回调 onSkipped。
 * - runId 读取顺序：`message.runId`（UUID 校验）优先，其次 `message.details.runId`；
 *   两者都缺失时不投影该 item，避免编造 Run 归属。
 */
export function projectTranscript(
  entries: readonly Entry[],
  lane: string,
  onSkipped: (info: SkippedTranscriptEntry) => void,
): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = [];
  for (const entry of entries) {
    const item = projectEntry(entry, lane, onSkipped);
    if (item) items.push(item);
  }
  return items;
}

function projectEntry(
  entry: Entry,
  lane: string,
  onSkipped: (info: SkippedTranscriptEntry) => void,
): AgentTranscriptItem | null {
  if (entry.type === "message") {
    return projectMessage(entry, lane, onSkipped);
  }
  if (entry.type === "compaction") {
    return {
      type: "system",
      id: entry.id,
      sequence: entry.seq,
      lane,
      runId: null,
      createdAt: new Date(entry.timestamp).toISOString(),
      kind: "compaction",
      summary: entry.summary,
    };
  }
  onSkipped({
    entryType: entry.type,
    entryId: entry.id,
    reason: "unknown_entry_type",
  });
  return null;
}

function projectMessage(
  entry: Extract<Entry, { type: "message" }>,
  lane: string,
  onSkipped: (info: SkippedTranscriptEntry) => void,
): AgentTranscriptItem | null {
  const message = entry.message;

  if (message.role === "user") {
    const runId = resolveRunId(message);
    if (!runId) return skipMessage(entry, onSkipped, "missing_run_id");
    const item: UserItem = {
      type: "user_message",
      id: entry.id,
      sequence: entry.seq,
      lane,
      runId,
      createdAt: new Date(entry.timestamp).toISOString(),
      content: userContentToString(message.content),
    };
    return item;
  }

  if (message.role === "assistant") {
    const runId = resolveRunId(message);
    if (!runId) return skipMessage(entry, onSkipped, "missing_run_id");
    const status = assistantStatus(message);
    if (!status) {
      return skipMessage(entry, onSkipped, "unprojectable_assistant_status");
    }
    const item: AssistantItem = {
      type: "assistant_message",
      id: entry.id,
      sequence: entry.seq,
      lane,
      runId,
      createdAt: new Date(entry.timestamp).toISOString(),
      content: assistantContentToString(message.content),
      status,
      model: { providerId: message.provider, modelId: message.model },
      stopReason: assistantStopReason(message.stopReason),
      errorCode: assistantErrorCode(message.stopReason),
    };
    return item;
  }

  if (message.role === "toolResult") {
    const runId = resolveRunId(message);
    if (!runId) return skipMessage(entry, onSkipped, "missing_run_id");
    const details = readToolDetails(message.details);
    const status =
      details?.status ?? (message.isError ? "failed" : "succeeded");
    const errorCode =
      details?.errorCode ??
      (status === "succeeded" ? null : ApiErrorCodes.AI_TOOL_FAILED);
    const item = {
      type: "tool_activity" as const,
      id: entry.id,
      sequence: entry.seq,
      lane,
      runId,
      createdAt: new Date(entry.timestamp).toISOString(),
      toolCallId: message.toolCallId,
      name: message.toolName,
      status,
      errorCode,
      safeSummary: details?.safeSummary ?? null,
    };
    return item;
  }

  onSkipped({
    entryType: entry.type,
    entryId: entry.id,
    reason: "unknown_message_role",
  });
  return null;
}

function skipMessage(
  entry: Extract<Entry, { type: "message" }>,
  onSkipped: (info: SkippedTranscriptEntry) => void,
  reason: string,
): null {
  onSkipped({
    entryType: entry.type,
    entryId: entry.id,
    reason,
  });
  return null;
}

function resolveRunId(message: AgentMessage): string | null {
  const direct = readUuid((message as { runId?: unknown }).runId);
  if (direct) return direct;
  const nested = (message as { details?: unknown }).details;
  if (isRecord(nested)) {
    const fromDetails = readUuid(nested.runId);
    if (fromDetails) return fromDetails;
  }
  return null;
}

function readUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return uuidSchema.safeParse(value).success ? value : null;
}

function userContentToString(
  content: string | (TextContent | ImageContent)[],
): string {
  if (typeof content === "string") return content;
  return textBlocks(
    content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    ),
  );
}

function assistantContentToString(
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
): string {
  return textBlocks(
    content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    ),
  );
}

function textBlocks(blocks: { text: string }[]): string {
  return blocks.map((block) => block.text).join("");
}

function assistantStatus(
  message: Extract<AgentMessage, { role: "assistant" }>,
): AssistantItem["status"] | null {
  const stopReason = message.stopReason;
  if (stopReason === "aborted") return "aborted";
  if (stopReason === "error") return "failed";
  if (
    stopReason === "stop" ||
    stopReason === "length" ||
    stopReason === "toolUse"
  ) {
    return "completed";
  }
  // pending / deferred / undefined 无法映射为终态，视为不可投影
  return null;
}

function assistantStopReason(
  stopReason: Extract<AgentMessage, { role: "assistant" }>["stopReason"],
): AssistantItem["stopReason"] {
  if (stopReason === "stop") return "stop";
  if (stopReason === "length") return "length";
  if (stopReason === "toolUse") return "tool_use";
  return null;
}

function assistantErrorCode(
  stopReason: Extract<AgentMessage, { role: "assistant" }>["stopReason"],
): ApiErrorCode | null {
  if (stopReason === "aborted") return ApiErrorCodes.AI_REQUEST_ABORTED;
  if (stopReason === "error") return ApiErrorCodes.AI_UPSTREAM_ERROR;
  return null;
}

function readToolDetails(value: unknown): {
  status: AgentToolStatus;
  errorCode: ApiErrorCode | null;
  safeSummary: string | null;
} | null {
  if (!isRecord(value)) return null;
  const details = isRecord(value.details) ? value.details : value;
  const status = details.status;
  if (!isToolStatus(status)) return null;
  return {
    status,
    errorCode: readApiErrorCode(details.errorCode),
    safeSummary:
      typeof details.safeSummary === "string"
        ? details.safeSummary.slice(0, 1000)
        : null,
  };
}

function isToolStatus(value: unknown): value is AgentToolStatus {
  return (
    value === "succeeded" ||
    value === "not_found" ||
    value === "invalid_arguments" ||
    value === "forbidden" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}

function readApiErrorCode(value: unknown): ApiErrorCode | null {
  if (typeof value !== "string") return null;
  return Object.values(ApiErrorCodes).includes(value as ApiErrorCode)
    ? (value as ApiErrorCode)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
