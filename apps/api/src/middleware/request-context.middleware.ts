import type { Hono } from "hono";
import type { Logger } from "pino";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { createMiddleware } from "hono/factory";

export const REQUEST_ID_HEADER = "X-Request-Id";

/** 生成 requestId，并派生带 requestId 的请求级 logger */
export function createRequestContextMiddleware(logger: Logger) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    c.set("requestId", requestId);
    c.set("startedAt", performance.now());
    c.set("logger", logger.child({ requestId }));
    c.header(REQUEST_ID_HEADER, requestId);
    await next();
  });
}

export function registerRequestContext(
  app: Hono<HonoEnv>,
  logger: Logger,
): void {
  app.use("*", createRequestContextMiddleware(logger));
}

function resolveRequestId(value: string | undefined): string {
  if (value && /^[\\w.:-]{1,128}$/.test(value)) return value;
  return crypto.randomUUID();
}
