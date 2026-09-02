import type {
  AiCost,
  AiModelCallAudit,
  AiModelCallAuditDetail,
  AiToolExecutionAuditSummary,
  AiUsage,
} from '@starter/contracts'

import { toAiErrorCategory } from '@api/modules/ai/ai-error.js'
import type { AiModelCallRecord, AiToolExecutionRecord } from './usage-audit.repository.js'

/**
 * 用量审计 projection 的字段白名单。
 *
 * 只返回关联 ID、Provider/模型标识、时间、结果、稳定错误码与类别、用量和成本。
 * prompt、response、message 正文、Tool 参数、Tool 原始结果、safeSummary 和
 * Provider 原始错误既不入库也不出现在这里。
 */
export function toAiModelCallAudit(record: AiModelCallRecord): AiModelCallAudit {
  return {
    id: record.id,
    requestId: record.requestId,
    userId: record.userId,
    appId: record.appId,
    principalKind: record.principalKind as AiModelCallAudit['principalKind'],
    tenantId: record.tenantId,
    projectId: record.projectId,
    externalUserId: record.externalUserId,
    scenario: record.scenario as AiModelCallAudit['scenario'],
    runId: record.runId,
    turnId: record.turnId,
    stepId: record.stepId,
    providerId: record.providerId,
    modelId: record.modelId,
    api: record.api,
    startedAt: record.startedAt.toISOString(),
    timeoutMs: record.timeoutMs,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    durationMs: record.durationMs,
    ttftMs: record.ttftMs,
    chunkCount: record.chunkCount,
    responseModel: record.responseModel,
    responseId: record.responseId,
    httpStatus: record.httpStatus,
    result: record.result as AiModelCallAudit['result'],
    stopReason: record.stopReason as AiModelCallAudit['stopReason'],
    errorCode: record.errorCode,
    errorCategory: record.errorCode ? toAiErrorCategory(record.errorCode) : null,
    usage: toUsage(record),
    cost: toCost(record),
  }
}

export function toAiModelCallAuditDetail(
  record: AiModelCallRecord,
  tools: AiToolExecutionRecord[],
): AiModelCallAuditDetail {
  return {
    ...toAiModelCallAudit(record),
    toolExecutions: tools.map(toToolExecutionAudit),
  }
}

function toToolExecutionAudit(record: AiToolExecutionRecord): AiToolExecutionAuditSummary {
  return {
    id: record.id,
    runId: record.runId,
    turnId: record.turnId,
    stepId: record.stepId,
    modelCallId: record.modelCallId,
    toolCallId: record.toolCallId,
    toolExecutionId: record.toolExecutionId,
    toolName: record.toolName,
    toolVersion: record.toolVersion,
    status: record.status as AiToolExecutionAuditSummary['status'],
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
    durationMs: record.durationMs,
    timeoutMs: record.timeoutMs,
    errorCode: record.errorCode,
    errorCategory: record.errorCode ? toAiErrorCategory(record.errorCode) : null,
  }
}

function toUsage(record: AiModelCallRecord): AiUsage {
  return {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    cacheWrite1hTokens: record.cacheWrite1hTokens,
    reasoningTokens: record.reasoningTokens,
    totalTokens: record.totalTokens,
  }
}

function toCost(record: AiModelCallRecord): AiCost | null {
  if (
    record.costCurrency !== 'USD' ||
    record.costInput === null ||
    record.costOutput === null ||
    record.costCacheRead === null ||
    record.costCacheWrite === null ||
    record.costTotal === null
  ) {
    return null
  }
  return {
    currency: record.costCurrency,
    input: record.costInput,
    output: record.costOutput,
    cacheRead: record.costCacheRead,
    cacheWrite: record.costCacheWrite,
    total: record.costTotal,
  }
}
