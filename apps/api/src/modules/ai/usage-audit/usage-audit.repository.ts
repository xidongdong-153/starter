import type {
  AiCost,
  AiModelCallAuditQuery,
  AiModelCallResult,
  AiToolExecutionAuditStatus,
  AiUsage,
} from '@starter/contracts'
import type { AppDatabase } from '@api/infra/db/client.js'
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'

import { aiModelCalls, aiToolExecutions } from '../ai.schema.js'

export type AiModelCallRecord = typeof aiModelCalls.$inferSelect
export type AiToolExecutionRecord = typeof aiToolExecutions.$inferSelect

export interface BeginAiModelCallInput {
  id: string
  requestId: string
  userId: string
  appId?: string | null
  tenantId?: string
  projectId?: string
  externalUserId?: string | null
  principalKind?: string
  scenario: 'model_test' | 'agent_run' | 'completion' | 'legacy'
  runId: string | null
  turnId?: string | null
  stepId?: string | null
  providerId: string
  modelId: string
  api?: string | null
  startedAt: Date
  timeoutMs: number
}

export interface FinalizeAiModelCallInput {
  id: string
  finishedAt: Date
  startedAt: Date
  result: Exclude<AiModelCallResult, 'running'>
  stopReason: AiModelCallRecord['stopReason']
  errorCode: string | null
  usage: AiUsage
  cost: AiCost | null
  /** 首个模型输出相对请求开始的毫秒数；没有输出时为 null。 */
  ttftMs?: number | null
  chunkCount?: number | null
  responseModel?: string | null
  responseId?: string | null
  httpStatus?: number | null
}

export interface BeginAiToolExecutionInput {
  id: string
  modelCallId: string
  runId?: string | null
  turnId?: string | null
  stepId?: string | null
  toolCallId?: string | null
  toolExecutionId?: string | null
  requestId?: string
  toolName: string
  toolVersion: string | null
  startedAt: Date
  timeoutMs: number
  /** 稳定幂等 token：sha256(canonicalJson({runId, attemptNo, toolExecutionId}))。 */
  idempotencyToken?: string | null
}

export interface FinalizeAiToolExecutionInput {
  id: string
  finishedAt: Date
  startedAt: Date
  status: Exclude<AiToolExecutionAuditStatus, 'running'>
  errorCode: string | null
}

export function createAiUsageAuditRepository(db: AppDatabase) {
  function recoverInterrupted(now: Date): void {
    db.transaction((tx) => {
      tx.update(aiModelCalls)
        .set({
          result: 'interrupted',
          stopReason: 'deferred',
          finishedAt: now,
          durationMs: null,
          errorCode: null,
        })
        .where(
          and(
            eq(aiModelCalls.result, 'running'),
            sql`${aiModelCalls.startedAt} + ${aiModelCalls.timeoutMs} + 5000 <= ${now.getTime()}`,
          ),
        )
        .run()
      tx.update(aiToolExecutions)
        .set({
          status: 'interrupted',
          finishedAt: now,
          durationMs: null,
          errorCode: null,
        })
        .where(
          and(
            eq(aiToolExecutions.status, 'running'),
            sql`${aiToolExecutions.startedAt} + ${aiToolExecutions.timeoutMs} + 5000 <= ${now.getTime()}`,
          ),
        )
        .run()
    })
  }

  function beginModelCall(input: BeginAiModelCallInput): void {
    db.insert(aiModelCalls)
      .values({ ...input, result: 'running' })
      .run()
  }

  function finalizeModelCall(input: FinalizeAiModelCallInput): void {
    db.update(aiModelCalls)
      .set({
        result: input.result,
        stopReason: input.stopReason,
        errorCode: input.errorCode,
        finishedAt: input.finishedAt,
        durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
        ttftMs: input.ttftMs ?? null,
        chunkCount: input.chunkCount ?? null,
        responseModel: input.responseModel ?? null,
        responseId: input.responseId ?? null,
        httpStatus: input.httpStatus ?? null,
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
      .where(and(eq(aiModelCalls.id, input.id), eq(aiModelCalls.result, 'running')))
      .run()
  }

  function beginToolExecution(input: BeginAiToolExecutionInput): void {
    db.insert(aiToolExecutions)
      .values({
        id: input.id,
        runId: input.runId ?? null,
        turnId: input.turnId ?? null,
        stepId: input.stepId ?? null,
        toolCallId: input.toolCallId ?? null,
        toolExecutionId: input.toolExecutionId ?? input.id,
        modelCallId: input.modelCallId,
        toolName: input.toolName,
        toolVersion: input.toolVersion,
        idempotencyToken: input.idempotencyToken ?? null,
        timeoutMs: input.timeoutMs,
        startedAt: input.startedAt,
        status: 'running',
      })
      .run()
  }

  function finalizeToolExecution(input: FinalizeAiToolExecutionInput): void {
    db.update(aiToolExecutions)
      .set({
        status: input.status,
        errorCode: input.errorCode,
        finishedAt: input.finishedAt,
        durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      })
      .where(and(eq(aiToolExecutions.id, input.id), eq(aiToolExecutions.status, 'running')))
      .run()
  }

  function listModelCalls(query: AiModelCallAuditQuery) {
    const conditions = []
    if (query.userId) conditions.push(eq(aiModelCalls.userId, query.userId))
    if (query.appId) conditions.push(eq(aiModelCalls.appId, query.appId))
    if (query.tenantId) conditions.push(eq(aiModelCalls.tenantId, query.tenantId))
    if (query.projectId) conditions.push(eq(aiModelCalls.projectId, query.projectId))
    if (query.externalUserId) conditions.push(eq(aiModelCalls.externalUserId, query.externalUserId))
    if (query.providerId) conditions.push(eq(aiModelCalls.providerId, query.providerId))
    if (query.modelId) conditions.push(eq(aiModelCalls.modelId, query.modelId))
    if (query.result) conditions.push(eq(aiModelCalls.result, query.result))
    if (query.requestId) conditions.push(eq(aiModelCalls.requestId, query.requestId))
    if (query.from) conditions.push(gte(aiModelCalls.startedAt, new Date(query.from)))
    if (query.to) conditions.push(lte(aiModelCalls.startedAt, new Date(query.to)))
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined
    const countRow = db.select({ value: count() }).from(aiModelCalls).where(whereClause).get()
    const total = countRow?.value ?? 0
    const items = db
      .select()
      .from(aiModelCalls)
      .where(whereClause)
      .orderBy(desc(aiModelCalls.startedAt), desc(aiModelCalls.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all()
    return { items, total }
  }

  function findModelCall(id: string): AiModelCallRecord | undefined {
    return db.select().from(aiModelCalls).where(eq(aiModelCalls.id, id)).get()
  }

  function listToolExecutions(modelCallId: string): AiToolExecutionRecord[] {
    return db
      .select()
      .from(aiToolExecutions)
      .where(eq(aiToolExecutions.modelCallId, modelCallId))
      .orderBy(aiToolExecutions.startedAt, aiToolExecutions.id)
      .all()
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
  }
}

export type AiUsageAuditRepository = ReturnType<typeof createAiUsageAuditRepository>
