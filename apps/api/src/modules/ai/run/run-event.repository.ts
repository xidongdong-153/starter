import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { runEventSchema, type RunEvent } from '@starter/contracts'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiRunEvents } from '@api/modules/ai/ai.schema.js'
import { generateId } from '@api/shared/id.js'
import { parseStoredJson } from '@api/shared/stored-json.js'

/**
 * 事件草稿：生产者只填 envelope 关联字段和 data，
 * `eventId`、`sequence` 和 `occurredAt` 由 Publisher 分配。
 * 用分发式 Omit 保留 discriminated union，消费方可以按 `type` 收窄 `data`。
 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

export type RunEventDraft = {
  eventId?: string
  sequence?: number
  occurredAt?: string
} & DistributiveOmit<RunEvent, 'eventId' | 'sequence' | 'occurredAt'>

export interface AiRunEventRepository {
  append: (draft: RunEventDraft) => RunEvent
  listAfter: (runId: string, afterSequence: number, limit: number) => RunEvent[]
  findSequenceByEventId: (runId: string, eventId: string) => number | undefined
  watermark: (runId: string) => number
}

export function createAiRunEventRepository(db: AppDatabase): AiRunEventRepository {
  function append(draft: RunEventDraft): RunEvent {
    return db.transaction((tx) => {
      const event = runEventSchema.parse({
        ...draft,
        eventId: draft.eventId ?? generateId(),
        sequence: nextSequence(tx, draft.runId),
        occurredAt: draft.occurredAt ?? new Date().toISOString(),
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

  function listAfter(runId: string, afterSequence: number, limit: number): RunEvent[] {
    return db
      .select()
      .from(aiRunEvents)
      .where(and(eq(aiRunEvents.runId, runId), gt(aiRunEvents.sequence, afterSequence)))
      .orderBy(asc(aiRunEvents.sequence))
      .limit(limit)
      .all()
      .map((row) =>
        parseStoredJson({
          column: 'ai_run_events.payload_json',
          json: row.payloadJson,
          schema: runEventSchema,
        }),
      )
  }

  function findSequenceByEventId(runId: string, eventId: string): number | undefined {
    const row = db
      .select({ sequence: aiRunEvents.sequence })
      .from(aiRunEvents)
      .where(and(eq(aiRunEvents.runId, runId), eq(aiRunEvents.eventId, eventId)))
      .get()
    return row?.sequence
  }

  function watermark(runId: string): number {
    const row = db
      .select({
        sequence: sql<number>`coalesce(max(${aiRunEvents.sequence}), 0)`,
      })
      .from(aiRunEvents)
      .where(eq(aiRunEvents.runId, runId))
      .get()
    return row?.sequence ?? 0
  }

  return { append, listAfter, findSequenceByEventId, watermark }
}

function nextSequence(db: Pick<AppDatabase, 'select'>, runId: string): number {
  const row = db
    .select({
      sequence: sql<number>`coalesce(max(${aiRunEvents.sequence}), 0) + 1`,
    })
    .from(aiRunEvents)
    .where(eq(aiRunEvents.runId, runId))
    .get()
  return row?.sequence ?? 1
}
