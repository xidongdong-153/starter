import { and, desc, eq, sql } from 'drizzle-orm'

import type { AgentDefinitionStatus } from '@starter/contracts'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiAgentDefinitions } from '@api/modules/ai/ai.schema.js'

export type AiAgentDefinitionRecord = typeof aiAgentDefinitions.$inferSelect

export class AiAgentDefinitionNameConflictError extends Error {
  constructor() {
    super('AI Agent definition name already exists')
    this.name = 'AiAgentDefinitionNameConflictError'
  }
}

export class AiAgentDefinitionRevisionConflictError extends Error {
  constructor() {
    super('AI Agent definition changed concurrently')
    this.name = 'AiAgentDefinitionRevisionConflictError'
  }
}

export interface AiAgentDefinitionListInput {
  status?: AgentDefinitionStatus
  page: number
  pageSize: number
}

export interface AiAgentDefinitionListResult {
  items: AiAgentDefinitionRecord[]
  total: number
}

export interface AiAgentDefinitionRepository {
  create: (input: {
    id: string
    name: string
    description: string
    configJson: string
    createdBy: string
    updatedBy: string
    now: Date
  }) => AiAgentDefinitionRecord
  findById: (id: string) => AiAgentDefinitionRecord | undefined
  findByName: (name: string) => AiAgentDefinitionRecord | undefined
  list: (input: AiAgentDefinitionListInput) => AiAgentDefinitionListResult
  update: (input: {
    id: string
    name?: string
    description?: string
    configJson?: string
    expectedRevision: number
    expectedStatus: string
    revision: number
    updatedBy: string
    now: Date
  }) => AiAgentDefinitionRecord | undefined
  updateStatus: (input: {
    id: string
    status: AgentDefinitionStatus
    expectedRevision: number
    expectedStatus: string
    updatedBy: string
    now: Date
  }) => AiAgentDefinitionRecord | undefined
}

export function createAiAgentDefinitionRepository(db: AppDatabase): AiAgentDefinitionRepository {
  function create(input: {
    id: string
    name: string
    description: string
    configJson: string
    createdBy: string
    updatedBy: string
    now: Date
  }): AiAgentDefinitionRecord {
    try {
      db.insert(aiAgentDefinitions)
        .values({
          id: input.id,
          name: input.name,
          description: input.description,
          status: 'draft',
          revision: 1,
          configJson: input.configJson,
          createdBy: input.createdBy,
          updatedBy: input.updatedBy,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run()
    } catch (error) {
      if (isNameConflict(error)) {
        throw new AiAgentDefinitionNameConflictError()
      }
      throw error
    }

    return findById(input.id)!
  }

  function findById(id: string): AiAgentDefinitionRecord | undefined {
    return db.select().from(aiAgentDefinitions).where(eq(aiAgentDefinitions.id, id)).get()
  }

  function findByName(name: string): AiAgentDefinitionRecord | undefined {
    return db.select().from(aiAgentDefinitions).where(eq(aiAgentDefinitions.name, name)).get()
  }

  function list(input: AiAgentDefinitionListInput): AiAgentDefinitionListResult {
    const condition = input.status ? eq(aiAgentDefinitions.status, input.status) : undefined
    const countRow = db
      .select({ count: sql<number>`count(*)` })
      .from(aiAgentDefinitions)
      .where(condition)
      .get()
    const total = countRow ? countRow.count : 0
    const items = db
      .select()
      .from(aiAgentDefinitions)
      .where(condition)
      .orderBy(desc(aiAgentDefinitions.updatedAt), desc(aiAgentDefinitions.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .all()

    return { items, total }
  }

  function update(input: {
    id: string
    name?: string
    description?: string
    configJson?: string
    expectedRevision: number
    expectedStatus: string
    revision: number
    updatedBy: string
    now: Date
  }): AiAgentDefinitionRecord | undefined {
    try {
      const result = db
        .update(aiAgentDefinitions)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.configJson !== undefined ? { configJson: input.configJson } : {}),
          revision: input.revision,
          updatedBy: input.updatedBy,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(aiAgentDefinitions.id, input.id),
            eq(aiAgentDefinitions.revision, input.expectedRevision),
            eq(aiAgentDefinitions.status, input.expectedStatus),
          ),
        )
        .run()
      if (result.changes === 0) {
        if (!findById(input.id)) return undefined
        throw new AiAgentDefinitionRevisionConflictError()
      }
    } catch (error) {
      if (isNameConflict(error)) {
        throw new AiAgentDefinitionNameConflictError()
      }
      throw error
    }

    return findById(input.id)
  }

  function updateStatus(input: {
    id: string
    status: AgentDefinitionStatus
    expectedRevision: number
    expectedStatus: string
    updatedBy: string
    now: Date
  }): AiAgentDefinitionRecord | undefined {
    const result = db
      .update(aiAgentDefinitions)
      .set({
        status: input.status,
        updatedBy: input.updatedBy,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(aiAgentDefinitions.id, input.id),
          eq(aiAgentDefinitions.revision, input.expectedRevision),
          eq(aiAgentDefinitions.status, input.expectedStatus),
        ),
      )
      .run()
    if (result.changes === 0) {
      if (!findById(input.id)) return undefined
      throw new AiAgentDefinitionRevisionConflictError()
    }
    return findById(input.id)
  }

  return { create, findById, findByName, list, update, updateStatus }
}

function isNameConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ai_agent_definitions.name')
}
