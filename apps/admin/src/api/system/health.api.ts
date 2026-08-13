import type { InferResponseType } from 'hono/client'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

type HealthResponse = InferResponseType<typeof apiRpc.health.$get, 200>['data']

/**
 * 健康检查
 */
export function getSystemHealth(): Promise<HealthResponse> {
  return unwrapApiData(apiRpc.health.$get())
}
