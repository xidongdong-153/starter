import { and, asc, eq } from 'drizzle-orm'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiRunAttempts } from '../ai.schema.js'

export type AiRunAttemptRecord = typeof aiRunAttempts.$inferSelect

export type AiRunAttemptStatus = 'running' | 'succeeded' | 'failed' | 'aborted' | 'interrupted'

export interface AiRunAttemptCreateInput {
  id: string
  runId: string
  attemptNo: number
  trigger: 'initial' | 'auto_retry'
  /** auto_retry 时记录触发重试的上一轮错误码；initial 省略。 */
  retryReason?: string
  ownerId: string
  fencingToken: number
  startedAt: Date
}

export interface AiRunAttemptCompleteInput {
  runId: string
  attemptNo: number
  status: Exclude<AiRunAttemptStatus, 'running'>
  errorCode: string | null
  finishedAt: Date
}

export interface AiRunAttemptRepository {
  create: (input: AiRunAttemptCreateInput) => AiRunAttemptRecord
  /** 条件终态更新：仅 running 行可落终态，重入或已收尾的行返回 false。 */
  complete: (input: AiRunAttemptCompleteInput) => boolean
  listByRunId: (runId: string) => AiRunAttemptRecord[]
}

export function createAiRunAttemptRepository(db: AppDatabase): AiRunAttemptRepository {
  function create(input: AiRunAttemptCreateInput): AiRunAttemptRecord {
    db.insert(aiRunAttempts)
      .values({
        id: input.id,
        runId: input.runId,
        attemptNo: input.attemptNo,
        status: 'running',
        trigger: input.trigger,
        ...(input.retryReason !== undefined ? { retryReason: input.retryReason } : {}),
        ownerId: input.ownerId,
        fencingToken: input.fencingToken,
        errorCode: null,
        startedAt: input.startedAt,
        finishedAt: null,
      })
      .run()
    const record = db.select().from(aiRunAttempts).where(eq(aiRunAttempts.id, input.id)).get()
    if (!record) throw new Error(`ai_run_attempts 行创建后读取失败: ${input.id}`)
    return record
  }

  function complete(input: AiRunAttemptCompleteInput): boolean {
    const result = db
      .update(aiRunAttempts)
      .set({ status: input.status, errorCode: input.errorCode, finishedAt: input.finishedAt })
      .where(
        and(
          eq(aiRunAttempts.runId, input.runId),
          eq(aiRunAttempts.attemptNo, input.attemptNo),
          eq(aiRunAttempts.status, 'running'),
        ),
      )
      .run()
    return result.changes > 0
  }

  function listByRunId(runId: string): AiRunAttemptRecord[] {
    return db
      .select()
      .from(aiRunAttempts)
      .where(eq(aiRunAttempts.runId, runId))
      .orderBy(asc(aiRunAttempts.attemptNo))
      .all()
  }

  return { create, complete, listByRunId }
}
