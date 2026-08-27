import { ApiErrorCodes } from "@starter/contracts";
import type { RunEvent } from "@starter/contracts";

export type AiErrorCategory = Extract<
  RunEvent,
  { type: "run.failed" }
>["data"]["error"]["category"];

/**
 * 稳定错误类别只从稳定错误码推导，不读 Provider 原始错误。
 * 产品事件、Run Trace 和用量审计 projection 共用这一个判据。
 */
export function toAiErrorCategory(errorCode: string | null): AiErrorCategory {
  if (errorCode?.includes("AUTH")) return "auth";
  if (errorCode?.includes("TIMEOUT")) return "timeout";
  if (errorCode?.includes("ABORTED")) return "cancelled";
  if (errorCode?.includes("STORAGE")) return "storage";
  if (errorCode?.includes("TOOL")) return "tool";
  return "upstream";
}

export function isAiRetryableErrorCode(errorCode: string | null): boolean {
  return (
    errorCode === ApiErrorCodes.AI_UPSTREAM_ERROR ||
    errorCode === ApiErrorCodes.AI_UPSTREAM_TIMEOUT ||
    errorCode === ApiErrorCodes.AI_PROVIDER_AUTH_FAILED
  );
}
