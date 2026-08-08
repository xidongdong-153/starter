import type { AppAuth } from "./auth.config.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { createMiddleware } from "hono/factory";
import { requireSession } from "./auth.service.js";

export function createRequireAuth(auth: AppAuth) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const session = await requireSession(auth, c.req.raw.headers);
    c.set("currentUserId", session.user.id);
    await next();
  });
}
