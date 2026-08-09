import type { Tab } from '@admin/stores'
import type { MenuProps } from 'antd'

import { useCurrentPermissionsQuery } from '@admin/api/authorization'
import { hasPermission } from '@admin/app/authorization/permissions'
import { appRouteRecords } from '@admin/app/router/records'
import { useMobile } from '@admin/hooks/useMobile'
import { useTabBarStore } from '@admin/stores'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Dropdown } from 'antd'
import { clsx } from 'clsx'
import { ArrowLeftToLine, ArrowRightToLine, RefreshCw, Trash2, X, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const scrollContainerStyle = {
  msOverflowStyle: 'none',
  scrollbarWidth: 'none',
} as const

const contextMenuTrigger: Array<'contextMenu'> = ['contextMenu']
const routePermissions = new Map(
  appRouteRecords.flatMap((route) => (route.permission ? [[route.id, route.permission] as const] : [])),
)

/**
 * 标签栏。支持切换、关闭、右键菜单、滚轮滚动和触摸拖拽。
 */
export function TabBar() {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const activeTabId = useTabBarStore((state) => state.activeTabId)
  const closeAllTabs = useTabBarStore((state) => state.closeAllTabs)
  const closeLeftTabs = useTabBarStore((state) => state.closeLeftTabs)
  const closeOtherTabs = useTabBarStore((state) => state.closeOtherTabs)
  const closeRightTabs = useTabBarStore((state) => state.closeRightTabs)
  const closeTab = useTabBarStore((state) => state.closeTab)
  const setActiveTab = useTabBarStore((state) => state.setActiveTab)
  const tabs = useTabBarStore((state) => state.tabs)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isMobile = useMobile()
  const permissionsQuery = useCurrentPermissionsQuery()
  const visibleTabs = useMemo(
    () =>
      tabs.filter((tab) => {
        const permission = tab.routeId ? routePermissions.get(tab.routeId) : undefined
        return (
          !permission || (permissionsQuery.isSuccess && hasPermission(permissionsQuery.data.permissions, permission))
        )
      }),
    [permissionsQuery.data?.permissions, permissionsQuery.isSuccess, tabs],
  )

  const navigateToPath = useCallback(
    (path: null | string) => {
      if (!path) {
        return
      }

      void navigate({ to: path })
    },
    [navigate],
  )

  const handleTabClick = useCallback(
    (tabId: string, path: string) => {
      setActiveTab(tabId)
      void navigate({ to: path })
    },
    [navigate, setActiveTab],
  )

  const handleCloseTab = useCallback(
    (tabId: string) => {
      navigateToPath(closeTab(tabId).nextPath)
    },
    [closeTab, navigateToPath],
  )

  const handleCloseOthers = useCallback(
    (tab: Tab) => {
      navigateToPath(closeOtherTabs(tab.id).nextPath)
    },
    [closeOtherTabs, navigateToPath],
  )

  const handleCloseAll = useCallback(() => {
    navigateToPath(closeAllTabs().nextPath)
  }, [closeAllTabs, navigateToPath])

  const handleCloseLeft = useCallback(
    (tab: Tab) => {
      navigateToPath(closeLeftTabs(tab.id).nextPath)
    },
    [closeLeftTabs, navigateToPath],
  )

  const handleCloseRight = useCallback(
    (tab: Tab) => {
      navigateToPath(closeRightTabs(tab.id).nextPath)
    },
    [closeRightTabs, navigateToPath],
  )

  const handleRefreshTab = useCallback(
    async (tab: Tab) => {
      setActiveTab(tab.id)
      await navigate({ replace: true, to: tab.path })
      await router.invalidate({ sync: true })
      await queryClient.resetQueries({ type: 'active' })
    },
    [navigate, queryClient, router, setActiveTab],
  )

  const getContextMenuItems = useCallback(
    (tab: Tab): MenuProps['items'] => {
      const targetIndex = visibleTabs.findIndex((item) => item.id === tab.id)
      const hasClosableLeftTabs = visibleTabs.some((item, index) => index < targetIndex && item.closable !== false)
      const hasClosableRightTabs = visibleTabs.some((item, index) => index > targetIndex && item.closable !== false)
      const hasClosableOtherTabs = visibleTabs.some((item) => item.id !== tab.id && item.closable !== false)
      const hasClosableTabs = visibleTabs.some((item) => item.closable !== false)

      return [
        {
          disabled: tab.closable === false,
          icon: <X size={14} />,
          key: 'close-current',
          label: t('tabBar.closeCurrent'),
          onClick: () => handleCloseTab(tab.id),
        },
        {
          disabled: !hasClosableOtherTabs,
          icon: <XCircle size={14} />,
          key: 'close-others',
          label: t('tabBar.closeOthers'),
          onClick: () => handleCloseOthers(tab),
        },
        {
          disabled: !hasClosableLeftTabs,
          icon: <ArrowLeftToLine size={14} />,
          key: 'close-left',
          label: t('tabBar.closeLeft'),
          onClick: () => handleCloseLeft(tab),
        },
        {
          disabled: !hasClosableRightTabs,
          icon: <ArrowRightToLine size={14} />,
          key: 'close-right',
          label: t('tabBar.closeRight'),
          onClick: () => handleCloseRight(tab),
        },
        {
          disabled: !hasClosableTabs,
          icon: <Trash2 size={14} />,
          key: 'close-all',
          label: t('tabBar.closeAll'),
          onClick: () => handleCloseAll(),
        },
        {
          type: 'divider' as const,
        },
        {
          icon: <RefreshCw size={14} />,
          key: 'refresh-current',
          label: t('tabBar.refreshCurrent'),
          onClick: () => {
            void handleRefreshTab(tab)
          },
        },
      ]
    },
    [
      handleCloseAll,
      handleCloseLeft,
      handleCloseOthers,
      handleCloseRight,
      handleCloseTab,
      handleRefreshTab,
      t,
      visibleTabs,
    ],
  )

  const contextMenuByTabId = useMemo(
    () => new Map(visibleTabs.map((tab) => [tab.id, { items: getContextMenuItems(tab) }])),
    [getContextMenuItems, visibleTabs],
  )

  const handleWheel = useCallback((event: WheelEvent) => {
    const container = scrollContainerRef.current
    if (!container) return

    event.preventDefault()
    container.scrollLeft += event.deltaY || event.deltaX
  }, [])

  const touchStartX = useRef(0)
  const touchStartScrollLeft = useRef(0)
  const isDragging = useRef(false)

  const handleTouchStart = useCallback((event: TouchEvent) => {
    const container = scrollContainerRef.current
    const touch = event.touches[0]
    if (!container || !touch) return

    touchStartX.current = touch.clientX
    touchStartScrollLeft.current = container.scrollLeft
    isDragging.current = true
  }, [])

  const handleTouchMove = useCallback((event: TouchEvent) => {
    const container = scrollContainerRef.current
    const touch = event.touches[0]
    if (!container || !touch || !isDragging.current) return

    event.preventDefault()
    container.scrollLeft = touchStartScrollLeft.current + (touchStartX.current - touch.clientX)
  }, [])

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !activeTabId) return

    const rafId = requestAnimationFrame(() => {
      const activeEl = container.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`)
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    })

    return () => cancelAnimationFrame(rafId)
  }, [activeTabId, visibleTabs.length])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    if (isMobile) {
      container.addEventListener('touchstart', handleTouchStart, { passive: true })
      container.addEventListener('touchmove', handleTouchMove, { passive: false })
      container.addEventListener('touchend', handleTouchEnd, { passive: true })
    } else {
      container.addEventListener('wheel', handleWheel, { passive: false })
    }

    return () => {
      if (isMobile) {
        container.removeEventListener('touchstart', handleTouchStart)
        container.removeEventListener('touchmove', handleTouchMove)
        container.removeEventListener('touchend', handleTouchEnd)
      } else {
        container.removeEventListener('wheel', handleWheel)
      }
    }
  }, [handleTouchEnd, handleTouchMove, handleTouchStart, handleWheel, isMobile])

  return (
    <div className="guide-tab-bar p-1 md:p-2">
      <div className="flex items-center justify-between">
        <div
          ref={scrollContainerRef}
          className="scrollbar-hide flex flex-1 items-center gap-x-1 overflow-x-auto"
          style={scrollContainerStyle}
        >
          {visibleTabs.map((tab) => {
            const label = tab.translateLabel === false ? tab.label : t(tab.label)
            const title = tab.description ? `${label}\n${tab.description}` : label

            return (
              <Dropdown key={tab.id} menu={contextMenuByTabId.get(tab.id)} trigger={contextMenuTrigger}>
                <div
                  data-tab-id={tab.id}
                  onClick={() => handleTabClick(tab.id, tab.path)}
                  title={title}
                  className={clsx(
                    'group relative flex max-w-[220px] cursor-pointer items-center gap-x-2 px-3 py-1.5 text-sm whitespace-nowrap transition-colors select-none',
                    activeTabId === tab.id ? 'text-primary' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  <span className="min-w-0 truncate">{label}</span>
                  {tab.closable !== false && (
                    <button
                      type="button"
                      aria-label={t('tabBar.closeCurrent')}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleCloseTab(tab.id)
                      }}
                      className={clsx(
                        'relative z-10 shrink-0 cursor-pointer rounded-sm p-0.5 transition-colors',
                        activeTabId === tab.id ? 'hover:bg-primary/10' : 'hover:bg-surface-muted hover:text-fg',
                      )}
                    >
                      <X size={16} />
                    </button>
                  )}
                  {/* 底部下划线 */}
                  <span
                    className={clsx(
                      'absolute bottom-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full transition-all duration-300 ease-out',
                      activeTabId === tab.id ? 'bg-primary w-full' : 'bg-border w-0 group-hover:w-full',
                    )}
                  />
                </div>
              </Dropdown>
            )
          })}
        </div>
      </div>
    </div>
  )
}
