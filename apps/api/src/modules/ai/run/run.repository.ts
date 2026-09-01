import { and, desc, eq, sql } from "drizzle-orm";
import { runEventSchema, type RunEvent } from "@starter/contracts";
import { generateId } from "@api/shared/id.js";
import type { RunEventDraft } from "./run-event.repository.js";

import type { AppDatabase } from "@api/infra/db/client.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";
import {
  aiAgentRuns,
  aiAgentSessions,
  aiRunEvents,
} from "@api/modules/ai/ai.schema.js";
import type { AiAgentSessionRepository } from "../session/session.repository.js";

export type AiAgentRunRecord = typeof aiAgentRuns.$inferSelect;

export interface AiAgentRunCreateInput {
  id: string;
  sessionId: string;
  /** 预设 Agent 启动时非空；内联配置启动为 NULL。 */
  agentId: string | null;
  lane: string;
  agentRevision: number | null;
  snapshotJson: string;
  requestId: string;
  now: Date;
  idempotencyKey?: string;
  idempotencyScope?: string;
}

export interface AiAgentRunTerminalInput {
  id: string;
  status: "completed" | "failed" | "aborted" | "interrupted";
  finalEntryId: string | null;
  errorCode: string | null;
  finishedAt: Date;
}

export interface AiAgentRunRepository {
  create: (input: AiAgentRunCreateInput) => AiAgentRunRecord;
  findInScope: (
    runId: string,
    sessionId: string,
    access: RuntimeAccessContext,
  ) => AiAgentRunRecord | undefined;
  findActiveInScope: (
    sessionId: string,
    lane: string,
    access: RuntimeAccessContext,
  ) => AiAgentRunRecord | undefined;
  findById: (id: string) => AiAgentRunRecord | undefined;
  /** 按 scope + key 查幂等命中的 Run；部分唯一索引 (scope, key) WHERE key IS NOT NULL 覆盖。 */
  findByIdempotencyKey: (
    scope: string,
    key: string,
  ) => AiAgentRunRecord | undefined;
  markRunning: (id: string, now: Date) => boolean;
  completeWithTerminalEvent: (
    input: AiAgentRunTerminalInput & { event: RunEventDraft },
  ) => RunEvent | false;
  listNonTerminal: () => AiAgentRunRecord[];
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
        status: "starting",
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
      })
      .run();
    return findById(input.id)!;
  }

  function findInScope(
    runId: string,
    sessionId: string,
    access: RuntimeAccessContext,
  ): AiAgentRunRecord | undefined {
    if (
      sessionRepository &&
      !sessionRepository.findInScope(sessionId, access)
    ) {
      return undefined;
    }
    const row = db
      .select({ run: aiAgentRuns })
      .from(aiAgentRuns)
      .innerJoin(aiAgentSessions, eq(aiAgentRuns.sessionId, aiAgentSessions.id))
      .where(
        and(eq(aiAgentRuns.id, runId), eq(aiAgentRuns.sessionId, sessionId)),
      )
      .get();
    return row?.run;
  }

  /** 只取 starting / running；interrupted 是进程重启后的落地状态，不算在跑。 */
  function findActiveInScope(
    sessionId: string,
    lane: string,
    access: RuntimeAccessContext,
  ): AiAgentRunRecord | undefined {
    if (
      sessionRepository &&
      !sessionRepository.findInScope(sessionId, access)
    ) {
      return undefined;
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
      .get();
  }

  function findById(id: string): AiAgentRunRecord | undefined {
    return db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, id)).get();
  }

  function findByIdempotencyKey(
    scope: string,
    key: string,
  ): AiAgentRunRecord | undefined {
    return db
      .select()
      .from(aiAgentRuns)
      .where(
        and(
          eq(aiAgentRuns.idempotencyScope, scope),
          eq(aiAgentRuns.idempotencyKey, key),
        ),
      )
      .get();
  }

  function markRunning(id: string, now: Date): boolean {
    const result = db
      .update(aiAgentRuns)
      .set({ status: "running", startedAt: now })
      .where(and(eq(aiAgentRuns.id, id), eq(aiAgentRuns.status, "starting")))
      .run();
    return result.changes > 0;
  }

  function completeWithTerminalEvent(
    input: AiAgentRunTerminalInput & { event: RunEventDraft },
  ): RunEvent | false {
    return db.transaction((tx) => {
      const updated = tx
        .update(aiAgentRuns)
        .set({
          status: input.status,
          finalEntryId: input.finalEntryId,
          errorCode: input.errorCode,
          finishedAt: input.finishedAt,
        })
        .where(
          and(
            eq(aiAgentRuns.id, input.id),
            sql`${aiAgentRuns.status} IN ('starting', 'running')`,
          ),
        )
        .run();
      if (updated.changes === 0) return false;
      const sequenceRow = tx
        .select({
          value: sql<number>`coalesce(max(${aiRunEvents.sequence}), 0) + 1`,
        })
        .from(aiRunEvents)
        .where(eq(aiRunEvents.runId, input.id))
        .get();
      const event = runEventSchema.parse({
        ...input.event,
        eventId: input.event.eventId ?? generateId(),
        sequence: sequenceRow?.value ?? 1,
        occurredAt: input.event.occurredAt ?? input.finishedAt.toISOString(),
      });
      tx.insert(aiRunEvents)
        .values({
          eventId: event.eventId,
          runId: event.runId,
          sequence: event.sequence,
          type: event.type,
          payloadJson: JSON.stringify(event),
          occurredAt: new Date(event.occurredAt),
        })
        .run();
      return event;
    });
  }

  function listNonTerminal(): AiAgentRunRecord[] {
    return db
      .select()
      .from(aiAgentRuns)
      .where(sql`${aiAgentRuns.status} IN ('starting', 'running')`)
      .all();
  }

  return {
    create,
    findInScope,
    findActiveInScope,
    findById,
    findByIdempotencyKey,
    markRunning,
    completeWithTerminalEvent,
    listNonTerminal,
  };
}
