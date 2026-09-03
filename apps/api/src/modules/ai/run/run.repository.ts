import { and, desc, eq, sql } from 'drizzle-orm'
import { ApiErrorCodes, runEventSchema, type RunEvent } from '@starter/contracts'
import { generateId } from '@api/shared/id.js'
import { toAiErrorCategory, isAiRetryableErrorCode } from '@api/modules/ai/ai-error.js'
import type { RunEventDraft } from './run-event.repository.js'

import type { AppDatabase } from '@api/infra/db/client.js'
import type { RuntimeAccessContext } from '@api/modules/ai/principal.js'
import {
  aiAgentLaneLeases,
  aiAgentRuns,
  aiAgentSessions,
  aiRunAttempts,
  aiRunEvents,
  aiRunSteps,
} from '@api/modules/ai/ai.schema.js'
import type { AiAgentSessionRepository } from '../session/session.repository.js'

export type AiAgentRunRecord = typeof aiAgentRuns.$inferSelect

export interface AiAgentRunCreateInput {
  id: string
  sessionId: string
  /** 预设 Agent 启动时非空；内联配置启动为 NULL。 */
  agentId: string | null
  lane: string
  agentRevision: number | null
  snapshotJson: string
  requestId: string
  now: Date
  idempotencyKey?: string
  idempotencyScope?: string
  /** acquire lane lease 时拿到的 fencing token；执行路径必传。 */
  executionFencingToken?: number
}

export interface AiAgentRunTerminalInput {
  id: string
  status: 'completed' | 'failed' | 'aborted' | 'interrupted'
  finalEntryId: string | null
  errorCode: string | null
  finishedAt: Date
  /**
   * 执行路径的 lease 归属校验：传入时在同一事务内比对 lease 行的
   * owner、token 与未过期状态，失配则终态强制 interrupted。
   * 恢复扫描路径不传（历史行 token 为 NULL 也跳过校验）。
   */
  lease?: { ownerId: string }
  /** 终态事务内同步收尾的当前 attempt（行 + agent Step）；执行与恢复路径都传。 */
  attempt?: { attemptNo: number }
}

export interface AiAgentRunRepository {
  create: (input: AiAgentRunCreateInput) => AiAgentRunRecord
  findInScope: (runId: string, sessionId: string, access: RuntimeAccessContext) => AiAgentRunRecord | undefined
  findActiveInScope: (sessionId: string, lane: string, access: RuntimeAccessContext) => AiAgentRunRecord | undefined
  findById: (id: string) => AiAgentRunRecord | undefined
  /** 按 scope + key 查幂等命中的 Run；部分唯一索引 (scope, key) WHERE key IS NOT NULL 覆盖。 */
  findByIdempotencyKey: (scope: string, key: string) => AiAgentRunRecord | undefined
  markRunning: (id: string, now: Date) => boolean
  completeWithTerminalEvent: (input: AiAgentRunTerminalInput & { event: RunEventDraft }) => RunEvent | false
  /** auto retry 追加 attempt 后同步 Run 行指针；仅非终态 Run 可更新。 */
  updateCurrentAttemptNo: (id: string, attemptNo: number) => boolean
  listNonTerminal: () => AiAgentRunRecord[]
}

export function createAiAgentRunRepository(
  db: AppDatabase,
  sessionRepository?: AiAgentSessionRepository,
): AiAgentRunRepository {
  function create(input: AiAgentRunCreateInput): AiAgentRunRecord {
    db.insert(aiAgentRuns)
      .values({
        id: input.id,
        sessionId: input.sessionId,
        agentId: input.agentId,
        lane: input.lane,
        status: 'starting',
        agentRevision: input.agentRevision,
        snapshotJson: input.snapshotJson,
        requestId: input.requestId,
        createdAt: input.now,
        ...(input.idempotencyKey !== undefined
          ? {
              idempotencyKey: input.idempotencyKey,
              idempotencyScope: input.idempotencyScope,
            }
          : {}),
        ...(input.executionFencingToken !== undefined ? { executionFencingToken: input.executionFencingToken } : {}),
      })
      .run()
    return findById(input.id)!
  }

  function findInScope(runId: string, sessionId: string, access: RuntimeAccessContext): AiAgentRunRecord | undefined {
    if (sessionRepository && !sessionRepository.findInScope(sessionId, access)) {
      return undefined
    }
    const row = db
      .select({ run: aiAgentRuns })
      .from(aiAgentRuns)
      .innerJoin(aiAgentSessions, eq(aiAgentRuns.sessionId, aiAgentSessions.id))
      .where(and(eq(aiAgentRuns.id, runId), eq(aiAgentRuns.sessionId, sessionId)))
      .get()
    return row?.run
  }

  /** 只取 starting / running；interrupted 是进程重启后的落地状态，不算在跑。 */
  function findActiveInScope(
    sessionId: string,
    lane: string,
    access: RuntimeAccessContext,
  ): AiAgentRunRecord | undefined {
    if (sessionRepository && !sessionRepository.findInScope(sessionId, access)) {
      return undefined
    }
    return db
      .select()
      .from(aiAgentRuns)
      .where(
        and(
          eq(aiAgentRuns.sessionId, sessionId),
          eq(aiAgentRuns.lane, lane),
          sql`${aiAgentRuns.status} IN ('starting', 'running')`,
        ),
      )
      .orderBy(desc(aiAgentRuns.createdAt))
      .get()
  }

  function findById(id: string): AiAgentRunRecord | undefined {
    return db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, id)).get()
  }

  function findByIdempotencyKey(scope: string, key: string): AiAgentRunRecord | undefined {
    return db
      .select()
      .from(aiAgentRuns)
      .where(and(eq(aiAgentRuns.idempotencyScope, scope), eq(aiAgentRuns.idempotencyKey, key)))
      .get()
  }

  function markRunning(id: string, now: Date): boolean {
    const result = db
      .update(aiAgentRuns)
      .set({ status: 'running', startedAt: now })
      .where(and(eq(aiAgentRuns.id, id), eq(aiAgentRuns.status, 'starting')))
      .run()
    return result.changes > 0
  }

  function completeWithTerminalEvent(input: AiAgentRunTerminalInput & { event: RunEventDraft }): RunEvent | false {
    return db.transaction((tx) => {
      const run = tx.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, input.id)).get()
      if (!run) return false
      let status = input.status
      let finalEntryId = input.finalEntryId
      let errorCode = input.errorCode
      let eventDraft = input.event
      // 执行路径的 fencing 校验：lease 已被接管或过期时，过期 owner 只能写 interrupted。
      if (input.lease && run.executionFencingToken !== null && !ownsActiveLaneLease(tx, run, input.lease)) {
        status = 'interrupted'
        finalEntryId = null
        errorCode = ApiErrorCodes.AI_RUN_INTERRUPTED
        eventDraft = fencedTerminalEvent(run)
      }
      const updated = tx
        .update(aiAgentRuns)
        .set({
          status,
          finalEntryId,
          errorCode,
          finishedAt: input.finishedAt,
        })
        .where(and(eq(aiAgentRuns.id, input.id), sql`${aiAgentRuns.status} IN ('starting', 'running')`))
        .run()
      if (updated.changes === 0) return false
      // 同一事务内收尾当前 attempt 行与它的顶层 agent Step：
      // fenced 改写后的 interrupted 也在这里落，保证 outcome 与 Run 终态一致。
      if (input.attempt) {
        const attemptStatus = status === 'completed' ? 'succeeded' : status
        tx.update(aiRunAttempts)
          .set({ status: attemptStatus, errorCode, finishedAt: input.finishedAt })
          .where(
            and(
              eq(aiRunAttempts.runId, input.id),
              eq(aiRunAttempts.attemptNo, input.attempt.attemptNo),
              eq(aiRunAttempts.status, 'running'),
            ),
          )
          .run()
        tx.update(aiRunSteps)
          .set({ outcome: attemptStatus, errorCode, finishedAt: input.finishedAt })
          .where(
            and(
              eq(aiRunSteps.runId, input.id),
              eq(aiRunSteps.attemptNo, input.attempt.attemptNo),
              eq(aiRunSteps.kind, 'agent'),
            ),
          )
          .run()
      }
      if (status === 'interrupted') {
        // 兜底扫尾：其余 running attempt 行与 running agent Step 一并落 interrupted。
        tx.update(aiRunAttempts)
          .set({
            status: 'interrupted',
            errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
            finishedAt: input.finishedAt,
          })
          .where(and(eq(aiRunAttempts.runId, input.id), eq(aiRunAttempts.status, 'running')))
          .run()
        tx.update(aiRunSteps)
          .set({
            outcome: 'interrupted',
            errorCode: ApiErrorCodes.AI_RUN_INTERRUPTED,
            finishedAt: input.finishedAt,
          })
          .where(and(eq(aiRunSteps.runId, input.id), eq(aiRunSteps.kind, 'agent'), eq(aiRunSteps.outcome, 'running')))
          .run()
      }
      const sequenceRow = tx
        .select({
          value: sql<number>`coalesce(max(${aiRunEvents.sequence}), 0) + 1`,
        })
        .from(aiRunEvents)
        .where(eq(aiRunEvents.runId, input.id))
        .get()
      const event = runEventSchema.parse({
        ...eventDraft,
        eventId: eventDraft.eventId ?? generateId(),
        sequence: sequenceRow?.value ?? 1,
        occurredAt: eventDraft.occurredAt ?? input.finishedAt.toISOString(),
      })
      tx.insert(aiRunEvents)
        .values({
          eventId: event.eventId,
          runId: event.runId,
          sequence: event.sequence,
          type: event.type,
          payloadJson: JSON.stringify(event),
          occurredAt: new Date(event.occurredAt),
        })
        .run()
      return event
    })
  }

  function listNonTerminal(): AiAgentRunRecord[] {
    return db
      .select()
      .from(aiAgentRuns)
      .where(sql`${aiAgentRuns.status} IN ('starting', 'running')`)
      .all()
  }

  function updateCurrentAttemptNo(id: string, attemptNo: number): boolean {
    const result = db
      .update(aiAgentRuns)
      .set({ currentAttemptNo: attemptNo })
      .where(and(eq(aiAgentRuns.id, id), sql`${aiAgentRuns.status} IN ('starting', 'running')`))
      .run()
    return result.changes > 0
  }

  return {
    create,
    findInScope,
    findActiveInScope,
    findById,
    findByIdempotencyKey,
    markRunning,
    completeWithTerminalEvent,
    updateCurrentAttemptNo,
    listNonTerminal,
  }
}

/** lease 行仍是该 owner 持有且未过期：owner、token 都匹配才通过。 */
function ownsActiveLaneLease(
  tx: Pick<AppDatabase, 'select'>,
  run: AiAgentRunRecord,
  expected: { ownerId: string },
): boolean {
  const lease = tx
    .select()
    .from(aiAgentLaneLeases)
    .where(and(eq(aiAgentLaneLeases.sessionId, run.sessionId), eq(aiAgentLaneLeases.lane, run.lane)))
    .get()
  return (
    lease !== undefined &&
    lease.ownerId === expected.ownerId &&
    lease.fencingToken === run.executionFencingToken &&
    lease.leaseUntil > Date.now()
  )
}

/** 被接管 owner 的终态事件：固定 run.failed + AI_RUN_INTERRUPTED，丢弃实际执行结果。 */
function fencedTerminalEvent(run: AiAgentRunRecord): RunEventDraft {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    lane: run.lane,
    attemptNo: run.currentAttemptNo,
    turnIndex: null,
    stepId: null,
    modelCallId: null,
    messageId: null,
    toolCallId: null,
    toolExecutionId: null,
    type: 'run.failed',
    data: {
      error: {
        code: ApiErrorCodes.AI_RUN_INTERRUPTED,
        category: toAiErrorCategory(ApiErrorCodes.AI_RUN_INTERRUPTED),
        retryable: isAiRetryableErrorCode(ApiErrorCodes.AI_RUN_INTERRUPTED),
      },
      finalEntryId: null,
    },
  }
}
