export interface RgbColor {
  b: number
  g: number
  r: number
}

export interface HslColor {
  h: number
  l: number
  s: number
}

export function hexToRgb(hex: string): RgbColor | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        b: Number.parseInt(result[3] as string, 16),
        g: Number.parseInt(result[2] as string, 16),
        r: Number.parseInt(result[1] as string, 16),
      }
    : null
}

export function hexToRgba(hex: string, alpha: number = 1): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return 'rgba(0, 0, 0, 0)'

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

export function hexToHsl(hex: string): HslColor | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null

  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return {
    h: Math.round(h * 360),
    l: Math.round(l * 100),
    s: Math.round(s * 100),
  }
}

export function hslToHex(h: number, s: number, l: number): string {
  const normalizedLightness = l / 100
  const a = (s * Math.min(normalizedLightness, 1 - normalizedLightness)) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = normalizedLightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function mixColors(color1: string, color2: string, ratio: number): string {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)

  if (!rgb1 || !rgb2) return color1

  const r = Math.round(rgb1.r * (1 - ratio) + rgb2.r * ratio)
  const g = Math.round(rgb1.g * (1 - ratio) + rgb2.g * ratio)
  const b = Math.round(rgb1.b * (1 - ratio) + rgb2.b * ratio)

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * 生成 50 到 900 的色阶，供 TailwindCSS 变量使用。
 */
export function generateColorShades(color: string): Record<string, string> {
  const shades: Record<string, string> = {}
  const ratios: Record<string, number> = {
    50: 0.95,
    100: 0.9,
    200: 0.8,
    300: 0.7,
    400: 0.6,
    500: 0.5,
    600: 0.4,
    700: 0.3,
    800: 0.2,
    900: 0.1,
  }

  for (const [shade, ratio] of Object.entries(ratios)) {
    if (Number.parseInt(shade) <= 500) {
      shades[shade] = mixColors('#ffffff', color, ratio)
    } else {
      shades[shade] = mixColors(color, '#000000', 1 - ratio)
    }
  }

  return shades
}
