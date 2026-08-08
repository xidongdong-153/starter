import type { AppRegistrar } from "@api/bootstrap/app.types.js";
import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createAuthRoute } from "@api/modules/auth/index.js";
import { createFilesRoute } from "@api/modules/files/index.js";
import { createProfileRoute } from "@api/modules/profile/index.js";
import { createSystemRoute } from "@api/modules/system/index.js";

export function createRoutes(runtime: AppRuntime) {
  return new OpenAPIHono<HonoEnv>()
    .route("/", createAuthRoute(runtime))
    .route("/", createSystemRoute())
    .route("/", createProfileRoute(runtime))
    .route("/", createFilesRoute(runtime));
}

export const registerRoutes: AppRegistrar = (app, runtime) => {
  app.route("/", createRoutes(runtime));
};

export type ApiRpcType = ReturnType<typeof createRoutes>;
