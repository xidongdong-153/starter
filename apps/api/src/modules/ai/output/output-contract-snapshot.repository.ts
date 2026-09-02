import type { AppDatabase } from '@api/infra/db/client.js'
import { aiOutputContractSnapshots } from '@api/modules/ai/ai.schema.js'
import type { AiOutputContractSnapshotStore } from './output-contract-registry.js'

/**
 * Output Contract 快照表写入出口。同 name+version 视为不可变定义，
 * 冲突时保留首见内容（firstSeenAt 不变），不覆盖。
 */
export function createAiOutputContractSnapshotRepository(db: AppDatabase): AiOutputContractSnapshotStore {
  return {
    upsert(input) {
      db.insert(aiOutputContractSnapshots)
        .values({
          name: input.name,
          version: input.version,
          description: input.description,
          schemaJson: input.schemaJson,
          renderKind: input.renderKind,
          visibility: input.visibility,
          mode: input.mode,
          firstSeenAt: input.now,
        })
        .onConflictDoNothing()
        .run()
    },
  }
}
