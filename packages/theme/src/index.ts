export const THEMES = ['dawn', 'moon'] as const

export type ThemeName = (typeof THEMES)[number]

/** 浅色主题 ID */
export const LIGHT_THEME: ThemeName = 'dawn'

/** 深色主题 ID */
export const DARK_THEME: ThemeName = 'moon'

export const DEFAULT_THEME: ThemeName = LIGHT_THEME

export { getPrimaryColorByTheme, getThemeById, getThemeColors, rosePineThemes } from './palette.js'
export type { RosePineColor, RosePineTheme } from './palette.js'

export function isThemeName(value: string | null | undefined): value is ThemeName {
  return typeof value === 'string' && THEMES.includes(value as ThemeName)
}

export function resolveTheme(value: string | null | undefined): ThemeName {
  return isThemeName(value) ? value : DEFAULT_THEME
}

export function getNextTheme(theme: ThemeName): ThemeName {
  const index = THEMES.indexOf(theme)

  return THEMES[(index + 1) % THEMES.length] as ThemeName
}

export function applyTheme(theme: ThemeName, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme
}

export function isDarkTheme(themeId: string): boolean {
  return themeId === DARK_THEME
}

/** 按深浅返回对应主题 ID */
export function getThemeByMode(isDark: boolean): ThemeName {
  return isDark ? DARK_THEME : LIGHT_THEME
}
