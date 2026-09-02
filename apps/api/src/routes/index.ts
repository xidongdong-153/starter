import type { AppRegistrar } from '@api/bootstrap/app.types.js'
import type { AppRuntime } from '@api/bootstrap/create-runtime.js'
import type { HonoEnv } from '@api/shared/hono-env.js'
import type { Hono } from 'hono'
import { OpenAPIHono } from '@hono/zod-openapi'
import { createAiRoute, createAiServices } from '@api/modules/ai/index.js'
import { createAuthRoute } from '@api/modules/auth/index.js'
import { createAuthorizationRoute } from '@api/modules/authorization/index.js'
import { createChatRoute } from '@api/modules/chat/index.js'
import { createFilesRoute } from '@api/modules/files/index.js'
import { createFlowRoute } from '@api/modules/flow/index.js'
import { createProfileRoute } from '@api/modules/profile/index.js'
import { createSystemRoute } from '@api/modules/system/index.js'
import { createUsersRoute } from '@api/modules/users/index.js'

export function createRoutes(runtime: AppRuntime) {
  const aiServices = createAiServices(runtime)
  return (
    new OpenAPIHono<HonoEnv>()
      .route('/', createAuthRoute(runtime))
      .route('/', createAiRoute(runtime, aiServices))
      // 产品路由只在运行时挂载，不并入 AppType：chat/flow 的路由 schema 与
      // AI 运行面结构相近，三份叠加会超出 TS 声明序列化上限（TS7056，dts
      // 构建与 typed client 推断双双超限）。产品面的 RPC 类型独立导出，
      // 见 src/rpc/chat.ts、src/rpc/flow.ts；运行时行为与文档不受影响。
      .route('/', createChatRoute(runtime, aiServices) as unknown as Hono<HonoEnv>)
      .route('/', createFlowRoute(runtime, aiServices) as unknown as Hono<HonoEnv>)
      .route('/', createAuthorizationRoute(runtime))
      .route('/', createSystemRoute(runtime))
      .route('/', createProfileRoute(runtime))
      .route('/', createUsersRoute(runtime))
      .route('/', createFilesRoute(runtime))
  )
}

export const registerRoutes: AppRegistrar = (app, runtime) => {
  app.route('/', createRoutes(runtime))
}

export type ApiRpcType = ReturnType<typeof createRoutes>
