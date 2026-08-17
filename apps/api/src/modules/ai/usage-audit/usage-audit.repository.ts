import type {
  AiCost,
  AiModelCallAuditQuery,
  AiModelCallResult,
  AiToolExecutionAuditStatus,
  AiUsage,
} from "@starter/contracts";
import type { AppDatabase } from "@api/infra/db/client.js";
import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";

import { aiModelCalls, aiToolExecutions } from "../ai.schema.js";

export type AiModelCallRecord = typeof aiModelCalls.$inferSelect;
export type AiToolExecutionRecord = typeof aiToolExecutions.$inferSelect;

export interface BeginAiModelCallInput {
  id: string;
  requestId: string;
  userId: string;
  scenario: "model_test" | "conversation";
  conversationId: string | null;
  generationId: string | null;
  providerId: string;
  modelId: string;
  startedAt: Date;
  timeoutMs: number;
}

export interface FinalizeAiModelCallInput {
  id: string;
  finishedAt: Date;
  startedAt: Date;
  result: Exclude<AiModelCallResult, "running">;
  stopReason: AiModelCallRecord["stopReason"];
  errorCode: string | null;
  usage: AiUsage;
  cost: AiCost | null;
}

export interface BeginAiToolExecutionInput {
  id: string;
  aiCallId: string;
  toolName: string;
  startedAt: Date;
  timeoutMs: number;
}

export interface FinalizeAiToolExecutionInput {
  id: string;
  finishedAt: Date;
  startedAt: Date;
  status: Exclude<AiToolExecutionAuditStatus, "running">;
  errorCode: string | null;
}

export function createAiUsageAuditRepository(db: AppDatabase) {
  function recoverInterrupted(now: Date): void {
    db.transaction((tx) => {
      tx.update(aiModelCalls)
        .set({
          result: "interrupted",
          stopReason: "deferred",
          finishedAt: now,
          durationMs: null,
          errorCode: null,
        })
        .where(
          and(
            eq(aiModelCalls.result, "running"),
            sql`${aiModelCalls.startedAt} + ${aiModelCalls.timeoutMs} + 5000 <= ${now.getTime()}`,
          ),
        )
        .run();
      tx.update(aiToolExecutions)
        .set({
          status: "interrupted",
          finishedAt: now,
          durationMs: null,
          errorCode: null,
        })
        .where(
          and(
            eq(aiToolExecutions.status, "running"),
            sql`${aiToolExecutions.startedAt} + ${aiToolExecutions.timeoutMs} + 5000 <= ${now.getTime()}`,
          ),
        )
        .run();
    });
  }

  function beginModelCall(input: BeginAiModelCallInput): void {
    db.insert(aiModelCalls)
      .values({ ...input, result: "running" })
      .run();
  }

  function finalizeModelCall(input: FinalizeAiModelCallInput): void {
    db.update(aiModelCalls)
      .set({
        result: input.result,
        stopReason: input.stopReason,
        errorCode: input.errorCode,
        finishedAt: input.finishedAt,
        durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        cacheReadTokens: input.usage.cacheReadTokens,
        cacheWriteTokens: input.usage.cacheWriteTokens,
        cacheWrite1hTokens: input.usage.cacheWrite1hTokens,
        reasoningTokens: input.usage.reasoningTokens,
        totalTokens: input.usage.totalTokens,
        costInput: input.cost?.input ?? null,
        costOutput: input.cost?.output ?? null,
        costCacheRead: input.cost?.cacheRead ?? null,
        costCacheWrite: input.cost?.cacheWrite ?? null,
        costTotal: input.cost?.total ?? null,
        costCurrency: input.cost?.currency ?? null,
      })
      .where(
        and(eq(aiModelCalls.id, input.id), eq(aiModelCalls.result, "running")),
      )
      .run();
  }

  function beginToolExecution(input: BeginAiToolExecutionInput): void {
    db.insert(aiToolExecutions)
      .values({ ...input, status: "running" })
      .run();
  }

  function finalizeToolExecution(input: FinalizeAiToolExecutionInput): void {
    db.update(aiToolExecutions)
      .set({
        status: input.status,
        errorCode: input.errorCode,
        finishedAt: input.finishedAt,
        durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      })
      .where(
        and(
          eq(aiToolExecutions.id, input.id),
          eq(aiToolExecutions.status, "running"),
        ),
      )
      .run();
  }

  function listModelCalls(query: AiModelCallAuditQuery) {
    const conditions = [];
    if (query.userId) conditions.push(eq(aiModelCalls.userId, query.userId));
    if (query.providerId)
      conditions.push(eq(aiModelCalls.providerId, query.providerId));
    if (query.modelId) conditions.push(eq(aiModelCalls.modelId, query.modelId));
    if (query.result) conditions.push(eq(aiModelCalls.result, query.result));
    if (query.requestId)
      conditions.push(eq(aiModelCalls.requestId, query.requestId));
    if (query.from)
      conditions.push(gte(aiModelCalls.startedAt, new Date(query.from)));
    if (query.to)
      conditions.push(lte(aiModelCalls.startedAt, new Date(query.to)));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const countRow = db
      .select({ value: count() })
      .from(aiModelCalls)
      .where(whereClause)
      .get();
    const total = countRow?.value ?? 0;
    const items = db
      .select()
      .from(aiModelCalls)
      .where(whereClause)
      .orderBy(desc(aiModelCalls.startedAt), desc(aiModelCalls.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all();
    return { items, total };
  }

  function findModelCall(id: string): AiModelCallRecord | undefined {
    return db.select().from(aiModelCalls).where(eq(aiModelCalls.id, id)).get();
  }

  function listToolExecutions(aiCallId: string): AiToolExecutionRecord[] {
    return db
      .select()
      .from(aiToolExecutions)
      .where(eq(aiToolExecutions.aiCallId, aiCallId))
      .orderBy(aiToolExecutions.startedAt, aiToolExecutions.id)
      .all();
  }

  return {
    beginModelCall,
    beginToolExecution,
    finalizeModelCall,
    finalizeToolExecution,
    findModelCall,
    listModelCalls,
    listToolExecutions,
    recoverInterrupted,
  };
}

export type AiUsageAuditRepository = ReturnType<
  typeof createAiUsageAuditRepository
>;
