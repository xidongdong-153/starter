import { resolveRouteMeta } from '@admin/app/router/types'
import { Loading } from '@admin/components/ui'
import { Outlet, useMatches, useRouterState } from '@tanstack/react-router'
import { clsx } from 'clsx'

/**
 * 内容区，渲染当前路由页面
 */
export function AppContent() {
  const matches = useMatches()
  const isNavigating = useRouterState({
    select: (state) => state.status === 'pending',
  })
  const currentRouteMeta = resolveRouteMeta(matches[matches.length - 1]?.staticData)
  const isFullWidthContent = currentRouteMeta.layout?.contentWidth === 'full'

  return (
    <main className="guide-content h-full flex-1 overflow-auto">
      <div
        className={clsx('guide-content-inner text-fg min-h-full', isFullWidthContent && 'guide-content-inner--full')}
      >
        {isNavigating ? <Loading /> : <Outlet />}
      </div>
    </main>
  )
}
