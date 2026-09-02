import { and, asc, desc, eq } from 'drizzle-orm'
import { agentDefinitionConfigSchema } from '@starter/contracts'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiAgentDefinitions, aiSkills, aiSkillRevisions } from '@api/modules/ai/ai.schema.js'
import { generateId } from '@api/shared/id.js'

export type AiSkillRecord = typeof aiSkills.$inferSelect

export interface AiSkillDescription {
  name: string
  description: string
}

export interface AiSkillRepository {
  createSkill: (input: {
    id: string
    name: string
    description: string
    content: string
    enabled: boolean
    actorId: string | null
    now: Date
  }) => AiSkillRecord
  /**
   * content、description 或 name 变化时单事务完成：追加 revision 行 → 刷新主表
   * content/description 与 current_revision → 引用该 Skill 的 Agent revision +1
   * 并刷新 skill_revisions_json。name 与 description 一样拼进 system prompt 的
   * `<available_skills>` 块，且 read_skill 按 name 查找，属执行输入；仅 enabled
   * 变化不触发传播。
   */
  updateSkill: (input: {
    id: string
    name?: string
    description?: string
    content?: string
    enabled?: boolean
    actorId: string | null
    now: Date
  }) => AiSkillRecord | null
  deleteSkill: (id: string) => boolean
  findSkillById: (id: string) => AiSkillRecord | undefined
  findEnabledSkillByName: (name: string) => AiSkillRecord | undefined
  listSkills: () => AiSkillRecord[]
  listEnabledDescriptions: () => AiSkillDescription[]
  /** 读取不可变 revision 行的内容；行不存在返回 undefined。 */
  findSkillRevisionContent: (id: string, revision: number) => string | undefined
}

type RepositoryTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

export function createAiSkillRepository(db: AppDatabase): AiSkillRepository {
  return {
    createSkill(input) {
      db.transaction((tx) => {
        tx.insert(aiSkills)
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
          .run()
        tx.insert(aiSkillRevisions)
          .values({
            id: generateId(),
            skillId: input.id,
            revision: 1,
            content: input.content,
            createdAt: input.now,
          })
          .run()
      })
      return db.select().from(aiSkills).where(eq(aiSkills.id, input.id)).get()!
    },
    updateSkill(input) {
      return db.transaction((tx) => {
        const current = tx.select().from(aiSkills).where(eq(aiSkills.id, input.id)).get()
        if (!current) return null
        const contentChanged = input.content !== undefined && input.content !== current.content
        const descriptionChanged = input.description !== undefined && input.description !== current.description
        const nameChanged = input.name !== undefined && input.name !== current.name
        const revisionChanged = contentChanged || descriptionChanged || nameChanged
        const nextRevision = revisionChanged ? current.currentRevision + 1 : current.currentRevision
        if (revisionChanged) {
          tx.insert(aiSkillRevisions)
            .values({
              id: generateId(),
              skillId: input.id,
              revision: nextRevision,
              content: input.content ?? current.content,
              createdAt: input.now,
            })
            .run()
        }
        tx.update(aiSkills)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(contentChanged && input.content !== undefined ? { content: input.content } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(revisionChanged ? { currentRevision: nextRevision } : {}),
            updatedBy: input.actorId,
            updatedAt: input.now,
          })
          .where(eq(aiSkills.id, input.id))
          .run()
        if (revisionChanged) {
          bumpAgentsReferencingSkill(tx, input.id, nextRevision, input.now)
        }
        return tx.select().from(aiSkills).where(eq(aiSkills.id, input.id)).get() ?? null
      })
    },
    deleteSkill(id) {
      const result = db.delete(aiSkills).where(eq(aiSkills.id, id)).run()
      return result.changes > 0
    },
    findSkillById(id) {
      return db.select().from(aiSkills).where(eq(aiSkills.id, id)).get()
    },
    findEnabledSkillByName(name) {
      return db
        .select()
        .from(aiSkills)
        .where(and(eq(aiSkills.name, name), eq(aiSkills.enabled, true)))
        .get()
    },
    listSkills() {
      return db.select().from(aiSkills).orderBy(desc(aiSkills.updatedAt)).all()
    },
    listEnabledDescriptions() {
      return db
        .select({ name: aiSkills.name, description: aiSkills.description })
        .from(aiSkills)
        .where(eq(aiSkills.enabled, true))
        .orderBy(asc(aiSkills.createdAt), asc(aiSkills.name))
        .all()
    },
    findSkillRevisionContent(id, revision) {
      const row = db
        .select({ content: aiSkillRevisions.content })
        .from(aiSkillRevisions)
        .where(and(eq(aiSkillRevisions.skillId, id), eq(aiSkillRevisions.revision, revision)))
        .get()
      return row?.content
    },
  }
}

/**
 * Skill content/description 变化后传播：引用该 Skill 的 Agent revision +1
 * 并刷新 skill_revisions_json 中该 Skill 的 revision。config 解析失败的
 * Agent 无法判断引用关系，跳过。
 */
function bumpAgentsReferencingSkill(
  tx: RepositoryTransaction,
  skillId: string,
  skillRevision: number,
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
    if (!parsed.success || !parsed.data.skillIds.includes(skillId)) continue
    const revisions = parseSkillRevisions(agent.skillRevisionsJson)
    revisions[skillId] = skillRevision
    tx.update(aiAgentDefinitions)
      .set({
        revision: agent.revision + 1,
        skillRevisionsJson: JSON.stringify(revisions),
        updatedAt: now,
      })
      .where(eq(aiAgentDefinitions.id, agent.id))
      .run()
  }
}

function parseSkillRevisions(skillRevisionsJson: string | null): Record<string, number> {
  if (!skillRevisionsJson) return {}
  try {
    const parsed = JSON.parse(skillRevisionsJson) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') result[key] = value
    }
    return result
  } catch {
    return {}
  }
}
