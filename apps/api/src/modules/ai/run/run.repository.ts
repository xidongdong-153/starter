import { and, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import { aiAgentRuns, aiAgentSessions } from "@api/modules/ai/ai.schema.js";

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
  findOwned: (
    runId: string,
    sessionId: string,
    ownerId: string,
  ) => AiAgentRunRecord | undefined;
  findById: (id: string) => AiAgentRunRecord | undefined;
  /** starting -> running 条件更新；返回是否更新成功。 */
  markRunning: (id: string, now: Date) => boolean;
  /** 非终态条件更新到终态；返回是否更新成功。已存在终态时返回 false。 */
  updateTerminal: (input: AiAgentRunTerminalInput) => boolean;
  /** 非终态 Run 列表，供启动恢复扫描。 */
  listNonTerminal: () => AiAgentRunRecord[];
}

export function createAiAgentRunRepository(
  db: AppDatabase,
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

  function findOwned(
    runId: string,
    sessionId: string,
    ownerId: string,
  ): AiAgentRunRecord | undefined {
    const row = db
      .select({ run: aiAgentRuns })
      .from(aiAgentRuns)
      .innerJoin(
        aiAgentSessions,
        and(
          eq(aiAgentRuns.sessionId, aiAgentSessions.id),
          eq(aiAgentRuns.sessionId, sessionId),
        ),
      )
      .where(
        and(eq(aiAgentRuns.id, runId), eq(aiAgentSessions.ownerId, ownerId)),
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
    findOwned,
    findById,
    markRunning,
    updateTerminal,
    listNonTerminal,
  };
}
