import type { Hono } from "hono";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { createMiddleware } from "hono/factory";

const SLOW_REQUEST_THRESHOLD_MS = 1000;

export function registerRequestLog(app: Hono<HonoEnv>): void {
  app.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      await next();

      const durationMs =
        Math.round((performance.now() - c.var.startedAt) * 100) / 100;
      const status = c.res.status;
      const payload = {
        durationMs,
        event: "http.request.completed",
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status,
      };

      if (status >= 500) {
        c.var.logger.error(payload, "请求返回 5xx");
      } else if (status === 401 || status === 403 || status === 404) {
        c.var.logger.info(payload, "请求未通过");
      } else if (status >= 400) {
        c.var.logger.warn(payload, "请求参数错误");
      } else if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
        c.var.logger.warn(payload, "请求耗时较长");
      } else {
        c.var.logger.info(payload, "请求完成");
      }
    }),
  );
}
