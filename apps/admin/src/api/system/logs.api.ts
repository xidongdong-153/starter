import type { SystemLogsQuery, SystemLogsResponse } from '@starter/contracts'

import { apiRequest } from '@admin/api/http'

export function getSystemLogs(query: SystemLogsQuery) {
  const search = new URLSearchParams()
  if (query.requestId) search.set('requestId', query.requestId)
  if (query.level) search.set('level', query.level)
  if (query.query) search.set('query', query.query)
  if (query.page !== undefined) search.set('page', String(query.page))
  if (query.pageSize !== undefined) search.set('pageSize', String(query.pageSize))
  if (query.limit !== undefined) search.set('limit', String(query.limit))

  const queryString = search.toString()
  return apiRequest<SystemLogsResponse>(`/api/system/logs${queryString ? `?${queryString}` : ''}`)
}
