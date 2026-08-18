import { agentDefinitionConfigSchema } from "@starter/contracts";
import { asc, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import {
  aiAgentDefinitions,
  aiConversations,
  aiPromptTemplates,
  aiSettings,
  aiSystemPrompts,
} from "@api/modules/ai/ai.schema.js";

export type AiSystemPromptRecord = typeof aiSystemPrompts.$inferSelect;
export type AiPromptTemplateRecord = typeof aiPromptTemplates.$inferSelect;

export interface AiPromptRepository {
  createSystemPrompt: (input: {
    id: string;
    name: string;
    content: string;
    enabled: boolean;
    actorId: string | null;
    now: Date;
  }) => AiSystemPromptRecord;
  updateSystemPrompt: (input: {
    id: string;
    name?: string;
    content?: string;
    enabled?: boolean;
    actorId: string | null;
    now: Date;
  }) => AiSystemPromptRecord | null;
  deleteSystemPrompt: (id: string) => boolean;
  findSystemPromptById: (id: string) => AiSystemPromptRecord | undefined;
  listSystemPrompts: () => AiSystemPromptRecord[];
  isSystemPromptReferenced: (id: string) => boolean;
  setGlobalSystemPrompt: (
    systemPromptId: string | null,
    actorId: string | null,
    now: Date,
  ) => void;
  getGlobalSystemPromptId: () => string | null;
  createTemplate: (input: {
    id: string;
    name: string;
    description: string;
    content: string;
    enabled: boolean;
    sortOrder: number;
    actorId: string | null;
    now: Date;
  }) => AiPromptTemplateRecord;
  updateTemplate: (input: {
    id: string;
    name?: string;
    description?: string;
    content?: string;
    enabled?: boolean;
    sortOrder?: number;
    actorId: string | null;
    now: Date;
  }) => AiPromptTemplateRecord | null;
  deleteTemplate: (id: string) => boolean;
  findTemplateById: (id: string) => AiPromptTemplateRecord | undefined;
  listTemplates: () => AiPromptTemplateRecord[];
}

export function createAiPromptRepository(db: AppDatabase): AiPromptRepository {
  return {
    createSystemPrompt(input) {
      db.insert(aiSystemPrompts)
        .values({
          id: input.id,
          name: input.name,
          content: input.content,
          enabled: input.enabled,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
      return db
        .select()
        .from(aiSystemPrompts)
        .where(eq(aiSystemPrompts.id, input.id))
        .get()!;
    },
    updateSystemPrompt(input) {
      db.update(aiSystemPrompts)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          updatedBy: input.actorId,
          updatedAt: input.now,
        })
        .where(eq(aiSystemPrompts.id, input.id))
        .run();
      return (
        db
          .select()
          .from(aiSystemPrompts)
          .where(eq(aiSystemPrompts.id, input.id))
          .get() ?? null
      );
    },
    deleteSystemPrompt(id) {
      const result = db
        .delete(aiSystemPrompts)
        .where(eq(aiSystemPrompts.id, id))
        .run();
      return result.changes > 0;
    },
    findSystemPromptById(id) {
      return db
        .select()
        .from(aiSystemPrompts)
        .where(eq(aiSystemPrompts.id, id))
        .get();
    },
    listSystemPrompts() {
      return db
        .select()
        .from(aiSystemPrompts)
        .orderBy(desc(aiSystemPrompts.updatedAt))
        .all();
    },
    isSystemPromptReferenced(id) {
      const globalRef = db
        .select({ id: aiSettings.id })
        .from(aiSettings)
        .where(eq(aiSettings.globalSystemPromptId, id))
        .get();
      if (globalRef) return true;
      const conversationRef = db
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(eq(aiConversations.systemPromptId, id))
        .limit(1)
        .get();
      if (conversationRef) return true;

      const agentDefinitions = db
        .select({ configJson: aiAgentDefinitions.configJson })
        .from(aiAgentDefinitions)
        .all();
      for (const agent of agentDefinitions) {
        let configValue: unknown;
        try {
          configValue = JSON.parse(agent.configJson) as unknown;
        } catch {
          return true;
        }
        const config = agentDefinitionConfigSchema.safeParse(configValue);
        if (!config.success) return true;
        if (config.data.systemPromptId === id) return true;
      }
      return false;
    },
    setGlobalSystemPrompt(systemPromptId, actorId, now) {
      const values = {
        id: "global",
        globalSystemPromptId: systemPromptId,
        updatedBy: actorId,
        updatedAt: now,
      };
      db.insert(aiSettings)
        .values(values)
        .onConflictDoUpdate({ target: aiSettings.id, set: values })
        .run();
    },
    getGlobalSystemPromptId() {
      const row = db
        .select({ id: aiSettings.globalSystemPromptId })
        .from(aiSettings)
        .where(eq(aiSettings.id, "global"))
        .get();
      return row?.id ?? null;
    },
    createTemplate(input) {
      db.insert(aiPromptTemplates)
        .values({
          id: input.id,
          name: input.name,
          description: input.description,
          content: input.content,
          enabled: input.enabled,
          sortOrder: input.sortOrder,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
      return db
        .select()
        .from(aiPromptTemplates)
        .where(eq(aiPromptTemplates.id, input.id))
        .get()!;
    },
    updateTemplate(input) {
      db.update(aiPromptTemplates)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
          updatedBy: input.actorId,
          updatedAt: input.now,
        })
        .where(eq(aiPromptTemplates.id, input.id))
        .run();
      return (
        db
          .select()
          .from(aiPromptTemplates)
          .where(eq(aiPromptTemplates.id, input.id))
          .get() ?? null
      );
    },
    deleteTemplate(id) {
      const result = db
        .delete(aiPromptTemplates)
        .where(eq(aiPromptTemplates.id, id))
        .run();
      return result.changes > 0;
    },
    findTemplateById(id) {
      return db
        .select()
        .from(aiPromptTemplates)
        .where(eq(aiPromptTemplates.id, id))
        .get();
    },
    listTemplates() {
      return db
        .select()
        .from(aiPromptTemplates)
        .orderBy(
          desc(aiPromptTemplates.enabled),
          asc(aiPromptTemplates.sortOrder),
          asc(aiPromptTemplates.createdAt),
        )
        .all();
    },
  };
}
