import type { OpenAPIHono } from "@hono/zod-openapi";
import type { HonoEnv } from "@api/shared/hono-env.js";
import type { AppRuntime } from "./create-runtime.js";

/** createApp 返回的 Hono 实例类型 */
export type AppInstance = OpenAPIHono<HonoEnv>;

/**
 * 装配函数的统一签名。
 * 每个阶段自己从 runtime 取需要的依赖，包括自己的开关，
 * createApp 只按顺序调用，不做参数挑选和条件判断。
 */
export type AppRegistrar = (app: AppInstance, runtime: AppRuntime) => void;
