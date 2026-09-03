import type { AiModelCallAuditQuery, AiToolExecutionAuditStatus, AiUsage } from '@starter/contracts'
import type { Logger } from 'pino'
import type { AiGateway, AiGatewayEvent, AiGatewayInput } from '@api/infra/ai/index.js'
import { AiGatewayError } from '@api/infra/ai/index.js'
import type { PiModelCallAudit } from '@api/infra/ai/pi-native-stream.js'
import type { PiToolExecutionAudit } from '@api/infra/agent/pi-tool-adapter.js'
import { ApiErrorCodes } from '@starter/contracts'

import type { PrincipalContext, ResourceScope } from '@api/modules/ai/principal.js'
import { generateId } from '@api/shared/id.js'

import { toAiModelCallAudit, toAiModelCallAuditDetail } from './usage-audit.presenter.js'
import type { AiUsageAuditRepository } from './usage-audit.repository.js'

const DEFAULT_UNKNOWN_TOOL_TIMEOUT_MS = 5000

export function resolveModelCallTimeout(requestTimeoutMs: number, generationRemainingMs: number): number {
  return Math.max(1, Math.min(requestTimeoutMs, generationRemainingMs))
}

export function resolveToolExecutionTimeout(toolTimeoutMs: number | undefined, generationRemainingMs: number): number {
  return Math.max(1, Math.min(toolTimeoutMs ?? DEFAULT_UNKNOWN_TOOL_TIMEOUT_MS, generationRemainingMs))
}

const EMPTY_USAGE: AiUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: null,
}

export interface AiModelCallAuditContext {
  requestId: string
  userId: string
  scope?: ResourceScope
  appId?: string | null
  principalKind?: PrincipalContext['kind']
  externalUserId?: string | null
  scenario: 'model_test' | 'agent_run' | 'completion' | 'legacy'
  runId?: string
  timeoutMs: number
  generationRemainingMs?: number
  onStarted?: (modelCallId: string | null) => void
}

export interface AiToolExecutionAuditHandle {
  id: string
  startedAt: Date
  requestId?: string
  runId?: string | null
  turnId?: string | null
  stepId?: string | null
  toolCallId?: string | null
}

export function createAiUsageAuditService(repository: AiUsageAuditRepository, logger: Logger) {
  try {
    repository.recoverInterrupted(new Date())
  } catch {
    logFailure(logger, 'recover')
  }

  function beginModelCall(context: AiModelCallAuditContext, input: AiGatewayInput, startedAt: Date): string | null {
    const id = generateId()
    try {
      repository.beginModelCall({
        id,
        requestId: context.requestId,
        userId: context.userId,
        appId: context.appId ?? null,
        tenantId: context.scope?.tenantId ?? 'starter',
        projectId: context.scope?.projectId ?? 'starter',
        externalUserId: context.externalUserId ?? null,
        principalKind: context.principalKind ?? 'starter_user',
        scenario: context.scenario,
        runId: context.runId ?? null,
        providerId: input.model.providerId,
        modelId: input.model.modelId,
        startedAt,
        timeoutMs: resolveModelCallTimeout(context.timeoutMs, context.generationRemainingMs ?? context.timeoutMs),
      })
      return id
    } catch {
      logFailure(logger, 'begin_model_call', context.requestId)
      return null
    }
  }

  function finalizeModelCall(
    id: string | null,
    startedAt: Date,
    values: Omit<Parameters<AiUsageAuditRepository['finalizeModelCall']>[0], 'id' | 'startedAt'>,
    requestId: string,
  ): void {
    if (!id) return
    try {
      repository.finalizeModelCall({ ...values, id, startedAt })
    } catch {
      logFailure(logger, 'finalize_model_call', requestId, id)
    }
  }

  function beginToolExecution(input: {
    /** 由 Tool adapter 在审计 begin 前生成。 */
    id: string
    modelCallId: string | null
    requestId?: string
    runId?: string | null
    turnId?: string | null
    stepId?: string | null
    toolCallId?: string | null
    toolName: string
    toolVersion: string | null
    timeoutMs: number
    idempotencyToken: string
  }): AiToolExecutionAuditHandle | null {
    if (!input.modelCallId) return null
    const handle: AiToolExecutionAuditHandle = {
      id: input.id,
      startedAt: new Date(),
      requestId: input.requestId,
      runId: input.runId,
      turnId: input.turnId,
      stepId: input.stepId,
      toolCallId: input.toolCallId,
    }
    try {
      repository.beginToolExecution({
        id: handle.id,
        runId: input.runId,
        turnId: input.turnId,
        stepId: input.stepId,
        toolCallId: input.toolCallId,
        modelCallId: input.modelCallId,
        requestId: input.requestId,
        toolName: input.toolName,
        toolVersion: input.toolVersion,
        timeoutMs: input.timeoutMs,
        idempotencyToken: input.idempotencyToken,
        startedAt: handle.startedAt,
      })
      return handle
    } catch {
      logFailure(logger, 'begin_tool_execution', input.requestId, input.modelCallId)
      return null
    }
  }

  function beginAgentModelCall(input: Parameters<PiModelCallAudit['beginModelCall']>[0]): string | null {
    // ID 由调用方（原生模型流 / compaction 代理）在请求开始前生成。
    const id = input.id
    try {
      repository.beginModelCall({
        id,
        requestId: input.requestId,
        userId: input.userId,
        appId: input.appId ?? null,
        tenantId: input.scope?.tenantId ?? 'starter',
        projectId: input.scope?.projectId ?? 'starter',
        externalUserId: input.externalUserId ?? null,
        principalKind: input.principalKind ?? 'starter_user',
        scenario: 'agent_run',
        runId: input.runId,
        turnId: input.turnId,
        stepId: input.stepId,
        providerId: input.model.providerId,
        modelId: input.model.modelId,
        api: input.api ?? null,
        startedAt: input.startedAt,
        timeoutMs: input.timeoutMs,
      })
      return id
    } catch {
      logFailure(logger, 'begin_agent_model_call', input.requestId, id)
      return null
    }
  }

  function finalizeAgentModelCall(input: Parameters<PiModelCallAudit['finalizeModelCall']>[0]): void {
    finalizeModelCall(
      input.id,
      input.startedAt,
      {
        finishedAt: input.finishedAt,
        result: input.result,
        stopReason: input.stopReason,
        errorCode: input.errorCode,
        usage: input.usage,
        cost: input.cost,
        ttftMs: input.ttftMs ?? null,
        chunkCount: input.chunkCount ?? null,
        responseModel: input.responseModel ?? null,
        responseId: input.responseId ?? null,
        httpStatus: input.httpStatus ?? null,
      },
      input.requestId,
    )
  }

  function createAgentModelCallAudit(): PiModelCallAudit {
    return {
      beginModelCall: beginAgentModelCall,
      finalizeModelCall: finalizeAgentModelCall,
    }
  }

  function createAgentToolExecutionAudit(): PiToolExecutionAudit {
    return {
      beginToolExecution,
      finalizeToolExecution: (handle, status, errorCode) => finalizeToolExecution(handle, status, errorCode),
    }
  }

  function finalizeToolExecution(
    handle: AiToolExecutionAuditHandle | null,
    status: Exclude<AiToolExecutionAuditStatus, 'running'>,
    errorCode: string | null,
  ): void {
    if (!handle) return
    try {
      repository.finalizeToolExecution({
        id: handle.id,
        startedAt: handle.startedAt,
        finishedAt: new Date(),
        status,
        errorCode,
      })
    } catch {
      logFailure(logger, 'finalize_tool_execution', handle.requestId, handle.id)
    }
  }

  function listModelCalls(query: AiModelCallAuditQuery) {
    const result = repository.listModelCalls(query)
    return {
      items: result.items.map(toAiModelCallAudit),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  function getModelCall(id: string) {
    const record = repository.findModelCall(id)
    if (!record) return null
    return toAiModelCallAuditDetail(record, repository.listToolExecutions(record.id))
  }

  return {
    beginModelCall,
    beginAgentModelCall,
    finalizeAgentModelCall,
    createAgentModelCallAudit,
    beginToolExecution,
    createAgentToolExecutionAudit,
    finalizeModelCall,
    finalizeToolExecution,
    getModelCall,
    listModelCalls,
  }
}

export type AiUsageAuditService = ReturnType<typeof createAiUsageAuditService>

export function createAiInvocationRunner(gateway: AiGateway, audit: AiUsageAuditService) {
  return {
    async *stream(context: AiModelCallAuditContext, input: AiGatewayInput): AsyncGenerator<AiGatewayEvent> {
      const startedAt = new Date()
      const effectiveTimeoutMs = resolveModelCallTimeout(
        context.timeoutMs,
        context.generationRemainingMs ?? context.timeoutMs,
      )
      const gatewayInput = { ...input, timeoutMs: effectiveTimeoutMs }
      const modelCallId = audit.beginModelCall({ ...context, timeoutMs: effectiveTimeoutMs }, gatewayInput, startedAt)
      context.onStarted?.(modelCallId)
      let finalized = false
      try {
        for await (const event of gateway.stream(gatewayInput)) {
          if (event.type === 'completed' && !finalized) {
            finalized = true
            audit.finalizeModelCall(
              modelCallId,
              startedAt,
              {
                finishedAt: new Date(),
                result: 'succeeded',
                stopReason: event.stopReason,
                errorCode: null,
                usage: event.usage,
                cost: event.cost,
              },
              context.requestId,
            )
          }
          yield event
        }
      } catch (error) {
        if (!finalized) {
          finalized = true
          const failure = toAuditFailure(error)
          audit.finalizeModelCall(
            modelCallId,
            startedAt,
            {
              finishedAt: new Date(),
              ...failure,
            },
            context.requestId,
          )
        }
        throw error
      } finally {
        if (!finalized) {
          audit.finalizeModelCall(
            modelCallId,
            startedAt,
            {
              finishedAt: new Date(),
              result: gatewayInput.signal?.aborted ? 'cancelled' : 'interrupted',
              stopReason: gatewayInput.signal?.aborted ? 'aborted' : 'deferred',
              errorCode: gatewayInput.signal?.aborted ? ApiErrorCodes.AI_REQUEST_ABORTED : null,
              usage: EMPTY_USAGE,
              cost: null,
            },
            context.requestId,
          )
        }
      }
    },
  }
}

export type AiInvocationRunner = ReturnType<typeof createAiInvocationRunner>

function toAuditFailure(error: unknown) {
  const gatewayError = error instanceof AiGatewayError ? error : new AiGatewayError('upstream')
  const base = {
    usage: gatewayError.usage ?? EMPTY_USAGE,
    cost: gatewayError.cost,
    stopReason: gatewayError.kind === 'aborted' ? ('aborted' as const) : ('error' as const),
  }
  if (gatewayError.kind === 'auth') {
    return {
      ...base,
      result: 'auth_failed' as const,
      errorCode: ApiErrorCodes.AI_PROVIDER_AUTH_FAILED,
    }
  }
  if (gatewayError.kind === 'timeout') {
    return {
      ...base,
      result: 'timed_out' as const,
      errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
    }
  }
  if (gatewayError.kind === 'aborted') {
    return {
      ...base,
      result: 'cancelled' as const,
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    }
  }
  return {
    ...base,
    result: 'upstream_failed' as const,
    errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
  }
}

function logFailure(logger: Logger, operation: string, requestId?: string, auditId?: string) {
  logger.error({ operation, requestId, auditId }, 'ai usage audit write failed')
}
