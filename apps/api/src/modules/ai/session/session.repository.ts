import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'

import type { AppDatabase } from '@api/infra/db/client.js'
import type { RuntimeAccessContext } from '@api/modules/ai/principal.js'
import { aiAgentDefinitions, aiAgentSessions } from '@api/modules/ai/ai.schema.js'

export type AiAgentSessionRecord = typeof aiAgentSessions.$inferSelect

export interface AiAgentSessionListResult {
  items: AiAgentSessionRecord[]
  total: number
}

export type DefaultAgentStatus = 'enabled' | 'present' | 'missing'

export type AiAgentSessionArchiveResult =
  | { status: 'archived'; record: AiAgentSessionRecord }
  | { status: 'already_archived'; record: AiAgentSessionRecord }
  | { status: 'not_found' }

function accessWhere(access: RuntimeAccessContext): SQL {
  const { principal, scope } = access
  if (principal.kind === 'starter_user') {
    return and(
      eq(aiAgentSessions.principalKind, 'starter_user'),
      eq(aiAgentSessions.ownerId, principal.principalId),
      eq(aiAgentSessions.tenantId, scope.tenantId),
      eq(aiAgentSessions.projectId, scope.projectId),
    )!
  }
  return and(
    eq(aiAgentSessions.principalKind, 'product_app'),
    eq(aiAgentSessions.appId, principal.appId!),
    eq(aiAgentSessions.tenantId, scope.tenantId),
    eq(aiAgentSessions.projectId, scope.projectId),
    eq(aiAgentSessions.externalUserId, principal.externalUserId!),
    scope.subjectType === null
      ? isNull(aiAgentSessions.subjectType)
      : eq(aiAgentSessions.subjectType, scope.subjectType),
    scope.subjectId === null ? isNull(aiAgentSessions.subjectId) : eq(aiAgentSessions.subjectId, scope.subjectId),
  )!
}

export interface AiAgentSessionRepository {
  create: (input: {
    id: string
    access: RuntimeAccessContext
    title: string
    defaultAgentId: string | null
    now: Date
  }) => AiAgentSessionRecord
  findForRecovery: (id: string) => AiAgentSessionRecord | undefined
  findInScope: (id: string, access: RuntimeAccessContext) => AiAgentSessionRecord | undefined
  listActiveInScope: (access: RuntimeAccessContext, page: number, pageSize: number) => AiAgentSessionListResult
  updateInScope: (input: {
    id: string
    access: RuntimeAccessContext
    title?: string
    defaultAgentId?: string | null
    now: Date
  }) => AiAgentSessionRecord | undefined
  archiveInScope: (id: string, access: RuntimeAccessContext, now: Date) => AiAgentSessionArchiveResult
  findDefaultAgentStatus: (id: string) => DefaultAgentStatus
  listAllIds: () => string[]
}

export function createAiAgentSessionRepository(db: AppDatabase): AiAgentSessionRepository {
  function create(input: {
    id: string
    access: RuntimeAccessContext
    title: string
    defaultAgentId: string | null
    now: Date
  }): AiAgentSessionRecord {
    const { principal, scope } = input.access
    return db
      .insert(aiAgentSessions)
      .values({
        id: input.id,
        ownerId: principal.kind === 'starter_user' ? principal.principalId : null,
        principalKind: principal.kind,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        externalUserId: principal.externalUserId ?? principal.principalId,
        appId: principal.appId,
        subjectType: scope.subjectType,
        subjectId: scope.subjectId,
        title: input.title,
        defaultAgentId: input.defaultAgentId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
      .get()
  }

  function findForRecovery(id: string): AiAgentSessionRecord | undefined {
    return db.select().from(aiAgentSessions).where(eq(aiAgentSessions.id, id)).get()
  }

  function findInScope(id: string, access: RuntimeAccessContext): AiAgentSessionRecord | undefined {
    return db
      .select()
      .from(aiAgentSessions)
      .where(and(eq(aiAgentSessions.id, id), accessWhere(access)))
      .get()
  }

  function listActiveInScope(access: RuntimeAccessContext, page: number, pageSize: number): AiAgentSessionListResult {
    const where = and(accessWhere(access), isNull(aiAgentSessions.archivedAt))
    const countRow = db
      .select({ count: sql<number>`count(*)` })
      .from(aiAgentSessions)
      .where(where)
      .get()
    const total = countRow?.count ?? 0
    const items = db
      .select()
      .from(aiAgentSessions)
      .where(where)
      .orderBy(desc(aiAgentSessions.updatedAt), desc(aiAgentSessions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all()
    return { items, total }
  }

  function updateInScope(input: {
    id: string
    access: RuntimeAccessContext
    title?: string
    defaultAgentId?: string | null
    now: Date
  }): AiAgentSessionRecord | undefined {
    return db
      .update(aiAgentSessions)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.defaultAgentId !== undefined ? { defaultAgentId: input.defaultAgentId } : {}),
        updatedAt: input.now,
      })
      .where(and(eq(aiAgentSessions.id, input.id), accessWhere(input.access), isNull(aiAgentSessions.archivedAt)))
      .returning()
      .get()
  }

  function archiveInScope(id: string, access: RuntimeAccessContext, now: Date): AiAgentSessionArchiveResult {
    const updated = db
      .update(aiAgentSessions)
      .set({ archivedAt: now })
      .where(and(eq(aiAgentSessions.id, id), accessWhere(access), isNull(aiAgentSessions.archivedAt)))
      .returning()
      .get()
    if (updated) return { status: 'archived', record: updated }
    const existing = findInScope(id, access)
    if (!existing) return { status: 'not_found' }
    return { status: 'already_archived', record: existing }
  }

  function findDefaultAgentStatus(id: string): DefaultAgentStatus {
    const row = db
      .select({ status: aiAgentDefinitions.status })
      .from(aiAgentDefinitions)
      .where(eq(aiAgentDefinitions.id, id))
      .get()
    if (!row) return 'missing'
    return row.status === 'enabled' ? 'enabled' : 'present'
  }

  function listAllIds(): string[] {
    return db
      .select({ id: aiAgentSessions.id })
      .from(aiAgentSessions)
      .all()
      .map((row) => row.id)
  }

  return {
    create,
    findForRecovery,
    findInScope,
    listActiveInScope,
    updateInScope,
    archiveInScope,
    findDefaultAgentStatus,
    listAllIds,
  }
}
