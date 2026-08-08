import type { AppAuth } from "./auth.config.js";
import { ApiErrorCodes } from "@starter/contracts";
import { AppError } from "@api/shared/app-error.js";

export async function getCurrentSession(auth: AppAuth, headers: Headers) {
  try {
    return await auth.api.getSession({ headers });
  } catch {
    throw new AppError(
      ApiErrorCodes.AUTH_SESSION_INVALID,
      "当前登录状态无效",
      401,
    );
  }
}

export async function requireSession(auth: AppAuth, headers: Headers) {
  const session = await getCurrentSession(auth, headers);
  if (!session) {
    throw new AppError(ApiErrorCodes.AUTH_UNAUTHENTICATED, "请先登录", 401);
  }
  return session;
}
