import type { BaseStore } from '../types'

import { homeRouteRecord } from '@admin/app/router/records'
import { generateTabId } from '@admin/utils/pathUtils'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 标签页数据
 */
export interface Tab {
  /** 是否可关闭 */
  closable?: boolean
  /** 辅助说明 */
  description?: string
  /** 图标名 */
  icon?: string
  /** 标签页唯一标识 */
  id: string
  /** 显示标题 */
  label: string
  /** 路由路径 */
  path: string
  /** 路由记录 ID */
  routeId?: string
  /** 是否按 i18n key 翻译标题 */
  translateLabel?: boolean
}

export type TabUpdate = Partial<Pick<Tab, 'description' | 'label' | 'translateLabel'>>

/**
 * 标签页关闭结果
 */
export interface TabCloseResult {
  /** 关闭后需要跳转的路径 */
  nextPath: null | string
}

/**
 * 标签栏状态
 */
export interface TabBarState extends BaseStore {
  /** 当前激活的标签页 ID */
  activeTabId: string
  /** 正在关闭的标签页路径 */
  closingPath: null | string
  /** 按路径添加或激活标签页 */
  addOrActivateTab: (tab: Tab) => void
  /** 添加标签页 */
  addTab: (tab: Tab) => void
  /** 关闭全部标签页 */
  closeAllTabs: () => TabCloseResult
  /** 关闭左侧标签页 */
  closeLeftTabs: (tabId: string) => TabCloseResult
  /** 关闭其他标签页 */
  closeOtherTabs: (tabId: string) => TabCloseResult
  /** 关闭右侧标签页 */
  closeRightTabs: (tabId: string) => TabCloseResult
  /** 关闭标签页 */
  closeTab: (tabId: string) => TabCloseResult
  /** 按路径查找标签页 */
  findTabByPath: (path: string) => Tab | undefined
  /** 清理关闭中的路径标记 */
  clearClosingPath: () => void
  /** 重置到默认状态 */
  reset: () => void
  /** 设置激活标签页 */
  setActiveTab: (tabId: string) => void
  /** 标签页列表 */
  tabs: Tab[]
  /** 按路径更新标签页 */
  updateTabByPath: (path: string, update: TabUpdate) => void
}

const DEFAULT_HOME_TAB: Tab = {
  closable: homeRouteRecord.tab === false ? false : (homeRouteRecord.tab?.closable ?? false),
  icon: homeRouteRecord.icon?.name,
  id: generateTabId(homeRouteRecord.path),
  label: homeRouteRecord.title,
  path: homeRouteRecord.path,
  routeId: homeRouteRecord.id,
}

function isHomeTab(tab: Tab): boolean {
  return tab.id === DEFAULT_HOME_TAB.id || tab.path === DEFAULT_HOME_TAB.path
}

function normalizeTab(tab: Tab): Tab {
  if (isHomeTab(tab)) {
    return DEFAULT_HOME_TAB
  }

  const id = generateTabId(tab.path)

  return {
    ...tab,
    closable: tab.path === '/' ? false : tab.closable,
    id,
    routeId: tab.routeId ?? (tab.id === id ? undefined : tab.id),
  }
}

function normalizeTabs(tabs: Tab[]): Tab[] {
  const normalizedTabs = tabs.map(normalizeTab)
  const nextTabs: Tab[] = []
  const seenPaths = new Set<string>()

  for (const tab of normalizedTabs) {
    if (seenPaths.has(tab.path)) {
      continue
    }

    seenPaths.add(tab.path)
    nextTabs.push(tab)
  }

  if (!seenPaths.has(DEFAULT_HOME_TAB.path)) {
    nextTabs.unshift(DEFAULT_HOME_TAB)
  }

  return nextTabs.length > 0 ? nextTabs : [DEFAULT_HOME_TAB]
}

/**
 * 返回新的激活标签页 ID
 */
function resolveActiveTabId(tabs: Tab[], fallbackTabId?: string) {
  if (fallbackTabId && tabs.some((tab) => tab.id === fallbackTabId)) {
    return fallbackTabId
  }

  return tabs[0]?.id ?? DEFAULT_HOME_TAB.id
}

/**
 * 生成关闭操作之后的状态
 */
function buildCloseState(nextTabs: Tab[], fallbackTabId?: string, closingPath: null | string = null) {
  const resolvedTabs = nextTabs.length > 0 ? nextTabs : [DEFAULT_HOME_TAB]
  const resolvedActiveTabId = resolveActiveTabId(resolvedTabs, fallbackTabId)
  const activeTab = resolvedTabs.find((tab) => tab.id === resolvedActiveTabId) ?? resolvedTabs[0] ?? DEFAULT_HOME_TAB

  return {
    state: {
      activeTabId: activeTab.id,
      closingPath,
      tabs: resolvedTabs,
    },
    result: {
      nextPath: closingPath ? activeTab.path : null,
    } satisfies TabCloseResult,
  }
}

function isTabSame(a: Tab, b: Tab) {
  return (
    a.closable === b.closable &&
    a.description === b.description &&
    a.icon === b.icon &&
    a.id === b.id &&
    a.label === b.label &&
    a.path === b.path &&
    a.routeId === b.routeId &&
    a.translateLabel === b.translateLabel
  )
}

function normalizePersistedState(state: unknown): Pick<TabBarState, 'activeTabId' | 'closingPath' | 'tabs'> {
  if (!state || typeof state !== 'object') {
    return {
      activeTabId: DEFAULT_HOME_TAB.id,
      closingPath: null,
      tabs: [DEFAULT_HOME_TAB],
    }
  }

  const persistedState = state as Partial<Pick<TabBarState, 'activeTabId' | 'tabs'>>
  const persistedTabs = Array.isArray(persistedState.tabs) ? persistedState.tabs : [DEFAULT_HOME_TAB]
  const activeTabPath = persistedTabs.find((tab) => tab.id === persistedState.activeTabId)?.path
  const tabs = normalizeTabs(persistedTabs)
  const activeTabId = activeTabPath ? generateTabId(activeTabPath) : persistedState.activeTabId

  return {
    activeTabId: resolveActiveTabId(tabs, activeTabId),
    closingPath: null,
    tabs,
  }
}

/**
 * 标签栏状态管理
 */
export const useTabBarStore = create<TabBarState>()(
  persist(
    (set, get) => ({
      activeTabId: DEFAULT_HOME_TAB.id,
      closingPath: null,

      addOrActivateTab: (tab: Tab) => {
        const normalizedTab = normalizeTab(tab)
        const normalizedTabs = normalizeTabs(get().tabs)
        const existingTab = normalizedTabs.find((item) => item.path === normalizedTab.path)

        if (existingTab) {
          set({ activeTabId: existingTab.id, tabs: normalizedTabs })
          return
        }

        set({
          activeTabId: normalizedTab.id,
          tabs: [...normalizedTabs, normalizedTab],
        })
      },

      addTab: (tab: Tab) => {
        get().addOrActivateTab(tab)
      },

      clearClosingPath: () => {
        set({ closingPath: null })
      },

      closeAllTabs: () => {
        const { activeTabId, tabs } = get()
        const unclosableTabs = tabs.filter((tab) => tab.closable === false)
        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const activeWillClose = activeTab ? !unclosableTabs.some((tab) => tab.id === activeTab.id) : false
        const { result, state } = buildCloseState(
          unclosableTabs,
          activeWillClose ? undefined : activeTabId,
          activeWillClose ? (activeTab?.path ?? null) : null,
        )

        set(state)
        return result
      },

      closeLeftTabs: (tabId: string) => {
        const { activeTabId, tabs } = get()
        const targetIndex = tabs.findIndex((tab) => tab.id === tabId)

        if (targetIndex === -1) {
          return { nextPath: null }
        }

        const nextTabs = tabs.filter((tab, index) => index >= targetIndex || tab.closable === false)
        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const activeWillClose = activeTab ? !nextTabs.some((tab) => tab.id === activeTab.id) : false
        const { result, state } = buildCloseState(
          nextTabs,
          activeWillClose ? tabId : activeTabId,
          activeWillClose ? (activeTab?.path ?? null) : null,
        )

        set(state)
        return result
      },

      closeOtherTabs: (tabId: string) => {
        const { activeTabId, tabs } = get()

        if (!tabs.some((tab) => tab.id === tabId)) {
          return { nextPath: null }
        }

        const nextTabs = tabs.filter((tab) => tab.id === tabId || tab.closable === false)
        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const activeWillClose = activeTab ? !nextTabs.some((tab) => tab.id === activeTab.id) : false
        const { result, state } = buildCloseState(
          nextTabs,
          activeWillClose ? tabId : activeTabId,
          activeWillClose ? (activeTab?.path ?? null) : null,
        )

        set(state)
        return result
      },

      closeRightTabs: (tabId: string) => {
        const { activeTabId, tabs } = get()
        const targetIndex = tabs.findIndex((tab) => tab.id === tabId)

        if (targetIndex === -1) {
          return { nextPath: null }
        }

        const nextTabs = tabs.filter((tab, index) => index <= targetIndex || tab.closable === false)
        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const activeWillClose = activeTab ? !nextTabs.some((tab) => tab.id === activeTab.id) : false
        const { result, state } = buildCloseState(
          nextTabs,
          activeWillClose ? tabId : activeTabId,
          activeWillClose ? (activeTab?.path ?? null) : null,
        )

        set(state)
        return result
      },

      closeTab: (tabId: string) => {
        const { activeTabId, tabs } = get()
        const tabToClose = tabs.find((tab) => tab.id === tabId)

        if (!tabToClose || tabToClose.closable === false) {
          return { nextPath: null }
        }

        const nextTabs = tabs.filter((tab) => tab.id !== tabId)
        let fallbackTabId = activeTabId
        let closingPath: null | string = null

        if (activeTabId === tabId) {
          const closedIndex = tabs.findIndex((tab) => tab.id === tabId)
          closingPath = tabToClose.path
          fallbackTabId = nextTabs[closedIndex]?.id ?? nextTabs[nextTabs.length - 1]?.id ?? DEFAULT_HOME_TAB.id
        }

        const { result, state } = buildCloseState(nextTabs, fallbackTabId, closingPath)
        set(state)
        return result
      },

      findTabByPath: (path: string) => {
        return get().tabs.find((tab) => tab.path === path)
      },

      reset: () => {
        set({
          activeTabId: DEFAULT_HOME_TAB.id,
          closingPath: null,
          tabs: [DEFAULT_HOME_TAB],
        })
      },

      setActiveTab: (tabId: string) => {
        if (get().tabs.some((tab) => tab.id === tabId)) {
          set({ activeTabId: tabId })
        }
      },

      tabs: [DEFAULT_HOME_TAB],

      updateTabByPath: (path: string, update: TabUpdate) => {
        const { tabs } = get()
        let changed = false

        const nextTabs = tabs.map((tab) => {
          if (tab.path !== path) {
            return tab
          }

          const nextTab = normalizeTab({ ...tab, ...update })

          if (!isTabSame(tab, nextTab)) {
            changed = true
          }

          return nextTab
        })

        if (changed) {
          set({ tabs: nextTabs })
        }
      },
    }),
    {
      migrate: (persistedState) => normalizePersistedState(persistedState),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedState(persistedState),
      }),
      name: 'starter-admin-tab-bar',
      partialize: (state) => ({
        activeTabId: state.activeTabId,
        tabs: state.tabs,
      }),
      version: 1,
    },
  ),
)
