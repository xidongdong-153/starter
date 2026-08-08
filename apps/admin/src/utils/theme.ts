import type { RosePineTheme } from '@starter/theme'

import { resolveTheme } from '@starter/theme'
import { generateColorShades, hexToRgb, mixColors } from '@starter/theme/color'
import { getThemeById } from '@starter/theme/palette'

export type { RosePineColor, RosePineTheme, ThemeName } from '@starter/theme'
export {
  DARK_THEME,
  DEFAULT_THEME,
  getNextTheme,
  getThemeByMode,
  isDarkTheme,
  isThemeName,
  LIGHT_THEME,
  resolveTheme,
  THEMES,
} from '@starter/theme'
export { generateColorShades, hexToHsl, hexToRgb, hexToRgba, hslToHex, mixColors } from '@starter/theme/color'
export { getPrimaryColorByTheme, getThemeById, getThemeColors } from '@starter/theme/palette'

export const THEME_STORAGE_KEY = 'starter-admin-setting'

/**
 * 系统是否偏好深色
 */
export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 写入 html 上的 data-theme
 * @param themeId 主题 ID（dawn | moon）
 */
export function updateThemeAttribute(themeId: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolveTheme(themeId)
  }
}

/**
 * 写入主色相关的 CSS 变量，同时生成色阶供 TailwindCSS 使用
 */
export function updatePrimaryColorAttribute(color: string) {
  if (typeof document === 'undefined') return

  const rgb = hexToRgb(color)
  if (!rgb) return

  const root = document.documentElement

  root.style.setProperty('--primary-color', color)
  root.style.setProperty('--primary-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`)

  const shades = generateColorShades(color)
  for (const [shade, shadeColor] of Object.entries(shades)) {
    root.style.setProperty(`--color-primary-${shade}`, shadeColor)
    if (shade === '900') {
      root.style.setProperty('--color-primary-950', mixColors(color, '#000000', 0.05))
    }
  }
}

/**
 * 按主题模式算出当前是否深色
 */
export function calculateIsDark(themeMode: 'light' | 'dark' | 'system'): boolean {
  switch (themeMode) {
    case 'dark':
      return true
    case 'light':
      return false
    case 'system':
      return getSystemPrefersDark()
    default:
      return false
  }
}

/**
 * 取主题的完整配置
 */
export function getRosePineThemeConfig(themeId: string): RosePineTheme | undefined {
  return getThemeById(themeId)
}
