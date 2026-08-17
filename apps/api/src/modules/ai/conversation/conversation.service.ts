import type {
  AiConversationContentBlock,
  AiConversationDetail,
  AiConversationGeneration,
  AiConversationList,
  AiConversationStreamEvent,
  AiConversationSummary,
  AiModelRef,
  CreateAiConversationInput,
  RetryAiConversationGenerationInput,
  SendAiConversationMessageInput,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";

import type {
  AiGateway,
  AiModelAssistantMessage,
  AiModelMessage,
} from "@api/infra/ai/index.js";
import { AiGatewayError } from "@api/infra/ai/index.js";
import { generateId } from "@api/shared/id.js";
import { AppError } from "@api/shared/app-error.js";

import type { AiInvocationRunner } from "../usage-audit/usage-audit.service.js";
import type { AiToolOrchestrator } from "../tool/tool-orchestrator.js";
import type {
  AiConversationMessageRecord,
  AiGenerationRecord,
  createAiConversationRepository,
} from "./conversation.repository.js";
import {
  serializeContentBlocks,
  toConversationDetail,
  toConversationGeneration,
  toConversationMessage,
  toConversationSummary,
} from "./conversation.presenter.js";
import { appendSkillDescriptions } from "../skill/skill-tools.js";

export const MAX_CONTEXT_MESSAGES = 50;
export const MAX_CONTEXT_CHARS = 100_000;

interface AiConversationModelAccess {
  isAllowed: (model: AiModelRef) => boolean;
  resolve: (userId: string, requestedModel?: AiModelRef) => Promise<AiModelRef>;
}

export interface AiConversationSystemPromptAccess {
  assertAvailable: (systemPromptId: string | null) => void;
  resolveContent: (systemPromptId: string | null) => string | null;
  getGlobalSystemPromptId: () => string | null;
}

export interface AiConversationSkillAccess {
  listDescriptions: () => { name: string; description: string }[];
}

interface GenerationState {
  activities: Map<string, AiConversationContentBlock>;
  textBlocks: Map<
    string,
    Extract<AiConversationContentBlock, { type: "text" }>
  >;
}

export interface AiConversationPreparedGeneration {
  assistantMessageId: string;
  conversationId: string;
  generationId: string;
  model: AiModelRef;
}

export function createAiConversationService(
  repository: ReturnType<typeof createAiConversationRepository>,
  gateway: AiGateway,
  modelAccess: AiConversationModelAccess,
  invocationRunner?: AiInvocationRunner,
  requestTimeoutMs = 120_000,
  toolOrchestrator?: AiToolOrchestrator,
  systemPromptAccess?: AiConversationSystemPromptAccess,
  skillAccess?: AiConversationSkillAccess,
) {
  const controllers = new Map<string, PreparedGenerationInternal>();
  repository.recoverInterrupted(new Date());

  function resolveSystemPrompt(
    systemPromptId: string | null,
  ): string | undefined {
    const effectiveId =
      systemPromptId ?? systemPromptAccess?.getGlobalSystemPromptId() ?? null;
    return systemPromptAccess?.resolveContent(effectiveId) ?? undefined;
  }

  function createConversation(
    ownerId: string,
    input: CreateAiConversationInput,
  ): AiConversationSummary {
    const now = new Date();
    systemPromptAccess?.assertAvailable(input.systemPromptId ?? null);
    const record = repository.createConversation({
      id: generateId(),
      ownerId,
      title: input.title ?? "新会话",
      systemPromptId: input.systemPromptId ?? null,
      now,
    });
    return toConversationSummary(record);
  }

  function listConversations(
    ownerId: string,
    query: { page: number; pageSize: number },
  ): AiConversationList {
    const result = repository.listOwned(ownerId, query);
    return {
      items: result.items.map(toConversationSummary),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  function getConversation(
    conversationId: string,
    ownerId: string,
  ): AiConversationDetail {
    const conversation = requireConversation(conversationId, ownerId);
    return toConversationDetail(
      conversation,
      repository.listOwnedMessages(conversationId, ownerId),
    );
  }

  function deleteConversation(conversationId: string, ownerId: string): void {
    const conversation = requireConversation(conversationId, ownerId);
    if (conversation.activeGenerationId) {
      const prepared = controllers.get(conversation.activeGenerationId);
      prepared?.controller.abort();
      if (prepared && !prepared.running) finalizeAborted(prepared);
    }
    if (!repository.deleteOwnedConversation(conversationId, ownerId)) {
      throw notFoundError();
    }
  }

  async function prepareSend(
    conversationId: string,
    ownerId: string,
    input: SendAiConversationMessageInput,
  ): Promise<PreparedGenerationInternal> {
    const conversation = requireConversation(conversationId, ownerId);
    ensureNoActiveGeneration(conversation.activeGenerationId);
    systemPromptAccess?.assertAvailable(input.systemPromptId ?? null);
    const systemPrompt = resolveSystemPrompt(
      input.systemPromptId === undefined
        ? conversation.systemPromptId
        : input.systemPromptId,
    );
    const model = await modelAccess.resolve(ownerId, input.model);
    const history = repository.listOwnedMessages(conversationId, ownerId);
    const turnIndex = history.filter(
      (message) => message.role === "user",
    ).length;
    const userBlocks = [createUserTextBlock(input.text, turnIndex)];
    const contextMessages = toGatewayMessages(history);
    contextMessages.push({
      role: "user",
      content: userBlocks,
      timestamp: Date.now(),
    });
    assertContextLimit(contextMessages);

    const prepared = createPreparedGeneration({
      assistantMessageId: generateId(),
      conversationId,
      generationId: generateId(),
      model,
      ownerId,
      systemPrompt,
      gatewayMessages: contextMessages,
      retryOfGenerationId: null,
      title: makeConversationTitle(input.text),
      userBlocks,
      userMessageId: generateId(),
      mode: "send",
      turnIndex,
    });
    const result = repository.beginSendGeneration(
      {
        assistantMessageId: prepared.assistantMessageId,
        conversationId,
        generationId: prepared.generationId,
        model,
        ownerId,
        startedAt: prepared.startedAt,
        systemPromptId: input.systemPromptId,
        title: prepared.title,
        userContentJson: serializeContentBlocks(userBlocks),
        userMessageId: prepared.userMessageId,
      },
      () => modelAccess.isAllowed(model),
    );
    return finishBeginResult(result, prepared);
  }

  async function prepareRetry(
    conversationId: string,
    ownerId: string,
    input: RetryAiConversationGenerationInput,
  ): Promise<PreparedGenerationInternal> {
    const conversation = requireConversation(conversationId, ownerId);
    ensureNoActiveGeneration(conversation.activeGenerationId);
    const source = repository.findOwnedGeneration(
      conversationId,
      input.generationId,
      ownerId,
    );
    const latest = repository.findLatestOwnedGeneration(
      conversationId,
      ownerId,
    );
    if (
      !source ||
      !latest ||
      latest.id !== source.id ||
      !isRetryableStatus(source.status)
    ) {
      throw retryNotAllowedError();
    }
    const model = await modelAccess.resolve(ownerId, input.model);
    const history = repository.listOwnedMessages(conversationId, ownerId);
    const chain = repository.listGenerationChain(
      conversationId,
      source.userMessageId,
      ownerId,
    );
    const excluded = new Set(
      chain
        .filter((generation) => isRetryableStatus(generation.status))
        .map((generation) => generation.id),
    );
    const contextRecords = history.filter(
      (message) =>
        message.role !== "assistant" ||
        !message.generationId ||
        !excluded.has(message.generationId),
    );
    const contextMessages = toGatewayMessages(contextRecords);
    assertContextLimit(contextMessages);
    const userRecord = history.find(
      (message) => message.id === source.userMessageId,
    );
    if (!userRecord) throw retryNotAllowedError();
    const userBlocks = parseUserBlocks(userRecord);
    const messagesBeforeUser = history
      .slice(0, userRecord.sequence)
      .filter((message) => message.role === "user");
    const turnIndex = messagesBeforeUser.length - 1;
    const prepared = createPreparedGeneration({
      assistantMessageId: generateId(),
      conversationId,
      generationId: generateId(),
      model,
      ownerId,
      systemPrompt: resolveSystemPrompt(conversation.systemPromptId),
      gatewayMessages: contextMessages,
      retryOfGenerationId: source.id,
      title: conversation.title,
      userBlocks,
      userMessageId: source.userMessageId,
      mode: "retry",
      turnIndex: Math.max(0, turnIndex),
    });
    const result = repository.beginRetryGeneration(
      {
        assistantMessageId: prepared.assistantMessageId,
        conversationId,
        generationId: prepared.generationId,
        model,
        ownerId,
        retryOfGenerationId: source.id,
        startedAt: prepared.startedAt,
      },
      () => modelAccess.isAllowed(model),
    );
    return finishBeginResult(result, prepared);
  }

  function stopGeneration(
    conversationId: string,
    generationId: string,
    ownerId: string,
  ): { statusCode: 200 | 202; generation: AiConversationGeneration } {
    const generation = repository.findOwnedGeneration(
      conversationId,
      generationId,
      ownerId,
    );
    if (!generation) throw notFoundError();
    const assistant = repository.findAssistantMessageForGeneration(
      conversationId,
      generationId,
      ownerId,
    );
    if (!assistant) throw notFoundError();
    const prepared = controllers.get(generationId);
    if (generation.status === "generating") {
      prepared?.controller.abort();
      if (prepared && !prepared.running) finalizeAborted(prepared);
      if (!prepared) {
        const detached: PreparedGenerationInternal = {
          assistantMessageId: assistant.id,
          conversationId,
          controller: new AbortController(),
          finalized: false,
          generationId,
          gatewayMessages: [],
          model: {
            providerId: assistant.providerId ?? "",
            modelId: assistant.modelId ?? "",
          },
          mode: "send",
          ownerId,
          retryOfGenerationId: generation.retryOfGenerationId,
          startedAt: generation.startedAt,
          state: stateFromStoredMessage(assistant),
          title: "",
          turnIndex: 0,
          userBlocks: [],
          userMessageId: generation.userMessageId,
          running: false,
        };
        finalizeAborted(detached);
      }
      return {
        statusCode: 202,
        generation: toGenerationDto(generation, assistant.id),
      };
    }
    return {
      statusCode: 200,
      generation: toGenerationDto(generation, assistant.id),
    };
  }

  async function* streamGeneration(
    prepared: PreparedGenerationInternal,
    requestId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AiConversationStreamEvent> {
    prepared.running = true;
    const onAbort = () => prepared.controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const gatewayInput = {
        model: prepared.model,
        messages: prepared.gatewayMessages,
        sessionId: prepared.conversationId,
        systemPrompt: appendSkillDescriptions(
          prepared.systemPrompt,
          skillAccess?.listDescriptions() ?? [],
        ),
        turnIndex: prepared.turnIndex,
        timeoutMs: requestTimeoutMs,
        signal: prepared.controller.signal,
      };
      const events = toolOrchestrator
        ? toolOrchestrator.stream({
            model: prepared.model,
            messages: prepared.gatewayMessages,
            systemPrompt: appendSkillDescriptions(
              prepared.systemPrompt,
              skillAccess?.listDescriptions() ?? [],
            ),
            userId: prepared.ownerId,
            requestId,
            conversationId: prepared.conversationId,
            generationId: prepared.generationId,
            initialTurnIndex: prepared.turnIndex,
            sessionId: prepared.conversationId,
            signal: prepared.controller.signal,
            requestTimeoutMs,
          })
        : invocationRunner
          ? invocationRunner.stream(
              {
                requestId,
                userId: prepared.ownerId,
                scenario: "conversation",
                conversationId: prepared.conversationId,
                generationId: prepared.generationId,
                timeoutMs: requestTimeoutMs,
              },
              gatewayInput,
            )
          : gateway.stream(gatewayInput);
      for await (const event of events) {
        if (event.type === "tool_activity") {
          prepared.state.activities.set(event.toolCallId, {
            type: "tool_activity",
            toolCallId: event.toolCallId,
            name: event.name,
            status: event.status,
            errorCode: event.errorCode,
            turnIndex: event.turnIndex,
            contentIndex: event.contentIndex,
            blockId: event.blockId,
          });
          yield event;
          continue;
        }
        if (event.type === "text_delta") {
          const blockKey = `${event.turnIndex}:${event.contentIndex}`;
          const current = prepared.state.textBlocks.get(blockKey);
          prepared.state.textBlocks.set(blockKey, {
            type: "text",
            text: `${current?.text ?? ""}${event.text}`,
            turnIndex: event.turnIndex,
            contentIndex: event.contentIndex,
            blockId: event.blockId,
          });
          yield {
            type: "text_delta",
            text: event.text,
            turnIndex: event.turnIndex,
            contentIndex: event.contentIndex,
            blockId: event.blockId,
          };
          continue;
        }
        if (event.type === "tool_call_completed") {
          const activity = createToolActivity(event);
          prepared.state.activities.set(event.id, activity);
          yield {
            type: "tool_activity",
            toolCallId: event.id,
            name: event.name,
            status: "not_found",
            errorCode: ApiErrorCodes.AI_TOOL_NOT_FOUND,
            safeSummary: null,
            turnIndex: event.turnIndex,
            contentIndex: event.contentIndex,
            blockId: event.blockId,
          };
          continue;
        }
        if (event.stopReason === "tool_use") {
          throw new AppError(
            ApiErrorCodes.AI_TOOL_NOT_FOUND,
            "当前没有可用工具处理这次调用",
            503,
          );
        }
        const assistantMessage = toPublicAssistantMessage(
          event.assistantMessage,
          prepared.state,
        );
        finalizeSuccess(prepared, assistantMessage, event.stopReason);
        yield {
          type: "completed",
          turnIndex: event.turnIndex,
          assistantMessage,
          stopReason: event.stopReason,
          usage: event.usage,
          cost: event.cost,
        };
        return;
      }
      throw new AiGatewayError("upstream");
    } catch (error) {
      if (!prepared.finalized) {
        const failure = toGenerationFailure(error, requestId);
        finalizeFailure(prepared, failure.code, failure.status);
        yield {
          type: "error",
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          requestId,
        };
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      prepared.running = false;
      if (!prepared.finalized) finalizeAborted(prepared);
      if (controllers.get(prepared.generationId) === prepared) {
        controllers.delete(prepared.generationId);
      }
    }
  }

  function abortPrepared(prepared: AiConversationPreparedGeneration): void {
    const internal = controllers.get(prepared.generationId);
    internal?.controller.abort();
    if (internal && !internal.running) {
      finalizeAborted(internal);
      if (controllers.get(internal.generationId) === internal) {
        controllers.delete(internal.generationId);
      }
    }
  }

  return {
    abortPrepared,
    createConversation,
    deleteConversation,
    getConversation,
    listConversations,
    prepareRetry,
    prepareSend,
    stopGeneration,
    streamGeneration,
  };

  function requireConversation(conversationId: string, ownerId: string) {
    const conversation = repository.findOwnedConversation(
      conversationId,
      ownerId,
    );
    if (!conversation) throw notFoundError();
    return conversation;
  }

  function createPreparedGeneration(input: {
    assistantMessageId: string;
    conversationId: string;
    gatewayMessages: AiModelMessage[];
    generationId: string;
    mode: "send" | "retry";
    model: AiModelRef;
    ownerId: string;
    retryOfGenerationId: string | null;
    startedAt?: Date;
    systemPrompt?: string;
    title: string;
    turnIndex?: number;
    userBlocks: Extract<AiConversationContentBlock, { type: "text" }>[];
    userMessageId: string;
  }): PreparedGenerationInternal {
    const prepared: PreparedGenerationInternal = {
      ...input,
      controller: new AbortController(),
      finalized: false,
      startedAt: input.startedAt ?? new Date(),
      state: { activities: new Map(), textBlocks: new Map() },
      turnIndex: input.turnIndex ?? countUserTurns(input.gatewayMessages),
      running: false,
    };
    controllers.set(prepared.generationId, prepared);
    return prepared;
  }

  function finishBeginResult(
    result: ReturnType<typeof repository.beginSendGeneration>,
    prepared: PreparedGenerationInternal,
  ): PreparedGenerationInternal {
    if (result.kind !== "created") {
      controllers.delete(prepared.generationId);
      prepared.controller.abort();
    }
    if (result.kind === "not_found") throw notFoundError();
    if (result.kind === "active") throw generationActiveError();
    if (result.kind === "model_not_allowed") throw modelNotAllowedError();
    if (result.kind === "retry_not_allowed") throw retryNotAllowedError();
    prepared.userMessageId = result.userMessage.id;
    return prepared;
  }

  function finalizeSuccess(
    prepared: PreparedGenerationInternal,
    assistantMessage: Extract<
      AiConversationStreamEvent,
      { type: "completed" }
    >["assistantMessage"],
    stopReason: "stop" | "length",
  ): void {
    repository.finalizeGeneration({
      assistantContentJson: serializeContentBlocks(assistantMessage.blocks),
      assistantMessageId: prepared.assistantMessageId,
      assistantStatus: "completed",
      conversationId: prepared.conversationId,
      errorCode: null,
      finishedAt: new Date(),
      generationId: prepared.generationId,
      generationStatus: "succeeded",
      model: prepared.model,
      ownerId: prepared.ownerId,
      stopReason,
    });
    prepared.finalized = true;
  }

  function finalizeFailure(
    prepared: PreparedGenerationInternal,
    code: (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes],
    status: "failed" | "aborted" | "interrupted",
  ): void {
    repository.finalizeGeneration({
      assistantContentJson: serializeContentBlocks(
        getPartialBlocks(prepared.state),
      ),
      assistantMessageId: prepared.assistantMessageId,
      assistantStatus: status,
      conversationId: prepared.conversationId,
      errorCode: code,
      finishedAt: new Date(),
      generationId: prepared.generationId,
      generationStatus: status,
      model: prepared.model,
      ownerId: prepared.ownerId,
      stopReason: null,
    });
    prepared.finalized = true;
  }

  function finalizeAborted(prepared: PreparedGenerationInternal): void {
    if (prepared.finalized) return;
    finalizeFailure(prepared, ApiErrorCodes.AI_REQUEST_ABORTED, "aborted");
  }
}

interface PreparedGenerationInternal {
  assistantMessageId: string;
  conversationId: string;
  controller: AbortController;
  finalized: boolean;
  generationId: string;
  gatewayMessages: AiModelMessage[];
  mode: "send" | "retry";
  model: AiModelRef;
  ownerId: string;
  retryOfGenerationId: string | null;
  startedAt: Date;
  state: GenerationState;
  systemPrompt?: string;
  title: string;
  turnIndex: number;
  userBlocks: Extract<AiConversationContentBlock, { type: "text" }>[];
  userMessageId: string;
  running: boolean;
}

function toGatewayMessages(
  records: AiConversationMessageRecord[],
): AiModelMessage[] {
  return records.map((record) => {
    const message = toConversationMessage(record);
    if (message.role === "user") {
      return {
        role: "user",
        content: message.blocks.filter(isTextBlock),
        timestamp: record.createdAt.getTime(),
      };
    }
    return {
      role: "assistant",
      blocks: message.blocks.filter(isTextBlock),
      timestamp: record.createdAt.getTime(),
    };
  });
}

function parseUserBlocks(
  record: AiConversationMessageRecord,
): Extract<AiConversationContentBlock, { type: "text" }>[] {
  const message = toConversationMessage(record);
  if (message.role !== "user") throw retryNotAllowedError();
  return message.blocks.filter(isTextBlock);
}

function toPublicAssistantMessage(
  message: AiModelAssistantMessage,
  state: GenerationState,
): Extract<
  AiConversationStreamEvent,
  { type: "completed" }
>["assistantMessage"] {
  for (const block of message.blocks) {
    if (block.type === "text") {
      state.textBlocks.set(`${block.turnIndex}:${block.contentIndex}`, {
        type: "text",
        text: block.text,
        turnIndex: block.turnIndex,
        contentIndex: block.contentIndex,
        blockId: block.blockId,
      });
    } else {
      state.activities.set(block.id, createToolActivity(block));
    }
  }
  return { role: "assistant", blocks: getPartialBlocks(state) };
}

function createToolActivity(block: {
  blockId: string;
  contentIndex: number;
  id: string;
  name: string;
  turnIndex: number;
}): Extract<AiConversationContentBlock, { type: "tool_activity" }> {
  return {
    type: "tool_activity",
    toolCallId: block.id,
    name: block.name,
    status: "not_found",
    errorCode: ApiErrorCodes.AI_TOOL_NOT_FOUND,
    turnIndex: block.turnIndex,
    contentIndex: block.contentIndex,
    blockId: block.blockId,
  };
}

function getPartialBlocks(
  state: GenerationState,
): AiConversationContentBlock[] {
  return [...state.textBlocks.values(), ...state.activities.values()].sort(
    (left, right) =>
      left.turnIndex - right.turnIndex ||
      left.contentIndex - right.contentIndex ||
      left.blockId.localeCompare(right.blockId),
  );
}

function stateFromStoredMessage(
  record: AiConversationMessageRecord,
): GenerationState {
  const message = toConversationMessage(record);
  const textBlocks = new Map<
    string,
    Extract<AiConversationContentBlock, { type: "text" }>
  >();
  const activities = new Map<string, AiConversationContentBlock>();
  for (const block of message.blocks) {
    if (block.type === "text")
      textBlocks.set(`${block.turnIndex}:${block.contentIndex}`, block);
    else activities.set(block.toolCallId, block);
  }
  return { activities, textBlocks };
}

function countUserTurns(messages: AiModelMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

function createUserTextBlock(
  text: string,
  turnIndex: number,
): Extract<AiConversationContentBlock, { type: "text" }> {
  return {
    type: "text",
    text,
    turnIndex,
    contentIndex: 0,
    blockId: `${turnIndex}:0`,
  };
}

function assertContextLimit(messages: AiModelMessage[]): void {
  if (messages.length > MAX_CONTEXT_MESSAGES) {
    throw new AppError(
      ApiErrorCodes.AI_CONTEXT_LIMIT,
      "会话消息数量超过 50 条，请创建新会话后继续",
      413,
      { limit: "messages", max: MAX_CONTEXT_MESSAGES },
    );
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
      message.blocks.reduce(
        (sum, block) => sum + (block.type === "text" ? block.text.length : 0),
        0,
      )
    );
  }, 0);
  if (chars > MAX_CONTEXT_CHARS) {
    throw new AppError(
      ApiErrorCodes.AI_CONTEXT_LIMIT,
      "会话文本超过 100000 个字符，请创建新会话后继续",
      413,
      { limit: "characters", max: MAX_CONTEXT_CHARS },
    );
  }
}

function toGenerationFailure(
  error: unknown,
  _requestId: string,
): {
  code: (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];
  message: string;
  retryable: boolean;
  status: "failed" | "aborted" | "interrupted";
  stopReason: "error" | "aborted" | null;
} {
  if (error instanceof AppError) {
    const aborted = error.code === ApiErrorCodes.AI_REQUEST_ABORTED;
    return {
      code: error.code,
      message: error.message,
      retryable: true,
      status: aborted ? "aborted" : "failed",
      stopReason: aborted ? "aborted" : "error",
    };
  }
  if (error instanceof AiGatewayError) {
    if (error.kind === "aborted") {
      return {
        code: ApiErrorCodes.AI_REQUEST_ABORTED,
        message: "生成已停止",
        retryable: true,
        status: "aborted",
        stopReason: "aborted",
      };
    }
    if (error.kind === "timeout") {
      return {
        code: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
        message: "模型响应超时，可以重试",
        retryable: true,
        status: "failed",
        stopReason: "error",
      };
    }
    if (error.kind === "auth") {
      return {
        code: ApiErrorCodes.AI_PROVIDER_AUTH_FAILED,
        message: "Provider 认证失败，请检查配置后重试",
        retryable: true,
        status: "failed",
        stopReason: "error",
      };
    }
  }
  return {
    code: ApiErrorCodes.AI_UPSTREAM_ERROR,
    message: "模型服务暂时不可用，可以稍后重试",
    retryable: true,
    status: "failed",
    stopReason: "error",
  };
}

function toGenerationDto(
  generation: AiGenerationRecord,
  assistantMessageId: string,
): AiConversationGeneration {
  return toConversationGeneration(generation, assistantMessageId);
}

function isTextBlock(
  block: AiConversationContentBlock,
): block is Extract<AiConversationContentBlock, { type: "text" }> {
  return block.type === "text";
}

function isRetryableStatus(status: string): boolean {
  return (
    status === "failed" || status === "aborted" || status === "interrupted"
  );
}

function ensureNoActiveGeneration(activeGenerationId: string | null): void {
  if (activeGenerationId) throw generationActiveError();
}

function generationActiveError(): AppError {
  return new AppError(
    ApiErrorCodes.AI_GENERATION_ACTIVE,
    "会话正在生成，请等待当前请求结束",
    409,
  );
}

function retryNotAllowedError(): AppError {
  return new AppError(
    ApiErrorCodes.AI_RETRY_NOT_ALLOWED,
    "只能重试会话最新的失败或中止请求",
    409,
  );
}

function modelNotAllowedError(): AppError {
  return new AppError(
    ApiErrorCodes.AI_MODEL_NOT_ALLOWED,
    "这个模型当前不可用",
    403,
  );
}

function notFoundError(): AppError {
  return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "资源不存在", 404);
}

function makeConversationTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  let title = "";
  for (const character of normalized) {
    if (title.length + character.length > 120) break;
    title += character;
  }
  return title || "新会话";
}
