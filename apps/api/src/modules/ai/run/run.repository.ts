import { and, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";
import { aiAgentRuns, aiAgentSessions } from "@api/modules/ai/ai.schema.js";
import type { AiAgentSessionRepository } from "../session/session.repository.js";

export type AiAgentRunRecord = typeof aiAgentRuns.$inferSelect;

export interface AiAgentRunCreateInput {
  id: string;
  sessionId: string;
  agentId: string;
  lane: string;
  agentRevision: number;
  snapshotJson: string;
  requestId: string;
  now: Date;
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
  findById: (id: string) => AiAgentRunRecord | undefined;
  markRunning: (id: string, now: Date) => boolean;
  updateTerminal: (input: AiAgentRunTerminalInput) => boolean;
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

  function findById(id: string): AiAgentRunRecord | undefined {
    return db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, id)).get();
  }

  function markRunning(id: string, now: Date): boolean {
    const result = db
      .update(aiAgentRuns)
      .set({ status: "running", startedAt: now })
      .where(and(eq(aiAgentRuns.id, id), eq(aiAgentRuns.status, "starting")))
      .run();
    return result.changes > 0;
  }

  function updateTerminal(input: AiAgentRunTerminalInput): boolean {
    const result = db
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
    return result.changes > 0;
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
    findById,
    markRunning,
    updateTerminal,
    listNonTerminal,
  };
}
