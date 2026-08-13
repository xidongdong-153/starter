import type { SystemLogsQuery, SystemLogsResponse } from '@starter/contracts'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

export function getSystemLogs(query: Partial<SystemLogsQuery>): Promise<SystemLogsResponse> {
  return unwrapApiData(
    apiRpc.api.system.logs.$get({
      query: {
        requestId: query.requestId,
        level: query.level,
        query: query.query,
        page: query.page === undefined ? undefined : String(query.page),
        pageSize: query.pageSize === undefined ? undefined : String(query.pageSize),
        limit: query.limit === undefined ? undefined : String(query.limit),
      },
    }),
  )
}
