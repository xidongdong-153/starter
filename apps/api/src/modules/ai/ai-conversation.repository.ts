import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import {
  aiConversationMessages,
  aiConversations,
  aiGenerations,
} from "@api/modules/ai/ai.schema.js";

export type AiConversationRecord = typeof aiConversations.$inferSelect;
export type AiConversationMessageRecord =
  typeof aiConversationMessages.$inferSelect;
export type AiGenerationRecord = typeof aiGenerations.$inferSelect;

interface BeginGenerationInput {
  assistantMessageId: string;
  conversationId: string;
  generationId: string;
  model: { providerId: string; modelId: string };
  ownerId: string;
  startedAt: Date;
}

interface BeginSendGenerationInput extends BeginGenerationInput {
  title: string;
  userContentJson: string;
  userMessageId: string;
}

interface BeginRetryGenerationInput extends BeginGenerationInput {
  retryOfGenerationId: string;
}

export type BeginGenerationResult =
  | { kind: "not_found" }
  | { kind: "active" }
  | { kind: "model_not_allowed" }
  | { kind: "retry_not_allowed" }
  | {
      kind: "created";
      conversation: AiConversationRecord;
      generation: AiGenerationRecord;
      assistantMessage: AiConversationMessageRecord;
      history: AiConversationMessageRecord[];
      userMessage: AiConversationMessageRecord;
    };

export function createAiConversationRepository(db: AppDatabase) {
  function createConversation(input: {
    id: string;
    ownerId: string;
    title: string;
    now: Date;
  }): AiConversationRecord {
    db.insert(aiConversations)
      .values({
        id: input.id,
        ownerId: input.ownerId,
        title: input.title,
        status: "idle",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .run();
    return db
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, input.id),
          eq(aiConversations.ownerId, input.ownerId),
        ),
      )
      .get()!;
  }

  function listOwned(
    ownerId: string,
    query: { page: number; pageSize: number },
  ): { items: AiConversationRecord[]; total: number } {
    const totalRow = db
      .select({ value: count() })
      .from(aiConversations)
      .where(eq(aiConversations.ownerId, ownerId))
      .get();
    const total = totalRow?.value ?? 0;
    const items = db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.ownerId, ownerId))
      .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();
    return { items, total };
  }

  function findOwnedConversation(
    conversationId: string,
    ownerId: string,
  ): AiConversationRecord | undefined {
    return db
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, conversationId),
          eq(aiConversations.ownerId, ownerId),
        ),
      )
      .get();
  }

  function listOwnedMessages(
    conversationId: string,
    ownerId: string,
  ): AiConversationMessageRecord[] {
    return db
      .select({ message: aiConversationMessages })
      .from(aiConversationMessages)
      .innerJoin(
        aiConversations,
        eq(aiConversations.id, aiConversationMessages.conversationId),
      )
      .where(
        and(
          eq(aiConversationMessages.conversationId, conversationId),
          eq(aiConversations.ownerId, ownerId),
        ),
      )
      .orderBy(asc(aiConversationMessages.sequence))
      .all()
      .map((row) => row.message);
  }

  function deleteOwnedConversation(
    conversationId: string,
    ownerId: string,
  ): boolean {
    const result = db
      .delete(aiConversations)
      .where(
        and(
          eq(aiConversations.id, conversationId),
          eq(aiConversations.ownerId, ownerId),
        ),
      )
      .run();
    return result.changes > 0;
  }

  function beginSendGeneration(
    input: BeginSendGenerationInput,
    isModelAllowed: () => boolean,
  ): BeginGenerationResult {
    return db.transaction((tx) => {
      const conversation = tx
        .select()
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.ownerId, input.ownerId),
          ),
        )
        .get();
      if (!conversation) return { kind: "not_found" };
      if (conversation.activeGenerationId) return { kind: "active" };
      if (!isModelAllowed()) return { kind: "model_not_allowed" };

      const history = tx
        .select()
        .from(aiConversationMessages)
        .where(eq(aiConversationMessages.conversationId, input.conversationId))
        .orderBy(asc(aiConversationMessages.sequence))
        .all();
      const nextSequence = nextMessageSequence(tx, input.conversationId);
      const acquired = tx
        .update(aiConversations)
        .set({
          activeGenerationId: input.generationId,
          status: "generating",
          title: history.length === 0 ? input.title : conversation.title,
          updatedAt: input.startedAt,
        })
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.ownerId, input.ownerId),
            sql`${aiConversations.activeGenerationId} is null`,
          ),
        )
        .run();
      if (acquired.changes !== 1) return { kind: "active" };

      tx.insert(aiConversationMessages)
        .values({
          id: input.userMessageId,
          conversationId: input.conversationId,
          sequence: nextSequence,
          role: "user",
          contentJson: input.userContentJson,
          status: "completed",
          createdAt: input.startedAt,
          updatedAt: input.startedAt,
          completedAt: input.startedAt,
        })
        .run();
      tx.insert(aiGenerations)
        .values({
          id: input.generationId,
          conversationId: input.conversationId,
          ownerId: input.ownerId,
          status: "generating",
          userMessageId: input.userMessageId,
          startedAt: input.startedAt,
        })
        .run();
      tx.update(aiConversationMessages)
        .set({ generationId: input.generationId })
        .where(eq(aiConversationMessages.id, input.userMessageId))
        .run();
      tx.insert(aiConversationMessages)
        .values({
          id: input.assistantMessageId,
          conversationId: input.conversationId,
          sequence: nextSequence + 1,
          role: "assistant",
          contentJson: "[]",
          status: "streaming",
          providerId: input.model.providerId,
          modelId: input.model.modelId,
          generationId: input.generationId,
          createdAt: input.startedAt,
          updatedAt: input.startedAt,
        })
        .run();

      return readCreatedGeneration(tx, input, history, input.userMessageId);
    });
  }

  function beginRetryGeneration(
    input: BeginRetryGenerationInput,
    isModelAllowed: () => boolean,
  ): BeginGenerationResult {
    return db.transaction((tx) => {
      const conversation = tx
        .select()
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.ownerId, input.ownerId),
          ),
        )
        .get();
      if (!conversation) return { kind: "not_found" };
      if (conversation.activeGenerationId) return { kind: "active" };
      if (!isModelAllowed()) return { kind: "model_not_allowed" };

      const latest = tx
        .select()
        .from(aiGenerations)
        .where(
          and(
            eq(aiGenerations.conversationId, input.conversationId),
            eq(aiGenerations.ownerId, input.ownerId),
          ),
        )
        .orderBy(desc(aiGenerations.startedAt), desc(aiGenerations.id))
        .limit(1)
        .get();
      if (
        !latest ||
        latest.id !== input.retryOfGenerationId ||
        !isRetryableGenerationStatus(latest.status)
      ) {
        return { kind: "retry_not_allowed" };
      }
      const userMessage = tx
        .select()
        .from(aiConversationMessages)
        .where(
          and(
            eq(aiConversationMessages.id, latest.userMessageId),
            eq(aiConversationMessages.conversationId, input.conversationId),
          ),
        )
        .get();
      if (!userMessage) return { kind: "retry_not_allowed" };

      const history = tx
        .select()
        .from(aiConversationMessages)
        .where(eq(aiConversationMessages.conversationId, input.conversationId))
        .orderBy(asc(aiConversationMessages.sequence))
        .all();
      const acquired = tx
        .update(aiConversations)
        .set({
          activeGenerationId: input.generationId,
          status: "generating",
          updatedAt: input.startedAt,
        })
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.ownerId, input.ownerId),
            sql`${aiConversations.activeGenerationId} is null`,
          ),
        )
        .run();
      if (acquired.changes !== 1) return { kind: "active" };

      tx.insert(aiGenerations)
        .values({
          id: input.generationId,
          conversationId: input.conversationId,
          ownerId: input.ownerId,
          status: "generating",
          retryOfGenerationId: latest.id,
          userMessageId: latest.userMessageId,
          startedAt: input.startedAt,
        })
        .run();
      tx.insert(aiConversationMessages)
        .values({
          id: input.assistantMessageId,
          conversationId: input.conversationId,
          sequence: nextMessageSequence(tx, input.conversationId),
          role: "assistant",
          contentJson: "[]",
          status: "streaming",
          providerId: input.model.providerId,
          modelId: input.model.modelId,
          generationId: input.generationId,
          createdAt: input.startedAt,
          updatedAt: input.startedAt,
        })
        .run();

      return readCreatedGeneration(tx, input, history, latest.userMessageId);
    });
  }

  function findOwnedGeneration(
    conversationId: string,
    generationId: string,
    ownerId: string,
  ): AiGenerationRecord | undefined {
    return db
      .select()
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.id, generationId),
          eq(aiGenerations.conversationId, conversationId),
          eq(aiGenerations.ownerId, ownerId),
        ),
      )
      .get();
  }

  function findLatestOwnedGeneration(
    conversationId: string,
    ownerId: string,
  ): AiGenerationRecord | undefined {
    return db
      .select()
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.conversationId, conversationId),
          eq(aiGenerations.ownerId, ownerId),
        ),
      )
      .orderBy(desc(aiGenerations.startedAt), desc(aiGenerations.id))
      .limit(1)
      .get();
  }

  function findAssistantMessageForGeneration(
    conversationId: string,
    generationId: string,
    ownerId: string,
  ): AiConversationMessageRecord | undefined {
    const row = db
      .select({ message: aiConversationMessages })
      .from(aiConversationMessages)
      .innerJoin(
        aiConversations,
        eq(aiConversations.id, aiConversationMessages.conversationId),
      )
      .where(
        and(
          eq(aiConversationMessages.conversationId, conversationId),
          eq(aiConversationMessages.generationId, generationId),
          eq(aiConversationMessages.role, "assistant"),
          eq(aiConversations.ownerId, ownerId),
        ),
      )
      .get();
    return row?.message;
  }

  function listGenerationChain(
    conversationId: string,
    userMessageId: string,
    ownerId: string,
  ): AiGenerationRecord[] {
    return db
      .select()
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.conversationId, conversationId),
          eq(aiGenerations.ownerId, ownerId),
          eq(aiGenerations.userMessageId, userMessageId),
        ),
      )
      .orderBy(asc(aiGenerations.startedAt), asc(aiGenerations.id))
      .all();
  }

  function finalizeGeneration(input: {
    assistantContentJson: string;
    assistantMessageId: string;
    assistantStatus: "completed" | "failed" | "aborted" | "interrupted";
    conversationId: string;
    errorCode: string | null;
    finishedAt: Date;
    generationId: string;
    generationStatus: "succeeded" | "failed" | "aborted" | "interrupted";
    model: { providerId: string; modelId: string };
    ownerId: string;
    stopReason: "stop" | "length" | "tool_use" | null;
  }): void {
    db.transaction((tx) => {
      const generation = tx
        .select()
        .from(aiGenerations)
        .where(
          and(
            eq(aiGenerations.id, input.generationId),
            eq(aiGenerations.conversationId, input.conversationId),
            eq(aiGenerations.ownerId, input.ownerId),
          ),
        )
        .get();
      if (!generation || generation.status !== "generating") return;

      tx.update(aiConversationMessages)
        .set({
          contentJson: input.assistantContentJson,
          status: input.assistantStatus,
          providerId: input.model.providerId,
          modelId: input.model.modelId,
          stopReason: input.stopReason,
          errorCode: input.errorCode,
          updatedAt: input.finishedAt,
          completedAt: input.finishedAt,
        })
        .where(
          and(
            eq(aiConversationMessages.id, input.assistantMessageId),
            eq(aiConversationMessages.conversationId, input.conversationId),
            eq(aiConversationMessages.generationId, input.generationId),
          ),
        )
        .run();
      tx.update(aiGenerations)
        .set({
          status: input.generationStatus,
          errorCode: input.errorCode,
          finishedAt: input.finishedAt,
        })
        .where(
          and(
            eq(aiGenerations.id, input.generationId),
            eq(aiGenerations.ownerId, input.ownerId),
            eq(aiGenerations.status, "generating"),
          ),
        )
        .run();
      tx.update(aiConversations)
        .set({
          activeGenerationId: null,
          status: "idle",
          lastProviderId: input.model.providerId,
          lastModelId: input.model.modelId,
          updatedAt: input.finishedAt,
        })
        .where(
          and(
            eq(aiConversations.id, input.conversationId),
            eq(aiConversations.ownerId, input.ownerId),
            eq(aiConversations.activeGenerationId, input.generationId),
          ),
        )
        .run();
    });
  }

  function recoverInterrupted(now: Date): number {
    return db.transaction((tx) => {
      const generations = tx
        .select()
        .from(aiGenerations)
        .where(eq(aiGenerations.status, "generating"))
        .all();
      if (generations.length === 0) return 0;
      const generationIds = generations.map((generation) => generation.id);
      tx.update(aiConversationMessages)
        .set({
          status: "interrupted",
          errorCode: "AI.GENERATION_INTERRUPTED",
          updatedAt: now,
          completedAt: now,
        })
        .where(
          and(
            inArray(aiConversationMessages.generationId, generationIds),
            eq(aiConversationMessages.role, "assistant"),
          ),
        )
        .run();
      tx.update(aiGenerations)
        .set({
          status: "interrupted",
          errorCode: "AI.GENERATION_INTERRUPTED",
          finishedAt: now,
        })
        .where(inArray(aiGenerations.id, generationIds))
        .run();
      for (const generation of generations) {
        tx.update(aiConversations)
          .set({ activeGenerationId: null, status: "idle", updatedAt: now })
          .where(
            and(
              eq(aiConversations.id, generation.conversationId),
              eq(aiConversations.ownerId, generation.ownerId),
              eq(aiConversations.activeGenerationId, generation.id),
            ),
          )
          .run();
      }
      return generations.length;
    });
  }

  return {
    beginRetryGeneration,
    beginSendGeneration,
    createConversation,
    deleteOwnedConversation,
    finalizeGeneration,
    findAssistantMessageForGeneration,
    findLatestOwnedGeneration,
    findOwnedConversation,
    findOwnedGeneration,
    listGenerationChain,
    listOwned,
    listOwnedMessages,
    recoverInterrupted,
  };
}

type Transaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

function nextMessageSequence(db: Transaction, conversationId: string): number {
  const row = db
    .select({
      value: sql<number>`coalesce(max(${aiConversationMessages.sequence}), 0)`,
    })
    .from(aiConversationMessages)
    .where(eq(aiConversationMessages.conversationId, conversationId))
    .get();
  return Number(row?.value ?? 0) + 1;
}

function readCreatedGeneration(
  db: Transaction,
  input: BeginGenerationInput,
  history: AiConversationMessageRecord[],
  userMessageId: string,
): Extract<BeginGenerationResult, { kind: "created" }> {
  const conversation = db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.id, input.conversationId))
    .get()!;
  const generation = db
    .select()
    .from(aiGenerations)
    .where(eq(aiGenerations.id, input.generationId))
    .get()!;
  const assistantMessage = db
    .select()
    .from(aiConversationMessages)
    .where(eq(aiConversationMessages.id, input.assistantMessageId))
    .get()!;
  const userMessage = db
    .select()
    .from(aiConversationMessages)
    .where(eq(aiConversationMessages.id, userMessageId))
    .get()!;
  return {
    kind: "created",
    conversation,
    generation,
    assistantMessage,
    history,
    userMessage,
  };
}

function isRetryableGenerationStatus(status: string): boolean {
  return (
    status === "failed" || status === "aborted" || status === "interrupted"
  );
}
