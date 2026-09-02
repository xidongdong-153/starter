import type { AppAuth } from './auth.config.js'
import type { HonoEnv } from '@api/shared/hono-env.js'
import { createMiddleware } from 'hono/factory'
import { toResourceScope } from '@api/modules/ai/principal.js'
import { requireSession } from './auth.service.js'

export function createRequireAuth(auth: AppAuth) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const session = await requireSession(auth, c.req.raw.headers)
    c.set('currentUserId', session.user.id)
    const principal = {
      kind: 'starter_user' as const,
      principalId: session.user.id,
      tenantId: 'starter',
      projectId: 'starter',
      externalUserId: session.user.id,
      appId: null,
    }
    c.set('principal', principal)
    c.set('resourceScope', toResourceScope(principal))
    await next()
  })
}
