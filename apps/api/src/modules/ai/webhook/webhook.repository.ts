import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { AppDatabase } from '@api/infra/db/client.js'
import {
  aiAgentRuns,
  aiAgentSessions,
  aiRunEvents,
  aiWebhookDeliveries,
  aiWebhookEndpoints,
} from '@api/modules/ai/ai.schema.js'
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
  eventId: string | null
  sequence: number | null
}

export interface TerminalProductAppRunCursor {
  finishedAt: number
  runId: string
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

  function claimDueDeliveries(limit: number, now: Date, ttlMs: number): DueDeliveryRow[] {
    const candidates = db
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
          or(isNull(aiWebhookDeliveries.claimExpiresAt), lte(aiWebhookDeliveries.claimExpiresAt, now)),
        ),
      )
      .orderBy(asc(aiWebhookDeliveries.createdAt), asc(aiWebhookDeliveries.id))
      .limit(limit)
      .all()

    const claimExpiresAt = new Date(now.getTime() + ttlMs)
    const claimed: DueDeliveryRow[] = []
    for (const candidate of candidates) {
      const delivery = db
        .update(aiWebhookDeliveries)
        .set({ claimedAt: now, claimExpiresAt })
        .where(
          and(
            eq(aiWebhookDeliveries.id, candidate.delivery.id),
            eq(aiWebhookDeliveries.status, 'pending'),
            or(isNull(aiWebhookDeliveries.claimExpiresAt), lte(aiWebhookDeliveries.claimExpiresAt, now)),
          ),
        )
        .returning()
        .get()
      if (delivery)
        claimed.push({ delivery, url: candidate.url, signingSecretEncrypted: candidate.signingSecretEncrypted })
    }
    return claimed
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
        claimedAt: null,
        claimExpiresAt: null,
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
        claimedAt: null,
        claimExpiresAt: null,
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
        claimedAt: null,
        claimExpiresAt: null,
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

  function listTerminalProductAppRunsAfter(
    cursor: TerminalProductAppRunCursor | null,
    limit: number,
  ): TerminalProductAppRunRow[] {
    const afterCursor =
      cursor === null
        ? undefined
        : or(
            gt(aiAgentRuns.finishedAt, new Date(cursor.finishedAt)),
            and(eq(aiAgentRuns.finishedAt, new Date(cursor.finishedAt)), gt(aiAgentRuns.id, cursor.runId)),
          )
    const baseWhere = and(
      eq(aiAgentSessions.principalKind, 'product_app'),
      isNotNull(aiAgentSessions.appId),
      sql`${aiAgentRuns.status} IN ('completed', 'failed', 'aborted', 'interrupted')`,
      isNotNull(aiAgentRuns.finishedAt),
    )
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
        eventId: aiRunEvents.eventId,
        sequence: aiRunEvents.sequence,
      })
      .from(aiAgentRuns)
      .innerJoin(aiAgentSessions, eq(aiAgentRuns.sessionId, aiAgentSessions.id))
      .leftJoin(
        aiRunEvents,
        and(
          eq(aiRunEvents.runId, aiAgentRuns.id),
          inArray(aiRunEvents.type, ['run.completed', 'run.failed', 'run.aborted']),
        ),
      )
      .where(afterCursor === undefined ? baseWhere : and(baseWhere, afterCursor))
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
              id: row.id,
              sessionId: row.sessionId,
              agentId: row.agentId,
              lane: row.lane,
              status: row.status,
              agentRevision: row.agentRevision,
              errorCode: row.errorCode,
              finishedAt: row.finishedAt,
              appId: row.appId,
              eventId: row.eventId ?? null,
              sequence: row.sequence ?? null,
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
    claimDueDeliveries,
    markDelivered,
    markRetry,
    markDead,
    listDeliveries,
    listTerminalProductAppRunsAfter,
  }
}

export type AiWebhookRepository = ReturnType<typeof createAiWebhookRepository>
