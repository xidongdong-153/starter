import {
  aiAssistantMessageSchema,
  aiConversationCompletedEventSchema,
  aiConversationStartEventSchema,
  aiConversationTextDeltaEventSchema,
  aiToolActivityEventSchema,
  aiUsageSchema,
} from "@starter/contracts";
import { describe, expect, it } from "vitest";

import { serializeContentBlocks } from "@api/modules/ai/ai-conversation.presenter.js";

describe("ai message contracts", () => {
  it("会话 ID 契约只接受 UUIDv7", () => {
    const event = {
      type: "start" as const,
      requestId: "request-1",
      conversationId: "01958c80-8df7-7ce2-8f90-123456789001",
      generationId: "01958c80-8df7-7ce2-8f90-123456789002",
      assistantMessageId: "01958c80-8df7-7ce2-8f90-123456789003",
      model: { providerId: "openai", modelId: "gpt-4o" },
    };

    expect(aiConversationStartEventSchema.safeParse(event).success).toBe(true);
    expect(
      aiConversationStartEventSchema.safeParse({
        ...event,
        generationId: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
  });

  it("持久化块只保留公开字段", () => {
    const marker = "private-tool-arguments";
    const block = {
      type: "tool_activity",
      toolCallId: "call-1",
      name: "lookup",
      status: "failed",
      errorCode: "AI.TOOL_FAILED",
      turnIndex: 0,
      contentIndex: 0,
      blockId: "0:0",
      safeSummary: marker,
      arguments: marker,
      result: marker,
    } as const;
    const serialized = serializeContentBlocks([block]);

    expect(serialized).not.toContain(marker);
    expect(JSON.parse(serialized)).toEqual([
      {
        type: "tool_activity",
        toolCallId: "call-1",
        name: "lookup",
        status: "failed",
        errorCode: "AI.TOOL_FAILED",
        turnIndex: 0,
        contentIndex: 0,
        blockId: "0:0",
      },
    ]);
  });

  it("completed 事件只在 assistant block 上携带内容排序字段", () => {
    const result = aiConversationCompletedEventSchema.safeParse({
      type: "completed",
      turnIndex: 2,
      assistantMessage: {
        role: "assistant",
        blocks: [
          {
            type: "text",
            text: "first",
            turnIndex: 2,
            contentIndex: 0,
            blockId: "2:0",
          },
        ],
      },
      stopReason: "stop",
      usage: {
        inputTokens: null,
        outputTokens: 0,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        totalTokens: 0,
      },
      cost: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.turnIndex).toBe(2);
      expect(result.data.assistantMessage.blocks[0]).toMatchObject({
        turnIndex: 2,
        contentIndex: 0,
        blockId: "2:0",
      });
      expect(result.data).not.toHaveProperty("contentIndex");
      expect(result.data).not.toHaveProperty("blockId");
    }
  });

  it("text delta、tool activity 和 usage 保留缺失值为 null、0 保持为 0", () => {
    expect(
      aiConversationTextDeltaEventSchema.safeParse({
        type: "text_delta",
        text: "delta",
        turnIndex: 1,
        contentIndex: 4,
        blockId: "1:4",
      }).success,
    ).toBe(true);
    expect(
      aiToolActivityEventSchema.safeParse({
        type: "tool_activity",
        toolCallId: "call-1",
        name: "lookup",
        status: "succeeded",
        errorCode: null,
        turnIndex: 1,
        contentIndex: 5,
        blockId: "1:5",
        safeSummary: null,
      }).success,
    ).toBe(true);
    expect(
      aiUsageSchema.parse({
        inputTokens: null,
        outputTokens: 0,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        totalTokens: 0,
      }),
    ).toMatchObject({ outputTokens: 0, totalTokens: 0 });

    const message = aiAssistantMessageSchema.parse({
      role: "assistant",
      blocks: [
        {
          type: "tool_activity",
          toolCallId: "call-1",
          name: "lookup",
          status: "succeeded",
          errorCode: null,
          turnIndex: 1,
          contentIndex: 5,
          blockId: "1:5",
          safeSummary: "temporary summary",
        },
      ],
    });
    expect(message.blocks[0]).not.toHaveProperty("safeSummary");
  });
});
