import type { OpenAPIHono } from '@hono/zod-openapi'
import type { Env } from 'hono'
import type { ApiRpcType } from './routes/index.js'

/**
 * AppType 只保留 route schema，不携带 API 服务端 Env（HonoEnv 引用
 * pino、better-sqlite3、drizzle、better-auth 等 Node-only 类型）。
 * hc<AppType>() 只消费 schema，用空 Env 重建可让 dist/rpc.d.ts 不泄漏
 * API server runtime 的类型依赖。
 */
type ApiSchema = ApiRpcType extends OpenAPIHono<infer _Env, infer S> ? S : never

export type AppType = OpenAPIHono<Env, ApiSchema>
