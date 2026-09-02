import type { AppInstance } from './app.types.js'
import type { AppRuntime } from './create-runtime.js'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { OpenAPIHono } from '@hono/zod-openapi'
import { registerMiddleware } from '@api/middleware/index.js'
import { registerOpenApi } from '@api/openapi/index.js'
import { registerRoutes } from '@api/routes/index.js'
import { throwValidationError } from '@api/shared/validator.js'
import { registerErrorHandler } from './error-handler.js'

/**
 * 按阶段装配应用：中间件 → 错误边界 → 业务路由 → 插件。
 * middleware 必须在 routes 之前注册，app.use 的顺序决定请求处理顺序。
 */
export function createApp(runtime: AppRuntime): AppInstance {
  const app = new OpenAPIHono<HonoEnv>({
    defaultHook: (result) => {
      if (!result.success) throwValidationError(result.error)
    },
  })

  registerMiddleware(app, runtime)
  registerErrorHandler(app, runtime)
  registerRoutes(app, runtime)
  registerOpenApi(app, runtime)

  return app
}
