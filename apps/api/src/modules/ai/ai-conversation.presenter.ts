import type {
  ApiErrorCode,
  AiConversationContentBlock,
  AiConversationDetail,
  AiConversationGeneration,
  AiConversationMessageDto,
  AiConversationSummary,
} from "@starter/contracts";
import {
  aiConversationContentBlockSchema,
  aiConversationMessageStatusSchema,
  aiConversationStatusSchema,
  aiGenerationStatusSchema,
  apiErrorCodeSchema,
} from "@starter/contracts";

import type {
  AiConversationMessageRecord,
  AiConversationRecord,
  AiGenerationRecord,
} from "./ai-conversation.repository.js";

export function toConversationSummary(
  record: AiConversationRecord,
): AiConversationSummary {
  return {
    id: record.id,
    title: record.title,
    status: aiConversationStatusSchema.parse(record.status),
    activeGenerationId: record.activeGenerationId,
    lastModel:
      record.lastProviderId && record.lastModelId
        ? { providerId: record.lastProviderId, modelId: record.lastModelId }
        : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toConversationMessage(
  record: AiConversationMessageRecord,
): AiConversationMessageDto {
  let blocks: AiConversationContentBlock[];
  try {
    const parsed = JSON.parse(record.contentJson) as unknown;
    const result = aiConversationContentBlockSchema.array().safeParse(parsed);
    if (!result.success) throw new Error("invalid content");
    blocks = result.data;
  } catch {
    throw new Error("会话消息内容损坏");
  }

  const status = aiConversationMessageStatusSchema.safeParse(record.status);
  if (!status.success) throw new Error("会话消息状态损坏");
  return {
    id: record.id,
    conversationId: record.conversationId,
    sequence: record.sequence,
    role:
      record.role === "user"
        ? "user"
        : record.role === "assistant"
          ? "assistant"
          : (() => {
              throw new Error("会话消息角色损坏");
            })(),
    blocks,
    status: status.data,
    model:
      record.providerId && record.modelId
        ? { providerId: record.providerId, modelId: record.modelId }
        : null,
    stopReason: isStopReason(record.stopReason) ? record.stopReason : null,
    errorCode: isApiErrorCode(record.errorCode) ? record.errorCode : null,
    generationId: record.generationId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}

export function toConversationDetail(
  record: AiConversationRecord,
  messages: AiConversationMessageRecord[],
): AiConversationDetail {
  return {
    ...toConversationSummary(record),
    messages: messages.map(toConversationMessage),
  };
}

export function toConversationGeneration(
  record: AiGenerationRecord,
  assistantMessageId: string,
): AiConversationGeneration {
  return {
    id: record.id,
    conversationId: record.conversationId,
    status: aiGenerationStatusSchema.parse(record.status),
    userMessageId: record.userMessageId,
    assistantMessageId,
    retryOfGenerationId: record.retryOfGenerationId,
    errorCode: isApiErrorCode(record.errorCode) ? record.errorCode : null,
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}

export function serializeContentBlocks(
  blocks: readonly AiConversationContentBlock[],
): string {
  return JSON.stringify(
    blocks.map((block) =>
      block.type === "text"
        ? {
            type: block.type,
            text: block.text,
            turnIndex: block.turnIndex,
            contentIndex: block.contentIndex,
            blockId: block.blockId,
          }
        : {
            type: block.type,
            toolCallId: block.toolCallId,
            name: block.name,
            status: block.status,
            errorCode: block.errorCode,
            turnIndex: block.turnIndex,
            contentIndex: block.contentIndex,
            blockId: block.blockId,
          },
    ),
  );
}

function isStopReason(
  value: string | null,
): value is "stop" | "length" | "tool_use" {
  return value === "stop" || value === "length" || value === "tool_use";
}

function isApiErrorCode(value: string | null): value is ApiErrorCode {
  return apiErrorCodeSchema.safeParse(value).success;
}
