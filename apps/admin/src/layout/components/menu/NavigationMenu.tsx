import type { MenuItem } from '@admin/utils/pathUtils'
import type { MenuProps } from 'antd'

import { useSettingStore } from '@admin/stores'
import { findMatchingMenuState } from '@admin/utils/pathUtils'
import { getAntdThemeConfig } from '@admin/utils/antd-theme'
import { getPrimaryColorByTheme, hexToRgba } from '@admin/utils/theme'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { ConfigProvider, Menu } from 'antd'
import { clsx } from 'clsx'
import { useCallback, useMemo } from 'react'

const EMPTY_SELECTED_KEYS: string[] = []
const EMPTY_MENU_ITEMS: MenuItem[] = []

interface NavigationMenuProps {
  /** 自定义类名 */
  className?: string
  /** 默认选中项 */
  defaultSelectedKeys?: string[]
  /** 是否折叠，仅 inline 模式有效 */
  inlineCollapsed?: boolean
  /** 菜单数据 */
  items?: MenuItem[]
  /** 菜单模式 */
  mode?: 'vertical' | 'horizontal' | 'inline'
  /** 点击回调 */
  onMenuClick?: (key: string) => void
  /** 自定义样式 */
  style?: React.CSSProperties
}

/**
 * 导航菜单。按当前路由高亮，点击后跳路由。
 */
export function NavigationMenu({
  className,
  defaultSelectedKeys = EMPTY_SELECTED_KEYS,
  inlineCollapsed = false,
  items = EMPTY_MENU_ITEMS,
  mode = 'inline',
  onMenuClick,
  style,
}: NavigationMenuProps) {
  const adminTheme = useSettingStore((state) => state.adminTheme)
  const isDark = useSettingStore((state) => state.isDark)
  const navigate = useNavigate()
  const location = useLocation()

  const primaryColor = useMemo(() => getPrimaryColorByTheme(adminTheme), [adminTheme])
  const themeConfig = useMemo(() => getAntdThemeConfig(adminTheme), [adminTheme])
  const menuSelectedBg = useMemo(() => hexToRgba(primaryColor, isDark ? 0.18 : 0.12), [isDark, primaryColor])
  const popupBg = themeConfig.token?.colorBgElevated

  const antdTheme = useMemo(
    () => ({
      ...themeConfig,
      components: {
        ...themeConfig.components,
        Menu: {
          ...(themeConfig.components?.Menu ?? {}),
          activeBarBorderWidth: 0,
          darkItemBg: 'transparent',
          darkItemSelectedBg: menuSelectedBg,
          darkPopupBg: popupBg,
          darkSubMenuItemBg: 'transparent',
          itemBg: 'transparent',
          itemSelectedBg: menuSelectedBg,
          popupBg,
          subMenuItemBg: 'transparent',
        },
      },
      token: {
        ...themeConfig.token,
        colorPrimary: primaryColor,
      },
    }),
    [menuSelectedBg, popupBg, primaryColor, themeConfig],
  )

  const menuStyle = useMemo(() => ({ width: '100%', ...style }), [style])

  const handleMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(
    (event) => {
      onMenuClick?.(event.key)

      if (event.key.startsWith('/')) {
        void navigate({ to: event.key })
      }
    },
    [navigate, onMenuClick],
  )

  const currentPath = location.pathname
  const { openKeys: routeOpenKeys, selectedKeys: matchedSelectedKeys } = useMemo(
    () => findMatchingMenuState(items, currentPath),
    [currentPath, items],
  )
  const selectedKeys = matchedSelectedKeys.length > 0 ? matchedSelectedKeys : defaultSelectedKeys
  const menuKey = useMemo(() => `${mode}:${routeOpenKeys.join('|')}`, [mode, routeOpenKeys])

  return (
    <ConfigProvider theme={antdTheme}>
      <Menu
        key={menuKey}
        theme={isDark ? 'dark' : 'light'}
        selectedKeys={selectedKeys}
        mode={mode}
        items={items}
        inlineCollapsed={inlineCollapsed}
        defaultOpenKeys={mode === 'inline' && !inlineCollapsed ? routeOpenKeys : undefined}
        onClick={handleMenuClick}
        style={menuStyle}
        className={clsx('guide-menu', className)}
      />
    </ConfigProvider>
  )
}
