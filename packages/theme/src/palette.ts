export interface RosePineColor {
  name: string
  value: string
}

export interface RosePineTheme {
  colors: RosePineColor[]
  id: 'dawn' | 'moon'
  name: string
}

/**
 * Rose Pine 两套色板。
 * dawn 用于浅色，moon 用于深色。
 * 主色取 Pine，SettingDrawer 的色块按这里的顺序展示。
 */
export const rosePineThemes: RosePineTheme[] = [
  {
    colors: [
      { name: 'Love', value: '#b4637a' },
      { name: 'Gold', value: '#ea9d34' },
      { name: 'Rose', value: '#d7827e' },
      { name: 'Pine', value: '#286983' },
      { name: 'Foam', value: '#56949f' },
      { name: 'Iris', value: '#907aa9' },
    ],
    id: 'dawn',
    name: 'Rosé Pine Dawn',
  },
  {
    colors: [
      { name: 'Love', value: '#eb6f92' },
      { name: 'Gold', value: '#f6c177' },
      { name: 'Rose', value: '#ea9a97' },
      { name: 'Pine', value: '#3e8fb0' },
      { name: 'Foam', value: '#9ccfd8' },
      { name: 'Iris', value: '#c4a7e7' },
    ],
    id: 'moon',
    name: 'Rosé Pine Moon',
  },
]

export function getThemeById(id: string): RosePineTheme | undefined {
  return rosePineThemes.find((theme) => theme.id === id)
}

export function getThemeColors(id: string): RosePineColor[] | null {
  const theme = getThemeById(id)
  return theme ? theme.colors : null
}

/** 取主色，对应色板里的 Pine */
export function getPrimaryColorByTheme(themeId: string): string {
  const theme = getThemeById(themeId)
  const pine = theme?.colors.find((color) => color.name === 'Pine')
  return pine?.value || '#286983'
}
