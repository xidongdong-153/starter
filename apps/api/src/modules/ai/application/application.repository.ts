import { and, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '@api/infra/db/client.js'
import { generateId } from '@api/shared/id.js'
import { aiAppCredentialAuditEvents, aiAppCredentials } from '@api/modules/ai/ai.schema.js'

export type AiAppCredentialRecord = typeof aiAppCredentials.$inferSelect

export function createAiApplicationRepository(db: AppDatabase) {
  return {
    createWithAudit(input: typeof aiAppCredentials.$inferInsert, requestId: string | null): AiAppCredentialRecord {
      return db.transaction((tx) => {
        const record = tx.insert(aiAppCredentials).values(input).returning().get()
        tx.insert(aiAppCredentialAuditEvents)
          .values({
            id: generateId(),
            appId: record.id,
            actorId: record.createdBy,
            action: 'created',
            tenantId: record.tenantId,
            projectId: record.projectId,
            requestId,
            createdAt: record.createdAt,
          })
          .run()
        return record
      })
    },
    list(): AiAppCredentialRecord[] {
      return db
        .select()
        .from(aiAppCredentials)
        .orderBy(desc(aiAppCredentials.createdAt), desc(aiAppCredentials.id))
        .all()
    },
    findById(id: string): AiAppCredentialRecord | undefined {
      return db.select().from(aiAppCredentials).where(eq(aiAppCredentials.id, id)).get()
    },
    findActiveByPrefix(prefix: string): AiAppCredentialRecord[] {
      return db
        .select()
        .from(aiAppCredentials)
        .where(and(eq(aiAppCredentials.secretPrefix, prefix), eq(aiAppCredentials.status, 'active')))
        .all()
    },
    replaceSecret(
      id: string,
      actorId: string,
      secretHash: string,
      secretPrefix: string,
      now: Date,
      requestId: string | null,
    ): AiAppCredentialRecord | undefined {
      const record = db.transaction((tx) => {
        const updated = tx
          .update(aiAppCredentials)
          .set({ secretHash, secretPrefix, updatedBy: actorId, updatedAt: now })
          .where(and(eq(aiAppCredentials.id, id), eq(aiAppCredentials.status, 'active')))
          .returning()
          .get()
        if (!updated) return undefined
        tx.insert(aiAppCredentialAuditEvents)
          .values({
            id: generateId(),
            appId: id,
            actorId,
            action: 'rotated',
            tenantId: updated.tenantId,
            projectId: updated.projectId,
            requestId,
            createdAt: now,
          })
          .run()
        return updated
      })
      return record
    },
    markUsed(id: string, now: Date): void {
      db.update(aiAppCredentials).set({ lastUsedAt: now }).where(eq(aiAppCredentials.id, id)).run()
    },
    revoke(id: string, actorId: string, now: Date, requestId: string | null): AiAppCredentialRecord | undefined {
      const record = db.transaction((tx) => {
        const updated = tx
          .update(aiAppCredentials)
          .set({
            status: 'revoked',
            revokedAt: now,
            updatedBy: actorId,
            updatedAt: now,
          })
          .where(and(eq(aiAppCredentials.id, id), eq(aiAppCredentials.status, 'active')))
          .returning()
          .get()
        if (!updated) return undefined
        tx.insert(aiAppCredentialAuditEvents)
          .values({
            id: generateId(),
            appId: id,
            actorId,
            action: 'revoked',
            tenantId: updated.tenantId,
            projectId: updated.projectId,
            requestId,
            createdAt: now,
          })
          .run()
        return updated
      })
      return record
    },
  }
}
