import type { Hono } from "hono";
import type { AppEnv } from "@api/shared/env.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { timing } from "hono/timing";

export function registerTiming(app: Hono<HonoEnv>, env: AppEnv): void {
  if (env.APP_ENV === "development") app.use("*", timing());
}
