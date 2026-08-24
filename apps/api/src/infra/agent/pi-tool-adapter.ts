import type {
  AgentTool,
  AfterToolCallContext,
  AfterToolCallResult,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type {
  AiToolExecutionAuditStatus,
  AgentToolStatus,
  ApiErrorCode,
  Permission,
} from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";
import { z } from "zod";

import type {
  PrincipalContext,
  ResourceScope,
} from "@api/modules/ai/principal.js";
import type { RegisteredAiTool } from "@api/modules/ai/tool/tool-registry.js";
import { isAiToolAvailableInScope } from "@api/modules/ai/tool/tool-registry.js";

export interface PiToolResultDetails {
  status: AgentToolStatus;
  errorCode: ApiErrorCode | null;
  safeSummary: string | null;
  modelText: string;
  terminate: boolean;
}

export interface PiToolExecutionAuditHandle {
  readonly id: string;
  readonly startedAt: Date;
  readonly requestId?: string;
}

export interface PiToolExecutionAudit {
  beginToolExecution: (input: {
    modelCallId: string | null;
    requestId?: string;
    toolName: string;
    /** 已注册 Tool 必须传精确版本；未注册 Tool 的 not_found 记录传 null，不猜测版本。 */
    toolVersion: string | null;
    timeoutMs: number;
  }) => PiToolExecutionAuditHandle | null;
  finalizeToolExecution: (
    handle: PiToolExecutionAuditHandle | null,
    status: Exclude<AiToolExecutionAuditStatus, "running" | "interrupted">,
    errorCode: string | null,
  ) => void;
}

export interface PiToolAdapterOptions {
  principal: PrincipalContext;
  scope: ResourceScope;
  requestId: string;
  hasPermission: (userId: string, permission: Permission) => Promise<boolean>;
  getModelCallId: () => string | null;
  getRemainingRunMs?: () => number | undefined;
  audit?: PiToolExecutionAudit;
  onTerminalFailure?: (reason: "timed_out" | "cancelled") => void;
}

interface PendingFailure {
  details: PiToolResultDetails;
}

interface PendingToolAudit {
  tool: RegisteredAiTool | undefined;
  args: unknown;
  handle: PiToolExecutionAuditHandle | null;
  signal?: AbortSignal;
  finalized: boolean;
  status?: Exclude<AgentToolStatus, "interrupted">;
  errorCode?: ApiErrorCode | null;
}

export interface PiToolAdapter {
  readonly tools: readonly AgentTool[];
  readonly onToolExecutionStart: (input: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    signal?: AbortSignal;
  }) => void;
  readonly onToolExecutionEnd: (input: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }) => PiToolResultDetails | null;
  readonly afterToolCall: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
}

export function createPiToolAdapter(
  tools: readonly RegisteredAiTool[],
  options: PiToolAdapterOptions,
): PiToolAdapter {
  const pendingFailures = new Map<string, PendingFailure>();
  const pendingAudits = new Map<string, PendingToolAudit>();
  const agentTools = tools.map((tool) =>
    createAgentTool(tool, options, pendingFailures, pendingAudits),
  );

  return {
    tools: agentTools,
    onToolExecutionStart(input) {
      const tool = tools.find((candidate) => candidate.name === input.toolName);
      const timeoutMs = effectiveTimeoutMs(
        tool?.timeoutMs ?? 5000,
        options.getRemainingRunMs?.(),
      );
      pendingAudits.set(input.toolCallId, {
        tool,
        args: input.args,
        signal: input.signal,
        handle: beginToolAudit(options.audit, {
          modelCallId: options.getModelCallId(),
          requestId: options.requestId,
          toolName: input.toolName,
          toolVersion: tool?.version ?? null,
          timeoutMs,
        }),
        finalized: false,
      });
    },
    onToolExecutionEnd(input) {
      const pending = pendingAudits.get(input.toolCallId);
      if (!pending) return readToolResultDetails(input.result);
      pendingAudits.delete(input.toolCallId);
      const details = readToolResultDetails(input.result);
      if (pending.finalized) {
        return (
          details ??
          toolResultDetails(
            pending.status ?? "failed",
            pending.errorCode ?? ApiErrorCodes.AI_TOOL_FAILED,
          )
        );
      }

      const outcome = preflightToolFailure(pending);
      const outcomeStatus = outcome.status as Exclude<
        AgentToolStatus,
        "interrupted"
      >;
      pending.finalized = true;
      pending.status = outcomeStatus;
      pending.errorCode = outcome.errorCode;
      finalizeToolAudit(
        options.audit,
        pending.handle,
        outcomeStatus,
        outcome.errorCode,
      );
      return details ?? outcome;
    },
    async afterToolCall(context) {
      const failure = pendingFailures.get(context.toolCall.id);
      if (!failure) return undefined;
      pendingFailures.delete(context.toolCall.id);
      return {
        content: [{ type: "text", text: failure.details.modelText }],
        details: failure.details,
        isError: true,
        terminate: failure.details.terminate,
      };
    },
  };
}

function createAgentTool(
  tool: RegisteredAiTool,
  options: PiToolAdapterOptions,
  pendingFailures: Map<string, PendingFailure>,
  pendingAudits: Map<string, PendingToolAudit>,
): AgentTool<TSchema, PiToolResultDetails> {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema, {
      target: "draft-7",
    }) as TSchema,
    execute: async (toolCallId, params, _signal, onUpdate) => {
      const signal = _signal ?? new AbortController().signal;
      const remaining = options.getRemainingRunMs?.();
      const timeoutMs = effectiveTimeoutMs(tool.timeoutMs, remaining);
      const pendingAudit = pendingAudits.get(toolCallId);
      const auditHandle =
        pendingAudit?.handle ??
        beginToolAudit(options.audit, {
          modelCallId: options.getModelCallId(),
          requestId: options.requestId,
          toolName: tool.name,
          toolVersion: tool.version,
          timeoutMs,
        });
      let finalized = false;
      const finalizeAudit = (
        status: Exclude<AiToolExecutionAuditStatus, "running" | "interrupted">,
        errorCode: ApiErrorCode | null,
      ) => {
        if (finalized) return;
        finalized = true;
        if (pendingAudit) {
          pendingAudit.finalized = true;
          pendingAudit.status = status as Exclude<
            AgentToolStatus,
            "interrupted"
          >;
          pendingAudit.errorCode = errorCode;
        }
        finalizeToolAudit(options.audit, auditHandle, status, errorCode);
      };

      if (remaining !== undefined && remaining <= 0) {
        // Run 总时长已耗尽，与工具自身超时不同：这里继续跟模型对话没意义，直接终止。
        finalizeAudit("timed_out", ApiErrorCodes.AI_TOOL_TIMED_OUT);
        return failWithoutAudit(
          toolCallId,
          pendingFailures,
          "timed_out",
          ApiErrorCodes.AI_TOOL_TIMED_OUT,
          "The run ran out of time before the tool could start.",
          true,
          options,
          signal,
        );
      }

      if (signal.aborted) {
        finalizeAudit("cancelled", ApiErrorCodes.AI_TOOL_CANCELLED);
        return failWithoutAudit(
          toolCallId,
          pendingFailures,
          "cancelled",
          ApiErrorCodes.AI_TOOL_CANCELLED,
          "The tool was cancelled.",
          true,
          options,
          signal,
        );
      }

      // 参数安全序列化检查：不可序列化、非 object 或 JSON 字符数超过 16000
      // 都按参数无效处理；检查过程不把值写入异常、日志或审计。
      if (safeSerializeArguments(params) === null) {
        finalizeAudit(
          "invalid_arguments",
          ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
        );
        return failWithoutAudit(
          toolCallId,
          pendingFailures,
          "invalid_arguments",
          ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
          "The tool arguments are invalid.",
          false,
          options,
          signal,
        );
      }

      let parsed: unknown;
      try {
        parsed = tool.inputSchema.parse(params);
      } catch {
        finalizeAudit(
          "invalid_arguments",
          ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
        );
        return failWithoutAudit(
          toolCallId,
          pendingFailures,
          "invalid_arguments",
          ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
          "The tool arguments are invalid.",
          false,
          options,
          signal,
        );
      }

      if (!isAiToolAvailableInScope(tool, options.scope)) {
        finalizeAudit("forbidden", ApiErrorCodes.AI_TOOL_FORBIDDEN);
        return failWithoutAudit(
          toolCallId,
          pendingFailures,
          "forbidden",
          ApiErrorCodes.AI_TOOL_FORBIDDEN,
          "The tool is not available in this resource scope.",
          false,
          options,
          signal,
        );
      }

      if (tool.requiredPermission) {
        let allowed = false;
        try {
          // 只有 Starter User 主体才查 Starter 用户角色；
          // product_app 不得把 externalUserId 当作 Starter User ID 查询 user_roles。
          if (options.principal.kind === "starter_user") {
            allowed = await options.hasPermission(
              options.principal.principalId,
              tool.requiredPermission,
            );
          }
        } catch {
          // 权限查询异常按拒绝处理，不降级允许。
          allowed = false;
        }
        if (!allowed) {
          finalizeAudit("forbidden", ApiErrorCodes.AI_TOOL_FORBIDDEN);
          return failWithoutAudit(
            toolCallId,
            pendingFailures,
            "forbidden",
            ApiErrorCodes.AI_TOOL_FORBIDDEN,
            "Permission denied for this tool.",
            false,
            options,
            signal,
          );
        }
      }

      const timeoutController = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs);
      const toolSignal = AbortSignal.any([signal, timeoutController.signal]);

      // 工具上报的进度只带脱敏摘要；modelText 留空，避免把中间结果喂给模型。
      const reportProgress = (safeSummary: string) => {
        if (typeof safeSummary !== "string" || safeSummary.length === 0) return;
        onUpdate?.({
          content: [],
          details: {
            status: "succeeded",
            errorCode: null,
            safeSummary: safeSummary.slice(0, 1000),
            modelText: "",
            terminate: false,
          },
        });
      };

      try {
        const result = await executeWithAbort(
          Promise.resolve().then(() =>
            tool.execute(
              {
                principal: options.principal,
                scope: options.scope,
                requestId: options.requestId,
                signal: toolSignal,
                reportProgress,
              },
              parsed,
            ),
          ),
          toolSignal,
        );
        if (
          typeof result.modelText !== "string" ||
          result.modelText.length > 16_000 ||
          (result.safeSummary !== null &&
            (typeof result.safeSummary !== "string" ||
              result.safeSummary.length > 1000))
        ) {
          finalizeAudit("failed", ApiErrorCodes.AI_TOOL_FAILED);
          return failWithoutAudit(
            toolCallId,
            pendingFailures,
            "failed",
            ApiErrorCodes.AI_TOOL_FAILED,
            "The tool returned an invalid result.",
            false,
            options,
            signal,
          );
        }
        finalizeAudit("succeeded", null);
        return {
          content: [{ type: "text", text: result.modelText }],
          details: {
            status: "succeeded",
            errorCode: null,
            safeSummary: result.safeSummary,
            modelText: result.modelText,
            terminate: false,
          },
        } satisfies AgentToolResult<PiToolResultDetails>;
      } catch {
        if (timedOut) {
          finalizeAudit("timed_out", ApiErrorCodes.AI_TOOL_TIMED_OUT);
          return failWithoutAudit(
            toolCallId,
            pendingFailures,
            "timed_out",
            ApiErrorCodes.AI_TOOL_TIMED_OUT,
            `The tool timed out after ${timeoutMs}ms.`,
            false,
            options,
            signal,
          );
        }
        if (signal.aborted || toolSignal.aborted) {
          finalizeAudit("cancelled", ApiErrorCodes.AI_TOOL_CANCELLED);
          return failWithoutAudit(
            toolCallId,
            pendingFailures,
            "cancelled",
            ApiErrorCodes.AI_TOOL_CANCELLED,
            "The tool was cancelled.",
            true,
            options,
            signal,
          );
        }
        finalizeAudit("failed", ApiErrorCodes.AI_TOOL_FAILED);
        return failWithoutAudit(
          toolCallId,
          pendingFailures,
          "failed",
          ApiErrorCodes.AI_TOOL_FAILED,
          "The tool failed.",
          false,
          options,
          signal,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function preflightToolFailure(pending: PendingToolAudit): PiToolResultDetails {
  if (pending.signal?.aborted) {
    return toolResultDetails(
      "cancelled",
      ApiErrorCodes.AI_TOOL_CANCELLED,
      "The tool was cancelled.",
    );
  }
  if (!pending.tool) {
    return toolResultDetails(
      "not_found",
      ApiErrorCodes.AI_TOOL_NOT_FOUND,
      "The requested tool is not available.",
    );
  }
  if (safeSerializeArguments(pending.args) === null) {
    return toolResultDetails(
      "invalid_arguments",
      ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
      "The tool arguments are invalid.",
    );
  }
  try {
    if (!pending.tool.inputSchema.safeParse(pending.args).success) {
      return toolResultDetails(
        "invalid_arguments",
        ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
        "The tool arguments are invalid.",
      );
    }
  } catch {
    return toolResultDetails(
      "invalid_arguments",
      ApiErrorCodes.AI_TOOL_INVALID_ARGUMENTS,
      "The tool arguments are invalid.",
    );
  }
  return toolResultDetails(
    "failed",
    ApiErrorCodes.AI_TOOL_FAILED,
    "The tool failed.",
  );
}

/**
 * 安全序列化：模型参数必须是可序列化的 object，序列化结果最多 16000 字符。
 * 不可序列化、非 object 或超限都返回 null；值本身不进入任何输出。
 */
function safeSerializeArguments(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  try {
    const text = JSON.stringify(value);
    if (text === undefined || text.length > 16_000) return null;
    return text;
  } catch {
    return null;
  }
}

function readToolResultDetails(value: unknown): PiToolResultDetails | null {
  if (!isRecord(value)) return null;
  const details = isRecord(value.details) ? value.details : value;
  const status = details.status;
  if (
    status !== "succeeded" &&
    status !== "not_found" &&
    status !== "invalid_arguments" &&
    status !== "forbidden" &&
    status !== "failed" &&
    status !== "timed_out" &&
    status !== "cancelled" &&
    status !== "interrupted"
  ) {
    return null;
  }
  const errorCode =
    typeof details.errorCode === "string" &&
    Object.values(ApiErrorCodes).includes(details.errorCode as ApiErrorCode)
      ? (details.errorCode as ApiErrorCode)
      : null;
  return {
    status,
    errorCode,
    safeSummary:
      typeof details.safeSummary === "string"
        ? details.safeSummary.slice(0, 1000)
        : null,
    modelText: typeof details.modelText === "string" ? details.modelText : "",
    terminate: value.terminate === true || details.terminate === true,
  };
}

function toolResultDetails(
  status: Exclude<AgentToolStatus, "interrupted">,
  errorCode: ApiErrorCode | null,
  modelText = "The tool failed.",
): PiToolResultDetails {
  return {
    status,
    errorCode,
    safeSummary: null,
    modelText,
    // 只有用户取消才终止整个 Run。工具超时和其他失败一样交回模型，
    // 让它拿到失败原因后自己决定下一步。
    terminate: status === "cancelled",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function beginToolAudit(
  audit: PiToolExecutionAudit | undefined,
  input: {
    modelCallId: string | null;
    requestId?: string;
    toolName: string;
    toolVersion: string | null;
    timeoutMs: number;
  },
): PiToolExecutionAuditHandle | null {
  if (!audit) return null;
  try {
    return audit.beginToolExecution(input);
  } catch {
    return null;
  }
}

function finalizeToolAudit(
  audit: PiToolExecutionAudit | undefined,
  handle: PiToolExecutionAuditHandle | null,
  status: Exclude<AiToolExecutionAuditStatus, "running" | "interrupted">,
  errorCode: string | null,
): void {
  if (!audit) return;
  try {
    audit.finalizeToolExecution(handle, status, errorCode);
  } catch {
    // 审计是 best-effort，不能改变 AgentTool 的安全结果。
  }
}

function failWithoutAudit(
  toolCallId: string,
  pendingFailures: Map<string, PendingFailure>,
  status: AgentToolStatus,
  errorCode: ApiErrorCode,
  modelText: string,
  terminate: boolean,
  options: PiToolAdapterOptions,
  _signal: AbortSignal,
): Promise<never> {
  const details: PiToolResultDetails = {
    status,
    errorCode,
    safeSummary: null,
    modelText,
    terminate,
  };
  pendingFailures.set(toolCallId, { details });
  // 只有真正要终止 Run 的失败（用户取消、Run 总时长耗尽）才上报终态；
  // 工具自身超时交给模型继续处理，不 abort agent loop。
  if (terminate && (status === "timed_out" || status === "cancelled")) {
    options.onTerminalFailure?.(status);
  }
  return Promise.reject(new PiToolExecutionError(modelText));
}

export class PiToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiToolExecutionError";
  }
}

function effectiveTimeoutMs(
  toolTimeoutMs: number,
  remainingRunMs: number | undefined,
): number {
  return Math.max(1, Math.min(toolTimeoutMs, remainingRunMs ?? toolTimeoutMs));
}

function executeWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
