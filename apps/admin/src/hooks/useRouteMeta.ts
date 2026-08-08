import { resolveRouteMeta } from '@admin/app/router/types'
import { useMatches } from '@tanstack/react-router'

/**
 * 返回当前路由的静态元信息
 */
export function useCurrentRouteMeta() {
  const matches = useMatches()

  return resolveRouteMeta(matches[matches.length - 1]?.staticData)
}
