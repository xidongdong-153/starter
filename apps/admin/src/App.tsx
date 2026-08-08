import { queryClient } from '@admin/app/query-client'
import { router } from '@admin/app/router'
import { useSettingStore } from '@admin/stores'
import { getAntdThemeConfig } from '@admin/utils/antd-theme'
import { getPrimaryColorByTheme } from '@admin/utils/theme'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'

import './i18n'

const antdLocaleMap: Record<string, typeof zhCN> = {
  en: enUS,
  zh: zhCN,
}

export function App() {
  const adminTheme = useSettingStore((state) => state.adminTheme)
  const language = useSettingStore((state) => state.language)
  const themeConfig = getAntdThemeConfig(adminTheme)
  const primaryColor = getPrimaryColorByTheme(adminTheme)

  return (
    <ConfigProvider
      locale={antdLocaleMap[language] ?? zhCN}
      theme={{
        ...themeConfig,
        token: {
          ...themeConfig.token,
          colorPrimary: primaryColor,
        },
      }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
