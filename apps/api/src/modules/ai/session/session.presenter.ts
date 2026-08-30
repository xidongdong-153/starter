import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
  AgentTranscriptItem,
  AgentToolStatus,
  AiAttachmentMimeType,
  AiOutputContractRef,
  AiStructuredOutputValue,
  AiUsage,
  ApiErrorCode,
} from "@starter/contracts";
import {
  ApiErrorCodes,
  aiAttachmentMimeTypeSchema,
  uuidSchema,
} from "@starter/contracts";

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

/** transcript tool_activity 注入的结构化输出：contract ref + 按可见性打码后的 value。 */
export interface TranscriptStructuredOutput {
  contract: AiOutputContractRef;
  value: AiStructuredOutputValue | null;
}

/**
 * 把 Pi 的中性 entry 投影为共享契约的 transcript item。
 *
 * 规则：
 * - `message` entry 按 role 分派为 user / assistant / tool activity。
 * - `compaction` entry 投影为 system item（runId 固定为 null）。
 * - `starter.run`（custom）是系统写入的 Run 终态记录，直接过滤，不回调 onSkipped。
 * - 其它识别不了的 entry 过滤后回调 onSkipped，由调用方记录 WARN。
 * - runId 读取顺序：`message.runId`（UUID 校验）优先，其次 `message.details.runId`；
 *   两者都缺失时不投影该 item，避免编造 Run 归属。
 * - `structuredOutputs` 是 toolResult entry 引用的结构化输出（key 是 referenceId）；
 *   details 带 structuredOutputId 且 Map 中存在时注入 `structuredOutput` 字段。
 */
export function projectTranscript(
  entries: readonly Entry[],
  lane: string,
  onSkipped: (info: SkippedTranscriptEntry) => void,
  structuredOutputs?: ReadonlyMap<string, TranscriptStructuredOutput>,
): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = [];
  for (const entry of entries) {
    const item = projectEntry(entry, lane, onSkipped, structuredOutputs);
    if (item) items.push(item);
  }
  return items;
}

/**
 * 收集本页 toolResult entry 引用的 structuredOutputId（UUID 校验 + 去重），
 * 供 session service 批量取回结构化输出。解析路径与 readToolDetails 一致。
 */
export function collectStructuredOutputIds(
  entries: readonly Entry[],
): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "toolResult") continue;
    const id = readToolDetails(entry.message.details)?.structuredOutputId;
    if (id) ids.add(id);
  }
  return [...ids];
}

function projectEntry(
  entry: Entry,
  lane: string,
  onSkipped: (info: SkippedTranscriptEntry) => void,
  structuredOutputs?: ReadonlyMap<string, TranscriptStructuredOutput>,
): AgentTranscriptItem | null {
  if (entry.type === "message") {
    return projectMessage(entry, lane, onSkipped, structuredOutputs);
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
      tokensBefore: readTokensBefore(entry.tokensBefore),
    };
  }
  if (entry.type === "custom" && entry.customType === "starter.run") {
    return null;
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
  structuredOutputs?: ReadonlyMap<string, TranscriptStructuredOutput>,
): AgentTranscriptItem | null {
  const message = entry.message;

  if (message.role === "user") {
    const runId = resolveRunId(message);
    if (!runId) return skipMessage(entry, onSkipped, "missing_run_id");
    const images = userMessageImages(message);
    const item: UserItem = {
      type: "user_message",
      id: entry.id,
      sequence: entry.seq,
      lane,
      runId,
      createdAt: new Date(entry.timestamp).toISOString(),
      content: userContentToString(message.content),
      ...(images ? { images } : {}),
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
      blocks: assistantBlocks(message.content),
      status,
      model: { providerId: message.provider, modelId: message.model },
      stopReason: assistantStopReason(message.stopReason),
      errorCode: assistantErrorCode(message.stopReason),
      usage: readAssistantUsage(message.usage),
      toolCalls: assistantToolCalls(message.content),
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
    const structuredOutputId = details?.structuredOutputId ?? null;
    const structuredOutput = structuredOutputId
      ? structuredOutputs?.get(structuredOutputId)
      : undefined;
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
      ...(structuredOutput && structuredOutputId
        ? {
            structuredOutput: {
              ...structuredOutput,
              referenceId: structuredOutputId,
            },
          }
        : {}),
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

/**
 * 从 Pi message 读取挂载的 runId（顶层字段优先，details 兼容旧 entry）。
 * Run Service 写入侧与 transcript 投影共用同一读取规则。
 */
export function resolveRunId(message: AgentMessage): string | null {
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

/** 附件内容下载端点的路由前缀；与 attachment.route.ts 的挂载路径一致。 */
const ATTACHMENT_CONTENT_URL_PREFIX = "/api/ai/attachments";

/**
 * 从 user message 顶层 attachmentIds 与 content 的 image 块产出附件引用。
 * image 块本身没有附件 id，attachmentId 按顶层 attachmentIds 的顺序对位；
 * 数量不一致时以 attachmentIds 为准截断（防御，写入侧保证一致）。
 * base64 数据不出 API 边界，前端用 url 下载字节。
 * 无附件的纯文本消息返回 undefined，不输出 images 字段。
 */
function userMessageImages(
  message: Extract<AgentMessage, { role: "user" }>,
): NonNullable<UserItem["images"]> | undefined {
  const attachmentIds = readAttachmentIds(message);
  if (attachmentIds.length === 0) return undefined;
  if (typeof message.content === "string") return undefined;
  const imageBlocks = message.content.filter(
    (block): block is ImageContent => block.type === "image",
  );
  if (imageBlocks.length === 0) return undefined;
  const count = Math.min(attachmentIds.length, imageBlocks.length);
  const images: NonNullable<UserItem["images"]> = [];
  for (let index = 0; index < count; index += 1) {
    const attachmentId = attachmentIds[index];
    const mimeType = imageBlocks[index]?.mimeType;
    if (!attachmentId) continue;
    if (!isAttachmentMimeType(mimeType)) continue;
    images.push({
      attachmentId,
      mimeType,
      url: `${ATTACHMENT_CONTENT_URL_PREFIX}/${attachmentId}/content`,
    });
  }
  return images.length > 0 ? images : undefined;
}

/** 读 message 顶层挂载的 attachmentIds（逐项 UUID 校验）；缺失或全非法时返回空数组。 */
function readAttachmentIds(message: AgentMessage): string[] {
  const value = (message as { attachmentIds?: unknown }).attachmentIds;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (id): id is string =>
      typeof id === "string" && uuidSchema.safeParse(id).success,
  );
}

function isAttachmentMimeType(value: unknown): value is AiAttachmentMimeType {
  return aiAttachmentMimeTypeSchema.safeParse(value).success;
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

/**
 * 拼接 assistant message 的 text 块；thinking / toolCall 块不进正文。
 */
export function assistantContentToString(
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
): string {
  return textBlocks(
    content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    ),
  );
}

/**
 * 按 `message.content` 的原始顺序投影 text 与 thinking 块，供前端按原顺序渲染。
 * toolCall 块不进这里，只走 `toolCalls`（只有 id 和名称，不带 arguments）。
 */
function assistantBlocks(
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
): AssistantItem["blocks"] {
  const blocks: NonNullable<AssistantItem["blocks"]> = [];
  for (const block of content) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "thinking") {
      blocks.push({ type: "thinking", text: block.thinking });
    }
  }
  return blocks.slice(0, 64);
}

/**
 * 只暴露 toolCall 的标识，不暴露 arguments。
 * arguments 属于脱敏边界内的数据，不进公开协议。
 */
function assistantToolCalls(
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
): AssistantItem["toolCalls"] {
  return content
    .filter(
      (block): block is Extract<typeof block, { type: "toolCall" }> =>
        block.type === "toolCall",
    )
    .slice(0, 64)
    .map((block) => ({ toolCallId: block.id, name: block.name }));
}

/**
 * Pi 的 `AssistantMessage.usage` 是必填字段，但历史 entry 可能缺失或结构不符，
 * 读不到时返回 null，不编造 0 值。
 */
function readAssistantUsage(value: unknown): AiUsage | null {
  if (!isRecord(value)) return null;
  return {
    inputTokens: readTokenCount(value.input),
    outputTokens: readTokenCount(value.output),
    cacheReadTokens: readTokenCount(value.cacheRead),
    cacheWriteTokens: readTokenCount(value.cacheWrite),
    cacheWrite1hTokens: readTokenCount(value.cacheWrite1h),
    reasoningTokens: readTokenCount(value.reasoning),
    totalTokens: readTokenCount(value.totalTokens),
  };
}

function readTokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function readTokensBefore(value: unknown): number | null {
  return readTokenCount(value);
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
  structuredOutputId: string | null;
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
    structuredOutputId: readUuid(details.structuredOutputId),
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
