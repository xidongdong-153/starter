import type { SystemLogsQuery } from '@starter/contracts'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { getSystemLogs } from './logs.api'

export const LOGS_PAGE_SIZE = 50

export const systemLogsQueryKeys = {
  all: ['system', 'logs'] as const,
  page: (filters: SystemLogsQuery) => [...systemLogsQueryKeys.all, 'page', filters] as const,
  requestId: (requestId: string) => [...systemLogsQueryKeys.all, 'requestId', requestId] as const,
}

export function useSystemLogsQuery(filters: Omit<SystemLogsQuery, 'limit' | 'before'>) {
  return useInfiniteQuery({
    queryKey: systemLogsQueryKeys.page({ ...filters, limit: LOGS_PAGE_SIZE }),
    queryFn: ({ pageParam }) => getSystemLogs({ ...filters, before: pageParam, limit: LOGS_PAGE_SIZE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.items.length < LOGS_PAGE_SIZE) return undefined
      const time = typeof lastPage.items.at(-1)?.time === 'number' ? lastPage.items.at(-1)?.time : undefined
      return time as number | undefined
    },
  })
}

export function useSystemLogsByRequestIdQuery(requestId: string | null) {
  return useQuery({
    queryKey: systemLogsQueryKeys.requestId(requestId as string),
    queryFn: () => getSystemLogs({ requestId: requestId as string, limit: 500 }),
    enabled: requestId !== null,
  })
}
