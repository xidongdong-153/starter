import type {
  AiCost,
  AiModelCallAudit,
  AiModelCallAuditDetail,
  AiToolExecutionAuditSummary,
  AiUsage,
} from "@starter/contracts";

import type {
  AiModelCallRecord,
  AiToolExecutionRecord,
} from "./usage-audit.repository.js";

export function toAiModelCallAudit(
  record: AiModelCallRecord,
): AiModelCallAudit {
  return {
    id: record.id,
    requestId: record.requestId,
    userId: record.userId,
    scenario: record.scenario as AiModelCallAudit["scenario"],
    runId: record.runId,
    providerId: record.providerId,
    modelId: record.modelId,
    startedAt: record.startedAt.toISOString(),
    timeoutMs: record.timeoutMs,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    durationMs: record.durationMs,
    result: record.result as AiModelCallAudit["result"],
    stopReason: record.stopReason as AiModelCallAudit["stopReason"],
    errorCode: record.errorCode,
    usage: toUsage(record),
    cost: toCost(record),
  };
}

export function toAiModelCallAuditDetail(
  record: AiModelCallRecord,
  tools: AiToolExecutionRecord[],
): AiModelCallAuditDetail {
  return {
    ...toAiModelCallAudit(record),
    toolExecutions: tools.map(toToolExecutionAudit),
  };
}

function toToolExecutionAudit(
  record: AiToolExecutionRecord,
): AiToolExecutionAuditSummary {
  return {
    id: record.id,
    toolName: record.toolName,
    status: record.status as AiToolExecutionAuditSummary["status"],
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
    durationMs: record.durationMs,
    timeoutMs: record.timeoutMs,
    errorCode: record.errorCode,
  };
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
  };
}

function toCost(record: AiModelCallRecord): AiCost | null {
  if (
    record.costCurrency !== "USD" ||
    record.costInput === null ||
    record.costOutput === null ||
    record.costCacheRead === null ||
    record.costCacheWrite === null ||
    record.costTotal === null
  ) {
    return null;
  }
  return {
    currency: record.costCurrency,
    input: record.costInput,
    output: record.costOutput,
    cacheRead: record.costCacheRead,
    cacheWrite: record.costCacheWrite,
    total: record.costTotal,
  };
}
