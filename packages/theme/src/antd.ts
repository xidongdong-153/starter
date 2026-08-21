import type { ThemeConfig } from 'antd'

import { theme } from 'antd'

import { hexToRgba, mixColors } from './color.js'

/**
 * Rose Pine 主题的 Ant Design 配置。
 * 色板来自 Rose Pine Dawn 和 Rose Pine Moon，主色取 Pine。
 */

const LIGHT_SURFACE_ALPHA = {
  container: 0.84,
  elevated: 0.92,
  field: 0.74,
  layout: 0.9,
  tableHeader: 0.5,
  table: 0.78,
  tableActive: 0.62,
  tableChrome: 0.72,
}

const DARK_SURFACE_ALPHA = {
  container: 0.86,
  elevated: 0.94,
  field: 0.8,
  layout: 0.9,
  tableHeader: 0.46,
  table: 0.8,
  tableActive: 0.58,
  tableChrome: 0.74,
}

// ============ Dawn (浅色) ============
const DAWN_BASE = '#faf4ed'
const DAWN_SURFACE = '#fffaf3'
const DAWN_OVERLAY = '#f2e9e1'
const DAWN_BORDER = '#dfdad9'
const DAWN_BORDER_SUBTLE = '#f2e9e1'
const DAWN_PRIMARY = '#286983'

const DAWN_TOKENS = {
  colorBgBase: DAWN_BASE,
  colorBgContainer: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),
  colorBgElevated: hexToRgba(DAWN_SURFACE, LIGHT_SURFACE_ALPHA.elevated),
  colorBgLayout: DAWN_BASE,

  colorBorder: DAWN_BORDER,
  colorBorderSecondary: DAWN_BORDER_SUBTLE,

  // 错误 - Love
  colorError: '#b4637a',
  colorErrorBg: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),
  // 信息 - Iris
  colorInfo: '#907aa9',
  colorInfoBg: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),
  // 主色 - Pine
  colorPrimary: DAWN_PRIMARY,
  colorPrimaryActive: DAWN_PRIMARY,
  colorPrimaryBg: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),
  colorPrimaryBgHover: hexToRgba(DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.table),
  colorPrimaryBorder: DAWN_BORDER,
  colorPrimaryBorderHover: DAWN_PRIMARY,
  colorPrimaryHover: DAWN_PRIMARY,
  colorPrimaryText: DAWN_PRIMARY,
  colorPrimaryTextHover: DAWN_PRIMARY,
  // 成功 - Foam
  colorSuccess: '#56949f',
  colorSuccessBg: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),
  // 警告 - Gold
  colorWarning: '#ea9d34',
  colorWarningBg: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),

  // 文字层级
  colorText: '#575279',
  colorTextBase: '#575279',
  colorTextSecondary: '#797593',
  colorTextTertiary: '#9893a5',
  colorTextQuaternary: '#9893a5',
}

const DAWN_COMPONENTS = {
  Button: {
    colorPrimary: DAWN_PRIMARY,
  },
  Card: {
    colorBgContainer: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),
    colorBorder: DAWN_BORDER,
  },
  Dropdown: {
    colorBgContainer: hexToRgba(DAWN_SURFACE, LIGHT_SURFACE_ALPHA.elevated),
  },
  Input: {
    colorBgContainer: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.field),
    colorBorder: DAWN_BORDER,
    colorBorderHover: DAWN_PRIMARY,
    colorPrimaryHover: DAWN_PRIMARY,
  },
  Layout: {
    colorBgBody: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.container),
    colorBgHeader: hexToRgba(DAWN_SURFACE, LIGHT_SURFACE_ALPHA.layout),
  },
  Menu: {
    itemSelectedBg: hexToRgba(DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.table),
    subMenuItemBg: 'transparent',
  },
  Modal: {
    colorBgContainer: hexToRgba(DAWN_SURFACE, LIGHT_SURFACE_ALPHA.elevated),
    colorBorder: DAWN_BORDER,
  },
  Select: {
    colorBgContainer: hexToRgba(DAWN_BASE, LIGHT_SURFACE_ALPHA.field),
    colorBorder: DAWN_BORDER,
    colorPrimaryHover: DAWN_PRIMARY,
  },
  // 单元格背景必须不透明：fixed 列靠 sticky 浮在其他单元格上方，
  // 半透明会把横向滚动到下层的内容透出来（开关、文字重叠）。
  // 这里保留原来的透明度数值，改成与页面底色混合后的实色。
  Table: {
    colorBgContainer: DAWN_BASE,
    colorBorder: DAWN_BORDER,
    colorBorderSecondary: DAWN_BORDER_SUBTLE,
    headerBg: mixColors(DAWN_BASE, DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.tableHeader),
    headerSortActiveBg: mixColors(DAWN_BASE, DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.tableActive),
    headerSortHoverBg: mixColors(DAWN_BASE, DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.tableActive),
    bodySortBg: DAWN_BASE,
    expandIconBg: DAWN_BASE,
    filterDropdownBg: hexToRgba(DAWN_SURFACE, LIGHT_SURFACE_ALPHA.elevated),
    filterDropdownMenuBg: hexToRgba(DAWN_SURFACE, LIGHT_SURFACE_ALPHA.elevated),
    fixedHeaderSortActiveBg: mixColors(DAWN_BASE, DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.tableActive),
    footerBg: mixColors(DAWN_BASE, DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.table),
    headerFilterHoverBg: mixColors(DAWN_BASE, DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.tableChrome),
    headerSplitColor: hexToRgba(DAWN_BORDER, LIGHT_SURFACE_ALPHA.tableChrome),
    rowHoverBg: mixColors(DAWN_BASE, DAWN_OVERLAY, LIGHT_SURFACE_ALPHA.field),
    rowExpandedBg: DAWN_BASE,
    rowSelectedBg: mixColors(DAWN_BASE, DAWN_PRIMARY, 0.1),
    rowSelectedHoverBg: mixColors(DAWN_BASE, DAWN_PRIMARY, 0.14),
    stickyScrollBarBg: hexToRgba('#797593', 0.28),
  },
  Tabs: {
    colorPrimary: DAWN_PRIMARY,
    inkBarColor: DAWN_PRIMARY,
  },
}

// ============ Moon (深色) ============
const MOON_BASE = '#232136'
const MOON_SURFACE = '#1f1d2e'
const MOON_OVERLAY = '#2a273f'
const MOON_BORDER = '#44415a'
const MOON_BORDER_SUBTLE = '#393552'
const MOON_PRIMARY = '#3e8fb0'

const MOON_TOKENS = {
  colorBgBase: MOON_BASE,
  colorBgContainer: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),
  colorBgElevated: hexToRgba(MOON_OVERLAY, DARK_SURFACE_ALPHA.elevated),
  colorBgLayout: MOON_BASE,

  colorBorder: MOON_BORDER,
  colorBorderSecondary: MOON_BORDER_SUBTLE,

  colorError: '#eb6f92',
  colorErrorBg: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),
  colorInfo: '#c4a7e7',
  colorInfoBg: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),
  colorPrimary: MOON_PRIMARY,
  colorPrimaryActive: MOON_PRIMARY,
  colorPrimaryBg: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),
  colorPrimaryBgHover: hexToRgba(MOON_SURFACE, DARK_SURFACE_ALPHA.table),
  colorPrimaryBorder: MOON_BORDER,
  colorPrimaryBorderHover: MOON_PRIMARY,
  colorPrimaryHover: MOON_PRIMARY,
  colorPrimaryText: MOON_PRIMARY,
  colorPrimaryTextHover: MOON_PRIMARY,
  colorSuccess: '#9ccfd8',
  colorSuccessBg: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),
  colorWarning: '#f6c177',
  colorWarningBg: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),

  colorText: '#e0def4',
  colorTextBase: '#e0def4',
  colorTextSecondary: '#908caa',
  colorTextTertiary: '#6e6a86',
  colorTextQuaternary: '#6e6a86',
}

const MOON_COMPONENTS = {
  Button: {
    colorPrimary: MOON_PRIMARY,
  },
  Card: {
    colorBgContainer: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),
    colorBorder: MOON_BORDER,
  },
  Dropdown: {
    colorBgContainer: hexToRgba(MOON_OVERLAY, DARK_SURFACE_ALPHA.elevated),
  },
  Input: {
    colorBgContainer: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.field),
    colorBorder: MOON_BORDER,
    colorBorderHover: MOON_PRIMARY,
    colorPrimaryHover: MOON_PRIMARY,
  },
  Layout: {
    colorBgBody: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.container),
    colorBgHeader: hexToRgba(MOON_SURFACE, DARK_SURFACE_ALPHA.layout),
  },
  Menu: {
    itemSelectedBg: hexToRgba(MOON_OVERLAY, DARK_SURFACE_ALPHA.table),
    subMenuItemBg: 'transparent',
  },
  Modal: {
    colorBgContainer: hexToRgba(MOON_OVERLAY, DARK_SURFACE_ALPHA.elevated),
    colorBorder: MOON_BORDER,
  },
  Select: {
    colorBgContainer: hexToRgba(MOON_BASE, DARK_SURFACE_ALPHA.field),
    colorBorder: MOON_BORDER,
    colorPrimaryHover: MOON_PRIMARY,
  },
  // 同 Dawn：fixed 列需要实色单元格背景，避免透出下层内容。
  Table: {
    colorBgContainer: MOON_BASE,
    colorBorder: MOON_BORDER,
    colorBorderSecondary: MOON_BORDER_SUBTLE,
    headerBg: mixColors(MOON_BASE, MOON_SURFACE, DARK_SURFACE_ALPHA.tableHeader),
    headerSortActiveBg: mixColors(MOON_BASE, MOON_SURFACE, DARK_SURFACE_ALPHA.tableActive),
    headerSortHoverBg: mixColors(MOON_BASE, MOON_SURFACE, DARK_SURFACE_ALPHA.tableActive),
    bodySortBg: MOON_BASE,
    expandIconBg: MOON_BASE,
    filterDropdownBg: hexToRgba(MOON_OVERLAY, DARK_SURFACE_ALPHA.elevated),
    filterDropdownMenuBg: hexToRgba(MOON_SURFACE, DARK_SURFACE_ALPHA.elevated),
    fixedHeaderSortActiveBg: mixColors(MOON_BASE, MOON_SURFACE, DARK_SURFACE_ALPHA.tableActive),
    footerBg: mixColors(MOON_BASE, MOON_SURFACE, DARK_SURFACE_ALPHA.table),
    headerFilterHoverBg: mixColors(MOON_BASE, MOON_SURFACE, DARK_SURFACE_ALPHA.tableChrome),
    headerSplitColor: hexToRgba(MOON_BORDER_SUBTLE, DARK_SURFACE_ALPHA.tableChrome),
    rowHoverBg: mixColors(MOON_BASE, MOON_SURFACE, DARK_SURFACE_ALPHA.field),
    rowExpandedBg: MOON_BASE,
    rowSelectedBg: mixColors(MOON_BASE, MOON_PRIMARY, 0.12),
    rowSelectedHoverBg: mixColors(MOON_BASE, MOON_PRIMARY, 0.16),
    stickyScrollBarBg: hexToRgba('#6e6a86', 0.32),
  },
  Tabs: {
    colorPrimary: MOON_PRIMARY,
    inkBarColor: MOON_PRIMARY,
  },
}

/**
 * 取 Rose Pine 主题对应的 Ant Design 配置。
 * @param themeId dawn 或 moon，其他值按 dawn 处理
 */
export function getAntdThemeConfig(themeId: string): ThemeConfig {
  const baseConfig = {
    components: {},
    token: {
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
  }

  if (themeId === 'moon') {
    return {
      ...baseConfig,
      algorithm: theme.darkAlgorithm,
      components: { ...MOON_COMPONENTS },
      token: { ...baseConfig.token, ...MOON_TOKENS },
    }
  }

  return {
    ...baseConfig,
    algorithm: theme.defaultAlgorithm,
    components: { ...DAWN_COMPONENTS },
    token: { ...baseConfig.token, ...DAWN_TOKENS },
  }
}
