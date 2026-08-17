import { and, asc, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import { aiSkills } from "@api/modules/ai/ai.schema.js";

export type AiSkillRecord = typeof aiSkills.$inferSelect;

export interface AiSkillDescription {
  name: string;
  description: string;
}

export interface AiSkillRepository {
  createSkill: (input: {
    id: string;
    name: string;
    description: string;
    content: string;
    enabled: boolean;
    actorId: string | null;
    now: Date;
  }) => AiSkillRecord;
  updateSkill: (input: {
    id: string;
    name?: string;
    description?: string;
    content?: string;
    enabled?: boolean;
    actorId: string | null;
    now: Date;
  }) => AiSkillRecord | null;
  deleteSkill: (id: string) => boolean;
  findSkillById: (id: string) => AiSkillRecord | undefined;
  findEnabledSkillByName: (name: string) => AiSkillRecord | undefined;
  listSkills: () => AiSkillRecord[];
  listEnabledDescriptions: () => AiSkillDescription[];
}

export function createAiSkillRepository(db: AppDatabase): AiSkillRepository {
  return {
    createSkill(input) {
      db.insert(aiSkills)
        .values({
          id: input.id,
          name: input.name,
          description: input.description,
          content: input.content,
          enabled: input.enabled,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
      return db.select().from(aiSkills).where(eq(aiSkills.id, input.id)).get()!;
    },
    updateSkill(input) {
      db.update(aiSkills)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          updatedBy: input.actorId,
          updatedAt: input.now,
        })
        .where(eq(aiSkills.id, input.id))
        .run();
      return (
        db.select().from(aiSkills).where(eq(aiSkills.id, input.id)).get() ??
        null
      );
    },
    deleteSkill(id) {
      const result = db.delete(aiSkills).where(eq(aiSkills.id, id)).run();
      return result.changes > 0;
    },
    findSkillById(id) {
      return db.select().from(aiSkills).where(eq(aiSkills.id, id)).get();
    },
    findEnabledSkillByName(name) {
      return db
        .select()
        .from(aiSkills)
        .where(and(eq(aiSkills.name, name), eq(aiSkills.enabled, true)))
        .get();
    },
    listSkills() {
      return db.select().from(aiSkills).orderBy(desc(aiSkills.updatedAt)).all();
    },
    listEnabledDescriptions() {
      return db
        .select({ name: aiSkills.name, description: aiSkills.description })
        .from(aiSkills)
        .where(eq(aiSkills.enabled, true))
        .orderBy(asc(aiSkills.createdAt), asc(aiSkills.name))
        .all();
    },
  };
}
