import { eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import { aiAttachments } from "@api/modules/ai/ai.schema.js";

export type AiAttachmentRecord = typeof aiAttachments.$inferSelect;
export type AiAttachmentInsert = typeof aiAttachments.$inferInsert;

export interface AiAttachmentRepository {
  create: (input: AiAttachmentInsert) => AiAttachmentRecord;
  findById: (id: string) => AiAttachmentRecord | undefined;
  findByIds: (ids: string[]) => AiAttachmentRecord[];
  deleteById: (id: string) => AiAttachmentRecord | undefined;
}

export function createAiAttachmentRepository(
  db: AppDatabase,
): AiAttachmentRepository {
  function create(input: AiAttachmentInsert): AiAttachmentRecord {
    return db.insert(aiAttachments).values(input).returning().get();
  }

  function findById(id: string): AiAttachmentRecord | undefined {
    return db
      .select()
      .from(aiAttachments)
      .where(eq(aiAttachments.id, id))
      .get();
  }

  function findByIds(ids: string[]): AiAttachmentRecord[] {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(aiAttachments)
      .where(inArray(aiAttachments.id, ids))
      .all();
  }

  function deleteById(id: string): AiAttachmentRecord | undefined {
    return db
      .delete(aiAttachments)
      .where(eq(aiAttachments.id, id))
      .returning()
      .get();
  }

  return { create, findById, findByIds, deleteById };
}
