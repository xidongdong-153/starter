import type { OpenAPIHono } from '@hono/zod-openapi'
import type { Env } from 'hono'
import type { createChatRoute } from '../modules/chat/index.js'

/**
 * Chat 产品面的 RPC 类型。只保留 route schema，不携带 API 服务端 Env，
 * 做法与 src/rpc.ts 的 AppType 相同。
 *
 * 产品路由不并入主 AppType（类型序列化上限，见 routes/index.ts 注释），
 * web 侧用 `hc<ChatAppType>` 建独立的 typed client。
 */
type ChatSchema = ReturnType<typeof createChatRoute> extends OpenAPIHono<infer _Env, infer S> ? S : never

export type ChatAppType = OpenAPIHono<Env, ChatSchema>
