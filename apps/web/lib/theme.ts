export const THEME_STORAGE_KEY = 'starter-web-theme'

export const THEME_NAMES = ['dawn', 'moon'] as const
export type ThemeName = (typeof THEME_NAMES)[number]
export type ThemeSetting = ThemeName | 'system'

export const DEFAULT_THEME_SETTING: ThemeSetting = 'system'
export const FALLBACK_LIGHT: ThemeName = 'dawn'
export const FALLBACK_DARK: ThemeName = 'moon'

export function isThemeName(value: string | null | undefined): value is ThemeName {
  return value === 'dawn' || value === 'moon'
}

export function isThemeSetting(value: string | null | undefined): value is ThemeSetting {
  return value === 'system' || isThemeName(value)
}

export function resolveThemeSetting(value: string | null | undefined): ThemeSetting {
  return isThemeSetting(value) ? value : DEFAULT_THEME_SETTING
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}
