import { asc, eq, inArray } from 'drizzle-orm'
import { aiStructuredOutputValueSchema, type AiStructuredOutputValue } from '@starter/contracts'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiStructuredOutputs } from '@api/modules/ai/ai.schema.js'
import { assertJsonDepth } from '@api/shared/bounded-json.js'
import { generateId } from '@api/shared/id.js'
import { parseStoredJson } from '@api/shared/stored-json.js'

export interface StructuredOutputRecord {
  id: string
  runId: string
  stepId: string
  contractName: string
  contractVersion: string
  schemaHash: string
  renderKind: string
  /** 已通过 Contract schema 校验的取值；读取时再次经过共享 schema parse。 */
  value: AiStructuredOutputValue
  createdAt: Date
}

export interface AiStructuredOutputRepository {
  create: (
    input: Omit<StructuredOutputRecord, 'id' | 'createdAt'> & {
      id?: string
      createdAt?: Date
    },
  ) => StructuredOutputRecord
  listByRun: (runId: string) => StructuredOutputRecord[]
  findById: (id: string) => StructuredOutputRecord | undefined
  findByIds: (ids: string[]) => StructuredOutputRecord[]
}

export function createAiStructuredOutputRepository(db: AppDatabase): AiStructuredOutputRepository {
  const toRecord = (row: typeof aiStructuredOutputs.$inferSelect): StructuredOutputRecord => ({
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    contractName: row.contractName,
    contractVersion: row.contractVersion,
    schemaHash: row.schemaHash,
    renderKind: row.renderKind,
    value: parseStoredJson({
      column: 'ai_structured_outputs.value_json',
      json: row.valueJson,
      schema: aiStructuredOutputValueSchema,
    }),
    createdAt: row.createdAt,
  })

  return {
    create(input) {
      // 写入和读取用同一个深度上限，不允许存下一个后续读不回来的值。
      assertJsonDepth(input.value)
      const row = {
        id: input.id ?? generateId(),
        runId: input.runId,
        stepId: input.stepId,
        contractName: input.contractName,
        contractVersion: input.contractVersion,
        schemaHash: input.schemaHash,
        renderKind: input.renderKind,
        valueJson: JSON.stringify(aiStructuredOutputValueSchema.parse(input.value)),
        createdAt: input.createdAt ?? new Date(),
      }
      db.insert(aiStructuredOutputs).values(row).run()
      return toRecord(row)
    },
    listByRun(runId) {
      return db
        .select()
        .from(aiStructuredOutputs)
        .where(eq(aiStructuredOutputs.runId, runId))
        .orderBy(asc(aiStructuredOutputs.createdAt), asc(aiStructuredOutputs.id))
        .all()
        .map(toRecord)
    },
    findById(id) {
      const row = db.select().from(aiStructuredOutputs).where(eq(aiStructuredOutputs.id, id)).get()
      return row ? toRecord(row) : undefined
    },
    findByIds(ids) {
      if (ids.length === 0) return []
      return db
        .select()
        .from(aiStructuredOutputs)
        .where(inArray(aiStructuredOutputs.id, ids))
        .orderBy(asc(aiStructuredOutputs.createdAt), asc(aiStructuredOutputs.id))
        .all()
        .map(toRecord)
    },
  }
}
