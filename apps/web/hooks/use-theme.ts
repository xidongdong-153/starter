'use client'

import type { ThemeName, ThemeSetting } from '@web/lib/theme'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { applyTheme, FALLBACK_DARK, FALLBACK_LIGHT, resolveThemeSetting, THEME_STORAGE_KEY } from '@web/lib/theme'

function getSystemTheme(): ThemeName {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? FALLBACK_DARK : FALLBACK_LIGHT
}

function activateTheme(setting: ThemeSetting): void {
  applyTheme(setting === 'system' ? getSystemTheme() : setting)
  document.documentElement.dataset.themeSetting = setting
  window.localStorage.setItem(THEME_STORAGE_KEY, setting)
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeSetting | null>(null)

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    const initial = resolveThemeSetting(stored ?? document.documentElement.dataset.themeSetting)
    setThemeState(initial)
  }, [])

  useEffect(() => {
    if (!theme) return

    activateTheme(theme)
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => activateTheme('system')
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = useCallback((nextTheme: ThemeSetting) => {
    startTransition(() => setThemeState(nextTheme))
  }, [])

  return { setTheme, theme } as const
}
