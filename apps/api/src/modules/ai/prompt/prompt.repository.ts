import { agentDefinitionConfigSchema } from '@starter/contracts'
import { and, asc, desc, eq } from 'drizzle-orm'

import type { AppDatabase } from '@api/infra/db/client.js'
import {
  aiAgentDefinitions,
  aiPromptTemplates,
  aiSettings,
  aiSystemPromptRevisions,
  aiSystemPrompts,
} from '@api/modules/ai/ai.schema.js'
import { generateId } from '@api/shared/id.js'

export type AiSystemPromptRecord = typeof aiSystemPrompts.$inferSelect
export type AiPromptTemplateRecord = typeof aiPromptTemplates.$inferSelect

export interface AiPromptRepository {
  createSystemPrompt: (input: {
    id: string
    name: string
    content: string
    enabled: boolean
    actorId: string | null
    now: Date
  }) => AiSystemPromptRecord
  /**
   * content 变化时单事务完成：追加 revision 行 → 刷新主表 content 与
   * current_revision → 引用该 Prompt 的 Agent revision +1 并刷新记录列。
   * name/enabled 变化不进执行输入，不触发 revision 与传播。
   */
  updateSystemPrompt: (input: {
    id: string
    name?: string
    content?: string
    enabled?: boolean
    actorId: string | null
    now: Date
  }) => AiSystemPromptRecord | null
  deleteSystemPrompt: (id: string) => boolean
  findSystemPromptById: (id: string) => AiSystemPromptRecord | undefined
  /** 读取不可变 revision 行的内容；行不存在返回 undefined。 */
  findSystemPromptRevisionContent: (id: string, revision: number) => string | undefined
  listSystemPrompts: () => AiSystemPromptRecord[]
  isSystemPromptReferenced: (id: string) => boolean
  setGlobalSystemPrompt: (systemPromptId: string | null, actorId: string | null, now: Date) => void
  getGlobalSystemPromptId: () => string | null
  createTemplate: (input: {
    id: string
    name: string
    description: string
    content: string
    enabled: boolean
    sortOrder: number
    actorId: string | null
    now: Date
  }) => AiPromptTemplateRecord
  updateTemplate: (input: {
    id: string
    name?: string
    description?: string
    content?: string
    enabled?: boolean
    sortOrder?: number
    actorId: string | null
    now: Date
  }) => AiPromptTemplateRecord | null
  deleteTemplate: (id: string) => boolean
  findTemplateById: (id: string) => AiPromptTemplateRecord | undefined
  listTemplates: () => AiPromptTemplateRecord[]
}

export function createAiPromptRepository(db: AppDatabase): AiPromptRepository {
  return {
    createSystemPrompt(input) {
      db.transaction((tx) => {
        tx.insert(aiSystemPrompts)
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
          .run()
        tx.insert(aiSystemPromptRevisions)
          .values({
            id: generateId(),
            promptId: input.id,
            revision: 1,
            content: input.content,
            createdAt: input.now,
          })
          .run()
      })
      return db.select().from(aiSystemPrompts).where(eq(aiSystemPrompts.id, input.id)).get()!
    },
    updateSystemPrompt(input) {
      return db.transaction((tx) => {
        const current = tx.select().from(aiSystemPrompts).where(eq(aiSystemPrompts.id, input.id)).get()
        if (!current) return null
        const contentChanged = input.content !== undefined && input.content !== current.content
        const nextRevision = contentChanged ? current.currentRevision + 1 : current.currentRevision
        if (contentChanged && input.content !== undefined) {
          tx.insert(aiSystemPromptRevisions)
            .values({
              id: generateId(),
              promptId: input.id,
              revision: nextRevision,
              content: input.content,
              createdAt: input.now,
            })
            .run()
        }
        tx.update(aiSystemPrompts)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(contentChanged && input.content !== undefined ? { content: input.content } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(contentChanged ? { currentRevision: nextRevision } : {}),
            updatedBy: input.actorId,
            updatedAt: input.now,
          })
          .where(eq(aiSystemPrompts.id, input.id))
          .run()
        if (contentChanged) {
          bumpAgentsReferencingPrompt(tx, input.id, nextRevision, input.now)
        }
        return tx.select().from(aiSystemPrompts).where(eq(aiSystemPrompts.id, input.id)).get() ?? null
      })
    },
    deleteSystemPrompt(id) {
      const result = db.delete(aiSystemPrompts).where(eq(aiSystemPrompts.id, id)).run()
      return result.changes > 0
    },
    findSystemPromptById(id) {
      return db.select().from(aiSystemPrompts).where(eq(aiSystemPrompts.id, id)).get()
    },
    findSystemPromptRevisionContent(id, revision) {
      const row = db
        .select({ content: aiSystemPromptRevisions.content })
        .from(aiSystemPromptRevisions)
        .where(and(eq(aiSystemPromptRevisions.promptId, id), eq(aiSystemPromptRevisions.revision, revision)))
        .get()
      return row?.content
    },
    listSystemPrompts() {
      return db.select().from(aiSystemPrompts).orderBy(desc(aiSystemPrompts.updatedAt)).all()
    },
    isSystemPromptReferenced(id) {
      const globalRef = db
        .select({ id: aiSettings.id })
        .from(aiSettings)
        .where(eq(aiSettings.globalSystemPromptId, id))
        .get()
      if (globalRef) return true

      const agentDefinitions = db.select({ configJson: aiAgentDefinitions.configJson }).from(aiAgentDefinitions).all()
      for (const agent of agentDefinitions) {
        let configValue: unknown
        try {
          configValue = JSON.parse(agent.configJson) as unknown
        } catch {
          return true
        }
        const config = agentDefinitionConfigSchema.safeParse(configValue)
        if (!config.success) return true
        if (config.data.systemPromptId === id) return true
      }
      return false
    },
    setGlobalSystemPrompt(systemPromptId, actorId, now) {
      const values = {
        id: 'global',
        globalSystemPromptId: systemPromptId,
        updatedBy: actorId,
        updatedAt: now,
      }
      db.insert(aiSettings).values(values).onConflictDoUpdate({ target: aiSettings.id, set: values }).run()
    },
    getGlobalSystemPromptId() {
      const row = db
        .select({ id: aiSettings.globalSystemPromptId })
        .from(aiSettings)
        .where(eq(aiSettings.id, 'global'))
        .get()
      return row?.id ?? null
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
        .run()
      return db.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.id, input.id)).get()!
    },
    updateTemplate(input) {
      db.update(aiPromptTemplates)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          updatedBy: input.actorId,
          updatedAt: input.now,
        })
        .where(eq(aiPromptTemplates.id, input.id))
        .run()
      return db.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.id, input.id)).get() ?? null
    },
    deleteTemplate(id) {
      const result = db.delete(aiPromptTemplates).where(eq(aiPromptTemplates.id, id)).run()
      return result.changes > 0
    },
    findTemplateById(id) {
      return db.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.id, id)).get()
    },
    listTemplates() {
      return db
        .select()
        .from(aiPromptTemplates)
        .orderBy(desc(aiPromptTemplates.enabled), asc(aiPromptTemplates.sortOrder), asc(aiPromptTemplates.createdAt))
        .all()
    },
  }
}

type RepositoryTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

/**
 * Prompt content 变化后传播：引用该 Prompt 的 Agent revision +1 并刷新
 * system_prompt_revision。config 解析失败的 Agent 无法判断引用关系，跳过。
 */
function bumpAgentsReferencingPrompt(
  tx: RepositoryTransaction,
  promptId: string,
  promptRevision: number,
  now: Date,
): void {
  const agents = tx.select().from(aiAgentDefinitions).all()
  for (const agent of agents) {
    let config: unknown
    try {
      config = JSON.parse(agent.configJson) as unknown
    } catch {
      continue
    }
    const parsed = agentDefinitionConfigSchema.safeParse(config)
    if (!parsed.success || parsed.data.systemPromptId !== promptId) continue
    tx.update(aiAgentDefinitions)
      .set({
        revision: agent.revision + 1,
        systemPromptRevision: promptRevision,
        updatedAt: now,
      })
      .where(eq(aiAgentDefinitions.id, agent.id))
      .run()
  }
}
