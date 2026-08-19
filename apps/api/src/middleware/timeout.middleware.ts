import type { Hono } from "hono";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { HTTPException } from "hono/http-exception";
import { timeout } from "hono/timeout";

const AUTH_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MS = 5_000;
const FILE_UPLOAD_TIMEOUT_MS = 30_000;

export function registerTimeout(app: Hono<HonoEnv>): void {
  app.use(
    "/api/auth/*",
    timeout(
      AUTH_TIMEOUT_MS,
      () => new HTTPException(504, { message: "请求处理超时" }),
    ),
  );
  app.use("/api/files", async (c, next) => {
    if (c.req.method === "POST") {
      return timeout(
        FILE_UPLOAD_TIMEOUT_MS,
        () => new HTTPException(504, { message: "请求处理超时" }),
      )(c, next);
    }
    return timeout(
      API_TIMEOUT_MS,
      () => new HTTPException(504, { message: "请求处理超时" }),
    )(c, next);
  });
  app.use("/api/*", (c, next) => {
    if (
      c.req.path.startsWith("/api/auth/") ||
      (c.req.method === "POST" && c.req.path === "/api/files")
    ) {
      return next();
    }
    return timeout(
      API_TIMEOUT_MS,
      () => new HTTPException(504, { message: "请求处理超时" }),
    )(c, next);
  });
}
