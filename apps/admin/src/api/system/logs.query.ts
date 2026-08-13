import type { SystemLogsQuery } from '@starter/contracts'

import { useQuery } from '@tanstack/react-query'

import { getSystemLogs } from './logs.api'

export const LOGS_DEFAULT_PAGE_SIZE = 20

export const systemLogsQueryKeys = {
  all: ['system', 'logs'] as const,
  page: (filters: Partial<SystemLogsQuery>) => [...systemLogsQueryKeys.all, 'page', filters] as const,
  requestId: (requestId: string) => [...systemLogsQueryKeys.all, 'requestId', requestId] as const,
}

export function useSystemLogsQuery(filters: Partial<SystemLogsQuery>) {
  return useQuery({
    queryKey: systemLogsQueryKeys.page(filters),
    queryFn: () => getSystemLogs(filters),
  })
}

export function useSystemLogsByRequestIdQuery(requestId: string | null) {
  return useQuery({
    queryKey: systemLogsQueryKeys.requestId(requestId as string),
    queryFn: () => getSystemLogs({ requestId: requestId as string, limit: 500 }),
    enabled: requestId !== null,
  })
}
