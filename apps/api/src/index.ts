import { serve } from "@hono/node-server";
import { createApp, createRuntime } from "./bootstrap/index.js";
import { createChildLogger } from "./infra/log/index.js";

const runtime = createRuntime();
const logger = createChildLogger(runtime.logger, "server");
await runtime.storage.init();
await runtime.attachmentStorage.init();
const app = createApp(runtime);
const server = serve({ fetch: app.fetch, port: runtime.env.PORT }, (info) => {
  const baseUrl = `http://localhost:${info.port}`;
  if (runtime.env.OPENAPI_ENABLED) {
    logger.info(
      { port: info.port, openapi: `${baseUrl}/reference` },
      `API 已启动 ${baseUrl}，OpenAPI 文档 ${baseUrl}/reference`,
    );
  } else {
    logger.info({ port: info.port }, `API 已启动 ${baseUrl}`);
  }
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close((error) => {
    void runtime.close().catch((closeError: unknown) => {
      logger.error({ err: closeError }, "API 依赖关闭失败");
      process.exitCode = 1;
    });
    if (error) {
      logger.error({ err: error }, "API 关闭失败");
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
