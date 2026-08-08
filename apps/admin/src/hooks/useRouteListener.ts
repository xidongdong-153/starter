import type { Tab } from '@admin/stores'

import { useTabBarStore } from '@admin/stores'
import { getTabFromMatch } from '@admin/utils/routeUtils'
import { useLocation, useMatches } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * 监听路由变化，把访问过的页面写进标签栏
 */
export function useRouteListener() {
  const pathname = useLocation({
    select: (location) => location.pathname,
  })
  const matches = useMatches()
  const addOrActivateTab = useTabBarStore((state) => state.addOrActivateTab)
  const clearClosingPath = useTabBarStore((state) => state.clearClosingPath)
  const closingPath = useTabBarStore((state) => state.closingPath)
  const findTabByPath = useTabBarStore((state) => state.findTabByPath)

  useEffect(() => {
    const currentMatch = matches[matches.length - 1]
    if (!currentMatch) {
      return
    }

    const currentPath = currentMatch.pathname

    if (closingPath && currentPath !== closingPath) {
      clearClosingPath()
    }

    if (closingPath === currentPath && !findTabByPath(currentPath)) {
      return
    }

    const existingTab = findTabByPath(currentPath)
    if (existingTab) {
      addOrActivateTab(existingTab)
      return
    }

    const tab: Tab | null = getTabFromMatch(currentMatch)
    if (tab) {
      addOrActivateTab(tab)
    }
  }, [pathname, matches, addOrActivateTab, clearClosingPath, closingPath, findTabByPath])
}
