import { asc, eq } from 'drizzle-orm'
import { runTraceSchema, type RunTrace, type RunTraceAttempt, type RunTraceNode } from '@starter/contracts'

import type { AppDatabase } from '@api/infra/db/client.js'
import {
  aiAgentRuns,
  aiModelCalls,
  aiRunAttempts,
  aiRunSteps,
  aiRunTurns,
  aiStructuredOutputs,
  aiToolExecutions,
} from '../ai.schema.js'

export interface AiRunTraceRepository {
  findByRunId: (runId: string) => RunTrace | undefined
}

export function createAiRunTraceRepository(db: AppDatabase): AiRunTraceRepository {
  function findByRunId(runId: string): RunTrace | undefined {
    const run = db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).get()
    if (!run) return undefined

    const turns = db
      .select()
      .from(aiRunTurns)
      .where(eq(aiRunTurns.runId, runId))
      .orderBy(asc(aiRunTurns.turnIndex))
      .all()
    const steps = db
      .select()
      .from(aiRunSteps)
      .where(eq(aiRunSteps.runId, runId))
      .orderBy(asc(aiRunSteps.startedAt), asc(aiRunSteps.id))
      .all()
    const modelCalls = db
      .select()
      .from(aiModelCalls)
      .where(eq(aiModelCalls.runId, runId))
      .orderBy(asc(aiModelCalls.startedAt), asc(aiModelCalls.id))
      .all()
    const tools = db
      .select()
      .from(aiToolExecutions)
      .where(eq(aiToolExecutions.runId, runId))
      .orderBy(asc(aiToolExecutions.startedAt), asc(aiToolExecutions.id))
      .all()
    const attempts = db
      .select()
      .from(aiRunAttempts)
      .where(eq(aiRunAttempts.runId, runId))
      .orderBy(asc(aiRunAttempts.attemptNo))
      .all()

    const outputs = db
      .select({
        id: aiStructuredOutputs.id,
        stepId: aiStructuredOutputs.stepId,
      })
      .from(aiStructuredOutputs)
      .where(eq(aiStructuredOutputs.runId, runId))
      .all()
    const outputByStepId = new Map(outputs.map((output) => [output.stepId, output.id]))

    const nodes: RunTraceNode[] = [
      {
        id: run.id,
        parentId: null,
        kind: 'run',
        status: runStatus(run.status),
        startedAt: (run.startedAt ?? run.createdAt).toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        durationMs: duration(run.startedAt ?? run.createdAt, run.finishedAt),
        error: null,
        attributes: {
          sessionId: run.sessionId,
          lane: run.lane,
          ...(run.agentId !== null && run.agentRevision !== null
            ? { agentId: run.agentId, agentRevision: String(run.agentRevision) }
            : {}),
        },
      },
      ...turns.map((turn): RunTraceNode => ({
        id: turn.id,
        parentId: run.id,
        kind: 'turn',
        status: lifecycleStatus(turn.outcome),
        startedAt: turn.startedAt.toISOString(),
        finishedAt: turn.finishedAt?.toISOString() ?? null,
        durationMs: duration(turn.startedAt, turn.finishedAt),
        error: null,
        attributes: { turnIndex: String(turn.turnIndex), attemptNo: String(turn.attemptNo) },
      })),
      ...steps.map((step): RunTraceNode => ({
        // 顶层 agent Step 不属于任何 turn，直接挂在 Run 下。
        id: step.id,
        parentId: step.turnId ?? run.id,
        kind: 'step',
        status: lifecycleStatus(step.outcome),
        startedAt: step.startedAt.toISOString(),
        finishedAt: step.finishedAt?.toISOString() ?? null,
        durationMs: duration(step.startedAt, step.finishedAt),
        error: null,
        attributes: {
          kind: step.kind,
          attempt: String(step.attempt),
          attemptNo: String(step.attemptNo),
          ...(step.errorCode ? { errorCode: step.errorCode } : {}),
          ...(outputByStepId.has(step.id) ? { structuredOutputId: outputByStepId.get(step.id)! } : {}),
        },
      })),
      ...modelCalls.flatMap((call): RunTraceNode[] =>
        call.stepId
          ? [
              {
                id: call.id,
                parentId: call.stepId,
                kind: 'model_call',
                status: modelCallStatus(call.result),
                startedAt: call.startedAt.toISOString(),
                finishedAt: call.finishedAt?.toISOString() ?? null,
                durationMs: call.durationMs,
                error: null,
                attributes: {
                  providerId: call.providerId,
                  modelId: call.modelId,
                  result: call.result,
                  ...(call.stopReason ? { stopReason: call.stopReason } : {}),
                  ...(call.totalTokens === null ? {} : { totalTokens: String(call.totalTokens) }),
                  ...(call.costTotal === null ? {} : { costTotal: String(call.costTotal) }),
                },
              },
            ]
          : [],
      ),
      ...tools.flatMap((tool): RunTraceNode[] =>
        tool.stepId
          ? [
              {
                id: tool.toolExecutionId ?? tool.id,
                parentId: tool.stepId,
                kind: 'tool_execution',
                status: toolStatus(tool.status),
                startedAt: tool.startedAt.toISOString(),
                finishedAt: tool.finishedAt?.toISOString() ?? null,
                durationMs: tool.durationMs,
                error: null,
                attributes: {
                  name: tool.toolName,
                  ...(tool.toolVersion ? { version: tool.toolVersion } : {}),
                  ...(tool.toolCallId ? { toolCallId: tool.toolCallId } : {}),
                  status: tool.status,
                },
              },
            ]
          : [],
      ),
    ]

    const attemptsProjection: RunTraceAttempt[] = attempts.map((attempt) => ({
      attemptNo: attempt.attemptNo,
      trigger: attempt.trigger as RunTraceAttempt['trigger'],
      status: attempt.status as RunTraceAttempt['status'],
      errorCode: attempt.errorCode as RunTraceAttempt['errorCode'],
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
    }))

    return runTraceSchema.parse({ runId, nodes, attempts: attemptsProjection })
  }

  return { findByRunId }
}

function duration(startedAt: Date, finishedAt: Date | null): number | null {
  return finishedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : null
}

function runStatus(status: string): RunTraceNode['status'] {
  if (status === 'completed') return 'succeeded'
  if (status === 'aborted') return 'aborted'
  if (status === 'failed' || status === 'interrupted') return 'failed'
  return 'running'
}

function lifecycleStatus(status: string): RunTraceNode['status'] {
  if (status === 'completed' || status === 'succeeded') return 'succeeded'
  if (status === 'aborted') return 'aborted'
  if (status === 'retry' || status === 'deferred' || status === 'overflow') {
    return status
  }
  if (status === 'failed' || status === 'interrupted') return 'failed'
  return 'running'
}

function modelCallStatus(result: string): RunTraceNode['status'] {
  if (result === 'succeeded') return 'succeeded'
  if (result === 'cancelled') return 'aborted'
  if (result === 'running') return 'running'
  return 'failed'
}

function toolStatus(status: string): RunTraceNode['status'] {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'cancelled') return 'aborted'
  if (status === 'running') return 'running'
  return 'failed'
}
