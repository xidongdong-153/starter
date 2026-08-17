import type {
  AiModelCallAuditQuery,
  AiToolExecutionAuditStatus,
  AiUsage,
} from "@starter/contracts";
import type { Logger } from "pino";
import type {
  AiGateway,
  AiGatewayEvent,
  AiGatewayInput,
} from "@api/infra/ai/index.js";
import { AiGatewayError } from "@api/infra/ai/index.js";
import { ApiErrorCodes } from "@starter/contracts";

import { generateId } from "@api/shared/id.js";

import {
  toAiModelCallAudit,
  toAiModelCallAuditDetail,
} from "./usage-audit.presenter.js";
import type { AiUsageAuditRepository } from "./usage-audit.repository.js";

const DEFAULT_UNKNOWN_TOOL_TIMEOUT_MS = 5000;

export function resolveModelCallTimeout(
  requestTimeoutMs: number,
  generationRemainingMs: number,
): number {
  return Math.max(1, Math.min(requestTimeoutMs, generationRemainingMs));
}

export function resolveToolExecutionTimeout(
  toolTimeoutMs: number | undefined,
  generationRemainingMs: number,
): number {
  return Math.max(
    1,
    Math.min(
      toolTimeoutMs ?? DEFAULT_UNKNOWN_TOOL_TIMEOUT_MS,
      generationRemainingMs,
    ),
  );
}

const EMPTY_USAGE: AiUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  cacheWrite1hTokens: null,
  reasoningTokens: null,
  totalTokens: null,
};

export interface AiModelCallAuditContext {
  requestId: string;
  userId: string;
  scenario: "model_test" | "conversation";
  conversationId?: string;
  generationId?: string;
  timeoutMs: number;
  generationRemainingMs?: number;
  onStarted?: (modelCallId: string | null) => void;
}

export interface AiToolExecutionAuditHandle {
  id: string;
  startedAt: Date;
}

export function createAiUsageAuditService(
  repository: AiUsageAuditRepository,
  logger: Logger,
) {
  try {
    repository.recoverInterrupted(new Date());
  } catch {
    logFailure(logger, "recover");
  }

  function beginModelCall(
    context: AiModelCallAuditContext,
    input: AiGatewayInput,
    startedAt: Date,
  ): string | null {
    const id = generateId();
    try {
      repository.beginModelCall({
        id,
        requestId: context.requestId,
        userId: context.userId,
        scenario: context.scenario,
        conversationId: context.conversationId ?? null,
        generationId: context.generationId ?? null,
        providerId: input.model.providerId,
        modelId: input.model.modelId,
        startedAt,
        timeoutMs: resolveModelCallTimeout(
          context.timeoutMs,
          context.generationRemainingMs ?? context.timeoutMs,
        ),
      });
      return id;
    } catch {
      logFailure(logger, "begin_model_call", context.requestId);
      return null;
    }
  }

  function finalizeModelCall(
    id: string | null,
    startedAt: Date,
    values: Omit<
      Parameters<AiUsageAuditRepository["finalizeModelCall"]>[0],
      "id" | "startedAt"
    >,
    requestId: string,
  ): void {
    if (!id) return;
    try {
      repository.finalizeModelCall({ ...values, id, startedAt });
    } catch {
      logFailure(logger, "finalize_model_call", requestId, id);
    }
  }

  function beginToolExecution(input: {
    modelCallId: string | null;
    toolName: string;
    timeoutMs: number;
  }): AiToolExecutionAuditHandle | null {
    if (!input.modelCallId) return null;
    const handle = { id: generateId(), startedAt: new Date() };
    try {
      repository.beginToolExecution({
        id: handle.id,
        aiCallId: input.modelCallId,
        toolName: input.toolName,
        timeoutMs: input.timeoutMs,
        startedAt: handle.startedAt,
      });
      return handle;
    } catch {
      logFailure(logger, "begin_tool_execution", undefined, input.modelCallId);
      return null;
    }
  }

  function finalizeToolExecution(
    handle: AiToolExecutionAuditHandle | null,
    status: Exclude<AiToolExecutionAuditStatus, "running">,
    errorCode: string | null,
  ): void {
    if (!handle) return;
    try {
      repository.finalizeToolExecution({
        id: handle.id,
        startedAt: handle.startedAt,
        finishedAt: new Date(),
        status,
        errorCode,
      });
    } catch {
      logFailure(logger, "finalize_tool_execution", undefined, handle.id);
    }
  }

  function listModelCalls(query: AiModelCallAuditQuery) {
    const result = repository.listModelCalls(query);
    return {
      items: result.items.map(toAiModelCallAudit),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  function getModelCall(id: string) {
    const record = repository.findModelCall(id);
    if (!record) return null;
    return toAiModelCallAuditDetail(
      record,
      repository.listToolExecutions(record.id),
    );
  }

  return {
    beginModelCall,
    beginToolExecution,
    finalizeModelCall,
    finalizeToolExecution,
    getModelCall,
    listModelCalls,
  };
}

export type AiUsageAuditService = ReturnType<typeof createAiUsageAuditService>;

export function createAiInvocationRunner(
  gateway: AiGateway,
  audit: AiUsageAuditService,
) {
  return {
    async *stream(
      context: AiModelCallAuditContext,
      input: AiGatewayInput,
    ): AsyncGenerator<AiGatewayEvent> {
      const startedAt = new Date();
      const effectiveTimeoutMs = resolveModelCallTimeout(
        context.timeoutMs,
        context.generationRemainingMs ?? context.timeoutMs,
      );
      const gatewayInput = { ...input, timeoutMs: effectiveTimeoutMs };
      const modelCallId = audit.beginModelCall(
        { ...context, timeoutMs: effectiveTimeoutMs },
        gatewayInput,
        startedAt,
      );
      context.onStarted?.(modelCallId);
      let finalized = false;
      try {
        for await (const event of gateway.stream(gatewayInput)) {
          if (event.type === "completed" && !finalized) {
            finalized = true;
            audit.finalizeModelCall(
              modelCallId,
              startedAt,
              {
                finishedAt: new Date(),
                result: "succeeded",
                stopReason: event.stopReason,
                errorCode: null,
                usage: event.usage,
                cost: event.cost,
              },
              context.requestId,
            );
          }
          yield event;
        }
      } catch (error) {
        if (!finalized) {
          finalized = true;
          const failure = toAuditFailure(error);
          audit.finalizeModelCall(
            modelCallId,
            startedAt,
            {
              finishedAt: new Date(),
              ...failure,
            },
            context.requestId,
          );
        }
        throw error;
      } finally {
        if (!finalized) {
          audit.finalizeModelCall(
            modelCallId,
            startedAt,
            {
              finishedAt: new Date(),
              result: gatewayInput.signal?.aborted
                ? "cancelled"
                : "interrupted",
              stopReason: gatewayInput.signal?.aborted ? "aborted" : "deferred",
              errorCode: gatewayInput.signal?.aborted
                ? ApiErrorCodes.AI_REQUEST_ABORTED
                : null,
              usage: EMPTY_USAGE,
              cost: null,
            },
            context.requestId,
          );
        }
      }
    },
  };
}

export type AiInvocationRunner = ReturnType<typeof createAiInvocationRunner>;

function toAuditFailure(error: unknown) {
  const gatewayError =
    error instanceof AiGatewayError ? error : new AiGatewayError("upstream");
  const base = {
    usage: gatewayError.usage ?? EMPTY_USAGE,
    cost: gatewayError.cost,
    stopReason:
      gatewayError.kind === "aborted"
        ? ("aborted" as const)
        : ("error" as const),
  };
  if (gatewayError.kind === "auth") {
    return {
      ...base,
      result: "auth_failed" as const,
      errorCode: ApiErrorCodes.AI_PROVIDER_AUTH_FAILED,
    };
  }
  if (gatewayError.kind === "timeout") {
    return {
      ...base,
      result: "timed_out" as const,
      errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
    };
  }
  if (gatewayError.kind === "aborted") {
    return {
      ...base,
      result: "cancelled" as const,
      errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
    };
  }
  return {
    ...base,
    result: "upstream_failed" as const,
    errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
  };
}

function logFailure(
  logger: Logger,
  operation: string,
  requestId?: string,
  auditId?: string,
) {
  logger.error(
    { operation, requestId, auditId },
    "ai usage audit write failed",
  );
}
