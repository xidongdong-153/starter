import { useQuery } from '@tanstack/react-query'

import { getSystemHealth } from './health.api'

export const systemQueryKeys = {
  all: ['system'] as const,
  health: () => [...systemQueryKeys.all, 'health'] as const,
}

export function useSystemHealthQuery() {
  return useQuery({
    queryKey: systemQueryKeys.health(),
    queryFn: getSystemHealth,
    retry: 0,
  })
}
