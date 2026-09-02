import { eq } from 'drizzle-orm'
import { aiRunResolvedManifestSchema, type AiRunResolvedManifest } from '@starter/contracts'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiRunResolvedManifests } from '@api/modules/ai/ai.schema.js'
import { parseStoredJson } from '@api/shared/stored-json.js'

export interface AiRunResolvedManifestRepository {
  /** Run 行创建后、executor 启动前写入；runId 冲突说明调用方违反了唯一性。 */
  create: (input: { runId: string; manifestHash: string; manifestJson: string; now: Date }) => void
  /** 读回并按共享 schema 校验；行不存在返回 undefined。 */
  findByRunId: (runId: string) => AiRunResolvedManifest | undefined
}

export function createAiRunResolvedManifestRepository(db: AppDatabase): AiRunResolvedManifestRepository {
  return {
    create(input) {
      db.insert(aiRunResolvedManifests)
        .values({
          runId: input.runId,
          manifestHash: input.manifestHash,
          manifestJson: input.manifestJson,
          createdAt: input.now,
        })
        .run()
    },
    findByRunId(runId) {
      const row = db.select().from(aiRunResolvedManifests).where(eq(aiRunResolvedManifests.runId, runId)).get()
      if (!row) return undefined
      return parseStoredJson({
        column: 'ai_run_resolved_manifests.manifest_json',
        json: row.manifestJson,
        schema: aiRunResolvedManifestSchema,
      })
    },
  }
}
