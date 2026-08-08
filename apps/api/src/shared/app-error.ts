import type { ApiErrorCode } from "@starter/contracts";

export type AppErrorStatus =
  400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503 | 504;

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: AppErrorStatus,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
