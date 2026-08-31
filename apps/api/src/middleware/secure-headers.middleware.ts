import type { Hono } from "hono";
import type { AppEnv } from "@api/shared/env.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { secureHeaders } from "hono/secure-headers";

export function registerSecureHeaders(app: Hono<HonoEnv>, env: AppEnv): void {
  // 头像和文件内容接口需要跨域嵌入，覆盖 secureHeaders 的 same-origin 默认值
  for (const path of [
    "/api/profiles/:userId/avatar",
    "/api/files/:fileId/content",
    "/api/ai/attachments/:attachmentId/content",
  ]) {
    app.use(path, async (c, next) => {
      await next();
      c.res.headers.set("cross-origin-resource-policy", "cross-origin");
    });
  }
  app.use(
    "*",
    secureHeaders({ strictTransportSecurity: env.APP_ENV === "production" }),
  );
}
