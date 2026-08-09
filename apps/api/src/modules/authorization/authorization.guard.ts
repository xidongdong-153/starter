import type { AppDatabase } from "@api/infra/db/client.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import type { Permission } from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";
import { createMiddleware } from "hono/factory";
import { AppError } from "@api/shared/app-error.js";
import { createAuthorizationRepository } from "./authorization.repository.js";

export function createRequirePermission(
  db: AppDatabase,
  permission: Permission,
) {
  const repository = createAuthorizationRepository(db);
  return createMiddleware<HonoEnv>(async (c, next) => {
    const allowed = await repository.hasPermission(
      c.var.currentUserId,
      permission,
    );
    if (!allowed) {
      throw new AppError(
        ApiErrorCodes.AUTH_FORBIDDEN,
        "没有执行此操作的权限",
        403,
      );
    }
    await next();
  });
}
