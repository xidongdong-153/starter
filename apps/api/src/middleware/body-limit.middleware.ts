import type { Hono } from "hono";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { ApiErrorCodes } from "@starter/contracts";
import { createFailureResponse } from "@api/shared/response.js";

const AUTH_BODY_LIMIT_BYTES = 64 * 1024;
const API_BODY_LIMIT_BYTES = 1024 * 1024;
const FILE_UPLOAD_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

function createBodyLimit(maxSize: number) {
  const limit = bodyLimit({
    maxSize,
    onError: (c) =>
      c.json(
        createFailureResponse(
          {
            code: ApiErrorCodes.COMMON_PAYLOAD_TOO_LARGE,
            message: "请求体过大",
          },
          c.var.requestId,
        ),
        413,
      ),
  });

  return createMiddleware<HonoEnv>((c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    return limit(c, next);
  });
}

export function registerBodyLimit(app: Hono<HonoEnv>): void {
  const authLimit = createBodyLimit(AUTH_BODY_LIMIT_BYTES);
  const fileLimit = createBodyLimit(FILE_UPLOAD_BODY_LIMIT_BYTES);
  const apiLimit = createBodyLimit(API_BODY_LIMIT_BYTES);

  app.use("/api/auth/*", authLimit);
  app.use("/api/files", (c, next) => {
    if (c.req.method === "POST") return fileLimit(c, next);
    return apiLimit(c, next);
  });
  app.use("/api/*", (c, next) => {
    if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/files") {
      return next();
    }
    return apiLimit(c, next);
  });
}
