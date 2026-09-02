import { and, asc, count, desc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { AppDatabase } from '@api/infra/db/client.js'
import { aiAgentRuns, aiAgentSessions, aiWebhookDeliveries, aiWebhookEndpoints } from '@api/modules/ai/ai.schema.js'
import type { AiWebhookDeliveryQuery } from '@starter/contracts'

export type AiWebhookEndpointRecord = typeof aiWebhookEndpoints.$inferSelect
export type AiWebhookDeliveryRecord = typeof aiWebhookDeliveries.$inferSelect

/** 补登扫描需要的终态 Run 投影；appId 来自 `ai_agent_sessions`。 */
export interface TerminalProductAppRunRow {
  id: string
  sessionId: string
  agentId: string
  lane: string
  status: string
  agentRevision: number
  errorCode: string | null
  finishedAt: Date
  appId: string
}

/** 到期待投递记录，带端点 url 与加密 secret，免去二次查询。 */
export interface DueDeliveryRow {
  delivery: AiWebhookDeliveryRecord
  url: string
  signingSecretEncrypted: string
}

export interface DeliveryPage {
  items: AiWebhookDeliveryRecord[]
  total: number
}

export function createAiWebhookRepository(db: AppDatabase) {
  function createEndpoint(input: typeof aiWebhookEndpoints.$inferInsert): AiWebhookEndpointRecord {
    return db.insert(aiWebhookEndpoints).values(input).returning().get()
  }

  function listEndpointsByApp(appId: string): AiWebhookEndpointRecord[] {
    return db
      .select()
      .from(aiWebhookEndpoints)
      .where(eq(aiWebhookEndpoints.appId, appId))
      .orderBy(desc(aiWebhookEndpoints.createdAt), desc(aiWebhookEndpoints.id))
      .all()
  }

  function findEndpointById(id: string): AiWebhookEndpointRecord | undefined {
    return db.select().from(aiWebhookEndpoints).where(eq(aiWebhookEndpoints.id, id)).get()
  }

  function listEnabledEndpoints(): AiWebhookEndpointRecord[] {
    return db.select().from(aiWebhookEndpoints).where(eq(aiWebhookEndpoints.status, 'enabled')).all()
  }

  function updateEndpoint(
    id: string,
    patch: { url?: string; status?: string },
    actorId: string | null,
    now: Date,
  ): AiWebhookEndpointRecord | undefined {
    return db
      .update(aiWebhookEndpoints)
      .set({
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedBy: actorId,
        updatedAt: now,
      })
      .where(eq(aiWebhookEndpoints.id, id))
      .returning()
      .get()
  }

  function replaceEndpointSecret(
    id: string,
    signingSecretEncrypted: string,
    actorId: string | null,
    now: Date,
  ): AiWebhookEndpointRecord | undefined {
    return db
      .update(aiWebhookEndpoints)
      .set({ signingSecretEncrypted, updatedBy: actorId, updatedAt: now })
      .where(eq(aiWebhookEndpoints.id, id))
      .returning()
      .get()
  }

  function deleteEndpoint(id: string): void {
    db.delete(aiWebhookEndpoints).where(eq(aiWebhookEndpoints.id, id)).run()
  }

  function touchLastDelivery(endpointId: string, now: Date): void {
    db.update(aiWebhookEndpoints).set({ lastDeliveryAt: now }).where(eq(aiWebhookEndpoints.id, endpointId)).run()
  }

  function insertDeliveryIgnore(input: typeof aiWebhookDeliveries.$inferInsert): void {
    db.insert(aiWebhookDeliveries).values(input).onConflictDoNothing().run()
  }

  function listDueDeliveries(limit: number, now: Date): DueDeliveryRow[] {
    return db
      .select({
        delivery: aiWebhookDeliveries,
        url: aiWebhookEndpoints.url,
        signingSecretEncrypted: aiWebhookEndpoints.signingSecretEncrypted,
      })
      .from(aiWebhookDeliveries)
      .innerJoin(aiWebhookEndpoints, eq(aiWebhookDeliveries.endpointId, aiWebhookEndpoints.id))
      .where(
        and(
          eq(aiWebhookDeliveries.status, 'pending'),
          eq(aiWebhookEndpoints.status, 'enabled'),
          or(isNull(aiWebhookDeliveries.nextAttemptAt), lte(aiWebhookDeliveries.nextAttemptAt, now)),
        ),
      )
      .orderBy(asc(aiWebhookDeliveries.createdAt), asc(aiWebhookDeliveries.id))
      .limit(limit)
      .all()
  }

  function markDelivered(id: string, now: Date, responseCode: number): void {
    db.update(aiWebhookDeliveries)
      .set({
        status: 'delivered',
        attempts: sql`${aiWebhookDeliveries.attempts} + 1`,
        nextAttemptAt: null,
        lastResponseCode: responseCode,
        lastError: null,
        deliveredAt: now,
        updatedAt: now,
      })
      .where(eq(aiWebhookDeliveries.id, id))
      .run()
  }

  function markRetry(
    id: string,
    now: Date,
    nextAttemptAt: Date,
    responseCode: number | null,
    error: string | null,
  ): void {
    db.update(aiWebhookDeliveries)
      .set({
        attempts: sql`${aiWebhookDeliveries.attempts} + 1`,
        nextAttemptAt,
        lastResponseCode: responseCode,
        lastError: error,
        updatedAt: now,
      })
      .where(eq(aiWebhookDeliveries.id, id))
      .run()
  }

  function markDead(id: string, now: Date, responseCode: number | null, error: string | null): void {
    db.update(aiWebhookDeliveries)
      .set({
        status: 'dead',
        attempts: sql`${aiWebhookDeliveries.attempts} + 1`,
        nextAttemptAt: null,
        lastResponseCode: responseCode,
        lastError: error,
        deadAt: now,
        updatedAt: now,
      })
      .where(eq(aiWebhookDeliveries.id, id))
      .run()
  }

  function listDeliveries(query: AiWebhookDeliveryQuery): DeliveryPage {
    const conditions = [
      query.endpointId !== undefined
        ? eq(aiWebhookDeliveries.endpointId, query.endpointId)
        : query.appId !== undefined
          ? eq(aiWebhookDeliveries.appId, query.appId)
          : undefined,
      query.status !== undefined ? eq(aiWebhookDeliveries.status, query.status) : undefined,
    ].filter((condition) => condition !== undefined)
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const items = db
      .select()
      .from(aiWebhookDeliveries)
      .where(where)
      .orderBy(desc(aiWebhookDeliveries.createdAt), desc(aiWebhookDeliveries.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .all()
    const totalRow = db.select({ value: count() }).from(aiWebhookDeliveries).where(where).get()
    return { items, total: totalRow?.value ?? 0 }
  }

  function listTerminalProductAppRunsAfter(watermarkMs: number, limit: number): TerminalProductAppRunRow[] {
    const rows = db
      .select({
        id: aiAgentRuns.id,
        sessionId: aiAgentRuns.sessionId,
        agentId: aiAgentRuns.agentId,
        lane: aiAgentRuns.lane,
        status: aiAgentRuns.status,
        agentRevision: aiAgentRuns.agentRevision,
        errorCode: aiAgentRuns.errorCode,
        finishedAt: aiAgentRuns.finishedAt,
        appId: aiAgentSessions.appId,
      })
      .from(aiAgentRuns)
      .innerJoin(aiAgentSessions, eq(aiAgentRuns.sessionId, aiAgentSessions.id))
      .where(
        and(
          eq(aiAgentSessions.principalKind, 'product_app'),
          isNotNull(aiAgentSessions.appId),
          sql`${aiAgentRuns.status} IN ('completed', 'failed', 'aborted', 'interrupted')`,
          gt(aiAgentRuns.finishedAt, new Date(watermarkMs)),
        ),
      )
      .orderBy(asc(aiAgentRuns.finishedAt), asc(aiAgentRuns.id))
      .limit(limit)
      .all()
    // appId / finishedAt 列可空，但查询条件已排除 null；这里再收窄一次类型。
    // agent_id / agent_revision 在内联配置迁移后可空，但 product_app 主体
    // 不能使用内联配置，终态 Run 的这两列恒非空。
    return rows.flatMap((row) =>
      row.appId !== null && row.finishedAt !== null && row.agentId !== null && row.agentRevision !== null
        ? [
            {
              ...row,
              appId: row.appId,
              finishedAt: row.finishedAt,
              agentId: row.agentId,
              agentRevision: row.agentRevision,
            },
          ]
        : [],
    )
  }

  return {
    createEndpoint,
    listEndpointsByApp,
    findEndpointById,
    listEnabledEndpoints,
    updateEndpoint,
    replaceEndpointSecret,
    deleteEndpoint,
    touchLastDelivery,
    insertDeliveryIgnore,
    listDueDeliveries,
    markDelivered,
    markRetry,
    markDead,
    listDeliveries,
    listTerminalProductAppRunsAfter,
  }
}

export type AiWebhookRepository = ReturnType<typeof createAiWebhookRepository>
