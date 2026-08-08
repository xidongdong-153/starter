import { apiRequest } from '@admin/api/http'

export interface HealthResponse {
  ok: boolean
}

/**
 * 健康检查
 */
export function getSystemHealth() {
  return apiRequest<HealthResponse>('/health')
}
