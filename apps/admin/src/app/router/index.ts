import { HydrateFallback } from '@admin/components/ui/HydrateFallback'
import { createRouter } from '@tanstack/react-router'

import { queryClient } from '../query-client'
import { routeTree } from './routes'

export const router = createRouter({
  context: {
    queryClient,
  },
  defaultPendingComponent: HydrateFallback,
  defaultPreload: 'intent',
  routeTree,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
