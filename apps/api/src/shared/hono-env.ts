import type { PrincipalContext, ResourceScope } from '@api/modules/ai/principal.js'
import type { AppLogger } from '@api/infra/log/index.js'

export interface HonoEnv {
  Bindings: Record<string, never>
  Variables: {
    currentUserId: string
    principal: PrincipalContext
    resourceScope: ResourceScope
    logger: AppLogger
    requestId: string
    startedAt: number
  }
}
