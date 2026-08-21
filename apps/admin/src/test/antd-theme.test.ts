import { getAntdThemeConfig } from '@admin/utils/antd-theme'
import { describe, expect, it } from 'vitest'

/**
 * fixed 列是 sticky 单元格，浮在其他单元格上方。
 * 只要这些背景 token 带透明度，横向滚动时下层内容就会透出来。
 */
const OPAQUE_CELL_BG_TOKENS = [
  'colorBgContainer',
  'headerBg',
  'headerSortActiveBg',
  'headerSortHoverBg',
  'fixedHeaderSortActiveBg',
  'bodySortBg',
  'footerBg',
  'rowHoverBg',
  'rowExpandedBg',
  'rowSelectedBg',
  'rowSelectedHoverBg',
] as const

describe('antd 表格主题 token', () => {
  it.each(['dawn', 'moon'])('%s 主题的表格单元格背景是实色', (themeId) => {
    const table = getAntdThemeConfig(themeId).components?.Table as Record<string, string> | undefined

    expect(table).toBeTruthy()
    for (const token of OPAQUE_CELL_BG_TOKENS) {
      expect(table?.[token], token).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
