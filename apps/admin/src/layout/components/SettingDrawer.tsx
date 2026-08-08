import { ResponsiveTooltip } from '@admin/components/ui'
import { rosePineThemes } from '@admin/config/theme'
import { useSettingStore } from '@admin/stores/modules/setting'
import { Drawer, Space, Typography } from 'antd'
import { Lightbulb, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const { Text, Title } = Typography

interface SettingDrawerProps {
  onClose: () => void
  open: boolean
}

/**
 * 设置抽屉，切换主题模式和配色
 */
export function SettingDrawer({ onClose, open }: SettingDrawerProps) {
  const { t } = useTranslation()
  const adminTheme = useSettingStore((state) => state.adminTheme)
  const setAdminTheme = useSettingStore((state) => state.setAdminTheme)
  const setThemeMode = useSettingStore((state) => state.setThemeMode)
  const themeMode = useSettingStore((state) => state.themeMode)

  const handleThemeModeChange = useCallback((mode: 'light' | 'dark' | 'system') => setThemeMode(mode), [setThemeMode])

  return (
    <Drawer
      title={t('setting.systemSettings')}
      placement="right"
      onClose={onClose}
      open={open}
      size="default"
      classNames={{
        body: 'bg-surface',
        footer: 'bg-surface-muted border-border',
        header: 'bg-surface-muted border-border text-fg',
        wrapper: 'text-fg',
      }}
      styles={{
        body: {
          color: 'var(--color-fg)',
        },
        header: {
          borderBottom: '1px solid var(--color-border)',
          color: 'var(--color-fg)',
        },
        mask: {
          backgroundColor: 'color-mix(in oklab, var(--color-surface-subtle) 52%, transparent)',
        },
      }}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        {/* 主题模式 */}
        <div>
          <Title level={5}>
            <div className="text-fg flex items-center">
              <Lightbulb className="mr-2 size-4" />
              {t('setting.themeMode')}
            </div>
          </Title>
          <Text className="text-fg-muted" type="secondary">
            {t('setting.themeModeDescription')}
          </Text>
          <div style={{ marginTop: 12 }}>
            <Space orientation="horizontal" style={{ width: '100%' }}>
              <ResponsiveTooltip title={t('theme.lightMode')}>
                <button
                  type="button"
                  aria-label={t('theme.lightMode')}
                  onClick={() => handleThemeModeChange('light')}
                  className={`hover:text-primary cursor-pointer text-center text-2xl transition-colors ${
                    themeMode === 'light' ? 'text-primary' : 'text-fg-muted'
                  }`}
                >
                  <Sun />
                </button>
              </ResponsiveTooltip>
              <ResponsiveTooltip title={t('theme.darkMode')}>
                <button
                  type="button"
                  aria-label={t('theme.darkMode')}
                  onClick={() => handleThemeModeChange('dark')}
                  className={`hover:text-primary cursor-pointer text-center text-2xl transition-colors ${
                    themeMode === 'dark' ? 'text-primary' : 'text-fg-muted'
                  }`}
                >
                  <Moon />
                </button>
              </ResponsiveTooltip>
              <ResponsiveTooltip title={t('theme.followSystem')}>
                <button
                  type="button"
                  aria-label={t('theme.followSystem')}
                  onClick={() => handleThemeModeChange('system')}
                  className={`hover:text-primary cursor-pointer text-center text-2xl transition-colors ${
                    themeMode === 'system' ? 'text-primary' : 'text-fg-muted'
                  }`}
                >
                  <Monitor />
                </button>
              </ResponsiveTooltip>
            </Space>
          </div>
        </div>

        {/* 配色 */}
        <div>
          <Title level={5}>
            <div className="text-fg flex items-center">
              <Palette className="mr-2 size-4" />
              {t('setting.adminTheme')}
            </div>
          </Title>
          <Text className="text-fg-muted" type="secondary">
            {t('setting.adminThemeDescription')}
          </Text>
          <div style={{ marginTop: 12 }}>
            <div className="grid grid-cols-2 gap-3">
              {rosePineThemes.map((theme) => {
                const isSelected = adminTheme === theme.id

                return (
                  <button
                    type="button"
                    key={theme.id}
                    onClick={() => setAdminTheme(theme.id)}
                    className={`cursor-pointer rounded-lg border-2 p-3 text-left transition-all duration-200 ${
                      isSelected ? 'border-primary' : 'border-border-subtle hover:border-border'
                    }`}
                  >
                    <div className="text-fg mb-2 text-sm font-medium">{t(`theme.${theme.id}`)}</div>
                    <div className="flex flex-wrap gap-0.5">
                      {theme.colors.map((color) => (
                        <span
                          key={color.name}
                          className="h-4 w-4 rounded-sm shadow-sm"
                          style={{ backgroundColor: color.value }}
                          title={color.name}
                        />
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Space>
    </Drawer>
  )
}
