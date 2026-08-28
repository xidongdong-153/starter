import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import type { AppDatabase } from "@api/infra/db/client.js";
import type { RuntimeAccessContext } from "@api/modules/ai/principal.js";
import { aiPipelineRuns } from "@api/modules/ai/ai.schema.js";

export type AiPipelineRunRecord = typeof aiPipelineRuns.$inferSelect;

export type AiPipelineRunTerminalStatus = "completed" | "failed" | "aborted";

/**
 * Pipeline Run 的可见范围判据，与 `ai_agent_sessions` 的 accessWhere 同构：
 * Starter 用户按 principalKind + ownerId + tenantId + projectId；
 * 应用凭据按 principalKind + appId + tenantId + projectId + externalUserId + subject 全等。
 */
function accessWhere(access: RuntimeAccessContext): SQL {
  const { principal, scope } = access;
  if (principal.kind === "starter_user") {
    return and(
      eq(aiPipelineRuns.principalKind, "starter_user"),
      eq(aiPipelineRuns.ownerId, principal.principalId),
      eq(aiPipelineRuns.tenantId, scope.tenantId),
      eq(aiPipelineRuns.projectId, scope.projectId),
    )!;
  }
  return and(
    eq(aiPipelineRuns.principalKind, "product_app"),
    eq(aiPipelineRuns.appId, principal.appId!),
    eq(aiPipelineRuns.tenantId, scope.tenantId),
    eq(aiPipelineRuns.projectId, scope.projectId),
    eq(aiPipelineRuns.externalUserId, principal.externalUserId!),
    scope.subjectType === null
      ? isNull(aiPipelineRuns.subjectType)
      : eq(aiPipelineRuns.subjectType, scope.subjectType),
    scope.subjectId === null
      ? isNull(aiPipelineRuns.subjectId)
      : eq(aiPipelineRuns.subjectId, scope.subjectId),
  )!;
}

export interface AiPipelineRunRepository {
  create: (input: {
    id: string;
    pipelineId: string;
    pipelineRevision: number;
    access: RuntimeAccessContext;
    sessionId: string;
    input: string;
    requestId: string;
    now: Date;
  }) => AiPipelineRunRecord;
  findById: (id: string) => AiPipelineRunRecord | undefined;
  findInScope: (
    id: string,
    access: RuntimeAccessContext,
  ) => AiPipelineRunRecord | undefined;
  listByStatus: (status: string) => AiPipelineRunRecord[];
  /** 每步终态写一次的步骤明细（整列覆盖）。 */
  updateStepState: (id: string, stepsStateJson: string) => void;
  /** 条件终态更新：只允许 running -> 终态，返回是否更新成功。 */
  updateTerminal: (input: {
    id: string;
    status: AiPipelineRunTerminalStatus;
    finalOutput: string | null;
    errorCode: string | null;
    finishedAt: Date;
  }) => boolean;
}

export function createAiPipelineRunRepository(
  db: AppDatabase,
): AiPipelineRunRepository {
  function create(input: {
    id: string;
    pipelineId: string;
    pipelineRevision: number;
    access: RuntimeAccessContext;
    sessionId: string;
    input: string;
    requestId: string;
    now: Date;
  }): AiPipelineRunRecord {
    const { principal, scope } = input.access;
    const row = db
      .insert(aiPipelineRuns)
      .values({
        id: input.id,
        pipelineId: input.pipelineId,
        pipelineRevision: input.pipelineRevision,
        principalKind: principal.kind,
        ownerId:
          principal.kind === "starter_user" ? principal.principalId : null,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        externalUserId: principal.externalUserId ?? principal.principalId,
        appId: principal.appId,
        subjectType: scope.subjectType,
        subjectId: scope.subjectId,
        sessionId: input.sessionId,
        input: input.input,
        status: "running",
        stepsStateJson: "[]",
        requestId: input.requestId,
        createdAt: input.now,
        startedAt: input.now,
      })
      .returning()
      .get();
    return row;
  }

  function findById(id: string): AiPipelineRunRecord | undefined {
    return db
      .select()
      .from(aiPipelineRuns)
      .where(eq(aiPipelineRuns.id, id))
      .get();
  }

  function findInScope(
    id: string,
    access: RuntimeAccessContext,
  ): AiPipelineRunRecord | undefined {
    return db
      .select()
      .from(aiPipelineRuns)
      .where(and(eq(aiPipelineRuns.id, id), accessWhere(access)))
      .get();
  }

  function listByStatus(status: string): AiPipelineRunRecord[] {
    return db
      .select()
      .from(aiPipelineRuns)
      .where(eq(aiPipelineRuns.status, status))
      .orderBy(desc(aiPipelineRuns.createdAt), desc(aiPipelineRuns.id))
      .all();
  }

  function updateStepState(id: string, stepsStateJson: string): void {
    db.update(aiPipelineRuns)
      .set({ stepsStateJson })
      .where(
        and(eq(aiPipelineRuns.id, id), eq(aiPipelineRuns.status, "running")),
      )
      .run();
  }

  function updateTerminal(input: {
    id: string;
    status: AiPipelineRunTerminalStatus;
    finalOutput: string | null;
    errorCode: string | null;
    finishedAt: Date;
  }): boolean {
    const result = db
      .update(aiPipelineRuns)
      .set({
        status: input.status,
        finalOutput: input.finalOutput,
        errorCode: input.errorCode,
        finishedAt: input.finishedAt,
      })
      .where(
        and(
          eq(aiPipelineRuns.id, input.id),
          eq(aiPipelineRuns.status, "running"),
        ),
      )
      .run();
    return result.changes > 0;
  }

  return {
    create,
    findById,
    findInScope,
    listByStatus,
    updateStepState,
    updateTerminal,
  };
}
