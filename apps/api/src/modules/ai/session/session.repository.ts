import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import {
  aiAgentDefinitions,
  aiAgentSessions,
} from "@api/modules/ai/ai.schema.js";

export type AiAgentSessionRecord = typeof aiAgentSessions.$inferSelect;

export interface AiAgentSessionListResult {
  items: AiAgentSessionRecord[];
  total: number;
}

export type DefaultAgentStatus = "enabled" | "present" | "missing";

export type AiAgentSessionArchiveResult =
  | { status: "archived"; record: AiAgentSessionRecord }
  | { status: "already_archived"; record: AiAgentSessionRecord }
  | { status: "not_found" };

export interface AiAgentSessionRepository {
  create: (input: {
    id: string;
    ownerId: string;
    title: string;
    defaultAgentId: string | null;
    now: Date;
  }) => AiAgentSessionRecord;
  findOwned: (id: string, ownerId: string) => AiAgentSessionRecord | undefined;
  listOwnedActive: (
    ownerId: string,
    page: number,
    pageSize: number,
  ) => AiAgentSessionListResult;
  updateOwned: (input: {
    id: string;
    ownerId: string;
    title?: string;
    defaultAgentId?: string | null;
    now: Date;
  }) => AiAgentSessionRecord | undefined;
  archiveOwned: (
    id: string,
    ownerId: string,
    now: Date,
  ) => AiAgentSessionArchiveResult;
  findDefaultAgentStatus: (id: string) => DefaultAgentStatus;
  /** 主库全部 Session id（含已归档），供一致性检查与 Pi 侧对比。 */
  listAllIds: () => string[];
}

export function createAiAgentSessionRepository(
  db: AppDatabase,
): AiAgentSessionRepository {
  function create(input: {
    id: string;
    ownerId: string;
    title: string;
    defaultAgentId: string | null;
    now: Date;
  }): AiAgentSessionRecord {
    return db
      .insert(aiAgentSessions)
      .values({
        id: input.id,
        ownerId: input.ownerId,
        title: input.title,
        defaultAgentId: input.defaultAgentId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
      .get();
  }

  function findOwned(
    id: string,
    ownerId: string,
  ): AiAgentSessionRecord | undefined {
    return db
      .select()
      .from(aiAgentSessions)
      .where(
        and(eq(aiAgentSessions.id, id), eq(aiAgentSessions.ownerId, ownerId)),
      )
      .get();
  }

  function listOwnedActive(
    ownerId: string,
    page: number,
    pageSize: number,
  ): AiAgentSessionListResult {
    const where = and(
      eq(aiAgentSessions.ownerId, ownerId),
      isNull(aiAgentSessions.archivedAt),
    );
    const countRow = db
      .select({ count: sql<number>`count(*)` })
      .from(aiAgentSessions)
      .where(where)
      .get();
    const total = countRow?.count ?? 0;
    const items = db
      .select()
      .from(aiAgentSessions)
      .where(where)
      .orderBy(desc(aiAgentSessions.updatedAt), desc(aiAgentSessions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    return { items, total };
  }

  function updateOwned(input: {
    id: string;
    ownerId: string;
    title?: string;
    defaultAgentId?: string | null;
    now: Date;
  }): AiAgentSessionRecord | undefined {
    return db
      .update(aiAgentSessions)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.defaultAgentId !== undefined
          ? { defaultAgentId: input.defaultAgentId }
          : {}),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(aiAgentSessions.id, input.id),
          eq(aiAgentSessions.ownerId, input.ownerId),
          isNull(aiAgentSessions.archivedAt),
        ),
      )
      .returning()
      .get();
  }

  function archiveOwned(
    id: string,
    ownerId: string,
    now: Date,
  ): AiAgentSessionArchiveResult {
    const updated = db
      .update(aiAgentSessions)
      .set({ archivedAt: now })
      .where(
        and(
          eq(aiAgentSessions.id, id),
          eq(aiAgentSessions.ownerId, ownerId),
          isNull(aiAgentSessions.archivedAt),
        ),
      )
      .returning()
      .get();
    if (updated) return { status: "archived", record: updated };
    const existing = findOwned(id, ownerId);
    if (!existing) return { status: "not_found" };
    return { status: "already_archived", record: existing };
  }

  function findDefaultAgentStatus(id: string): DefaultAgentStatus {
    const row = db
      .select({ status: aiAgentDefinitions.status })
      .from(aiAgentDefinitions)
      .where(eq(aiAgentDefinitions.id, id))
      .get();
    if (!row) return "missing";
    return row.status === "enabled" ? "enabled" : "present";
  }

  function listAllIds(): string[] {
    return db
      .select({ id: aiAgentSessions.id })
      .from(aiAgentSessions)
      .all()
      .map((row) => row.id);
  }

  return {
    create,
    findOwned,
    listOwnedActive,
    updateOwned,
    archiveOwned,
    findDefaultAgentStatus,
    listAllIds,
  };
}
