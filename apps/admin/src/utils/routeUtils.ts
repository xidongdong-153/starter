import type { Tab } from '@admin/stores'

import { resolveRouteMeta } from '@admin/app/router/types'

import { generateTabId } from './pathUtils'

interface RouteMatchSnapshot {
  pathname: string
  staticData: unknown
}

/**
 * 按当前匹配的路由生成标签页信息
 */
export function getTabFromMatch(match: RouteMatchSnapshot): Tab | null {
  const meta = resolveRouteMeta(match.staticData)

  if (!meta.title || meta.tab === false) {
    return null
  }

  const path = match.pathname

  return {
    closable: meta.tab?.closable ?? path !== '/',
    icon: meta.icon?.name,
    id: generateTabId(path),
    label: meta.title,
    path,
    routeId: meta.id,
  }
}
