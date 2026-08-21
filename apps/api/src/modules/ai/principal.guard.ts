import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "@api/shared/hono-env.js";

export function createRequireAiRuntimePrincipal(input: {
  requireStarterUser: MiddlewareHandler<HonoEnv>;
  requireProductApp: MiddlewareHandler<HonoEnv>;
}): MiddlewareHandler<HonoEnv> {
  return async (context, next) => {
    const authorization = context.req.header("Authorization");
    if (authorization?.startsWith("Bearer ")) {
      await input.requireProductApp(context, next);
      return;
    }
    await input.requireStarterUser(context, next);
  };
}
