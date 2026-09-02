import type { Hono } from 'hono'
import type { AppEnv } from '@api/shared/env.js'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { cors } from 'hono/cors'

export function registerCors(app: Hono<HonoEnv>, env: AppEnv): void {
  app.use(
    '*',
    cors({
      allowHeaders: [
        'content-type',
        'x-request-id',
        'authorization',
        'last-event-id',
        'x-ai-external-user-id',
        'x-ai-subject-type',
        'x-ai-subject-id',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      exposeHeaders: ['x-request-id'],
      origin: env.corsOrigins,
    }),
  )
}
