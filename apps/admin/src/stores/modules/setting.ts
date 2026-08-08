import type { ThemeName } from '@admin/utils/theme'
import type { BaseStore } from '../types'

import { getPrimaryColorByTheme } from '@admin/config/theme'
import {
  calculateIsDark,
  DEFAULT_THEME,
  getSystemPrefersDark,
  getThemeByMode,
  isDarkTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  updatePrimaryColorAttribute,
  updateThemeAttribute,
} from '@admin/utils/theme'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 主题 ID：dawn 或 moon */
export type AdminThemeId = ThemeName

export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * 控制台设置状态
 */
export interface SettingState extends BaseStore {
  adminTheme: AdminThemeId
  initTheme: () => void
  isDark: boolean
  isMobileMenuOpen: boolean
  isSettingDrawerOpen: boolean
  isSidebarCollapsed: boolean
  language: string
  resetToSystemTheme: () => void
  setAdminTheme: (theme: AdminThemeId) => void
  setDarkMode: (isDark: boolean) => void
  setLanguage: (language: string) => void
  setMobileMenuOpen: (open: boolean) => void
  setSettingDrawerOpen: (open: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setThemeMode: (mode: ThemeMode) => void
  themeMode: ThemeMode
  toggleDarkMode: () => void
  toggleLanguage: () => void
  toggleMobileMenu: () => void
  toggleSidebarCollapsed: () => void
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * 同步应用主题到 DOM，避免首屏闪烁
 */
function applyThemeToDom(theme: AdminThemeId) {
  updateThemeAttribute(theme)
  updatePrimaryColorAttribute(getPrimaryColorByTheme(theme))
}

/**
 * store 初始化时读取持久化的主题设置
 */
function getInitialThemeState() {
  let themeMode: ThemeMode = 'system'
  let adminTheme: AdminThemeId = DEFAULT_THEME
  let language = 'zh'

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as { state?: Record<string, unknown> }
        const state = parsed.state ?? {}

        themeMode = isThemeMode(state.themeMode) ? state.themeMode : 'system'
        language = typeof state.language === 'string' ? state.language : 'zh'
        adminTheme = resolveTheme(typeof state.adminTheme === 'string' ? state.adminTheme : undefined)
      }
    } catch {
      // 解析失败时用默认值
    }

    if (themeMode === 'system') {
      adminTheme = getThemeByMode(getSystemPrefersDark())
    }
  }

  const isDark = calculateIsDark(themeMode)

  if (typeof document !== 'undefined') {
    applyThemeToDom(adminTheme)
  }

  return { adminTheme, isDark, language, themeMode }
}

/**
 * 控制台设置 Store，持久化主题模式、主题和语言
 */
export const useSettingStore = create<SettingState>()(
  persist(
    (set, get) => {
      const initialTheme = getInitialThemeState()

      return {
        adminTheme: initialTheme.adminTheme,

        initTheme: () => {
          const { adminTheme, themeMode } = get()
          set({ isDark: calculateIsDark(themeMode) })
          applyThemeToDom(adminTheme)
        },

        isDark: initialTheme.isDark,

        isMobileMenuOpen: false,

        isSettingDrawerOpen: false,

        isSidebarCollapsed: false,

        language: initialTheme.language,

        reset: () => {
          set({
            adminTheme: DEFAULT_THEME,
            isDark: false,
            isSidebarCollapsed: false,
            language: 'zh',
            themeMode: 'system',
          })
          applyThemeToDom(DEFAULT_THEME)
        },

        resetToSystemTheme: () => {
          const isDark = getSystemPrefersDark()
          const adminTheme = getThemeByMode(isDark)
          set({ adminTheme, isDark, themeMode: 'system' })
          applyThemeToDom(adminTheme)
        },

        setAdminTheme: (adminTheme: AdminThemeId) => {
          const isDark = isDarkTheme(adminTheme)
          set({ adminTheme, isDark, themeMode: isDark ? 'dark' : 'light' })
          applyThemeToDom(adminTheme)
        },

        setDarkMode: (isDark: boolean) => {
          const adminTheme = getThemeByMode(isDark)
          set({ adminTheme, isDark, themeMode: isDark ? 'dark' : 'light' })
          applyThemeToDom(adminTheme)
        },

        setLanguage: async (language: string) => {
          set({ language })
          // 动态导入 i18n 访问器，避免和 App.tsx 的静态导入冲突
          const { getI18nInstance } = await import('@admin/i18n/instance')
          await getI18nInstance().changeLanguage(language)
        },

        setMobileMenuOpen: (open: boolean) => {
          set({ isMobileMenuOpen: open })
        },

        setSettingDrawerOpen: (open: boolean) => {
          set({ isSettingDrawerOpen: open })
        },

        setSidebarCollapsed: (isSidebarCollapsed: boolean) => {
          set({ isSidebarCollapsed })
        },

        setThemeMode: (themeMode: ThemeMode) => {
          const isDark = calculateIsDark(themeMode)
          const adminTheme = getThemeByMode(isDark)
          set({ adminTheme, isDark, themeMode })
          applyThemeToDom(adminTheme)
        },

        themeMode: initialTheme.themeMode,

        toggleDarkMode: () => {
          const isDark = !get().isDark
          const adminTheme = getThemeByMode(isDark)
          set({ adminTheme, isDark, themeMode: isDark ? 'dark' : 'light' })
          applyThemeToDom(adminTheme)
        },

        toggleLanguage: async () => {
          const nextLanguage = get().language === 'zh' ? 'en' : 'zh'
          set({ language: nextLanguage })
          const { getI18nInstance } = await import('@admin/i18n/instance')
          await getI18nInstance().changeLanguage(nextLanguage)
        },

        toggleMobileMenu: () => {
          set({ isMobileMenuOpen: !get().isMobileMenuOpen })
        },

        toggleSidebarCollapsed: () => {
          set({ isSidebarCollapsed: !get().isSidebarCollapsed })
        },
      }
    },
    {
      name: THEME_STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyThemeToDom(state.adminTheme)
        }
      },
      partialize: (state) => ({
        adminTheme: state.adminTheme,
        language: state.language,
        themeMode: state.themeMode,
      }),
    },
  ),
)

// 跟随系统时，监听系统主题变化
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  mediaQuery.addEventListener?.('change', () => {
    const store = useSettingStore.getState()

    if (store.themeMode !== 'system') {
      return
    }

    const isDark = getSystemPrefersDark()
    const adminTheme = getThemeByMode(isDark)
    useSettingStore.setState({ adminTheme, isDark })
    applyThemeToDom(adminTheme)
  })
}
