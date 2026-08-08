import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { DEFAULT_THEME_SETTING, FALLBACK_DARK, FALLBACK_LIGHT, THEME_STORAGE_KEY } from '@web/lib/theme'
import './globals.css'

const mapleMono = localFont({
  variable: '--font-maple-mono',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'monospace'],
  src: [
    { path: './fonts/MapleMonoNormalNL-Regular.ttf.woff2', weight: '400', style: 'normal' },
    { path: './fonts/MapleMonoNormalNL-Italic.ttf.woff2', weight: '400', style: 'italic' },
    { path: './fonts/MapleMonoNormalNL-Medium.ttf.woff2', weight: '500', style: 'normal' },
    { path: './fonts/MapleMonoNormalNL-MediumItalic.ttf.woff2', weight: '500', style: 'italic' },
    { path: './fonts/MapleMonoNormalNL-SemiBold.ttf.woff2', weight: '600', style: 'normal' },
    { path: './fonts/MapleMonoNormalNL-SemiBoldItalic.ttf.woff2', weight: '600', style: 'italic' },
    { path: './fonts/MapleMonoNormalNL-Bold.ttf.woff2', weight: '700', style: 'normal' },
    { path: './fonts/MapleMonoNormalNL-BoldItalic.ttf.woff2', weight: '700', style: 'italic' },
  ],
})

export const metadata: Metadata = {
  title: {
    default: 'Starter',
    template: '%s | Starter',
  },
  description: '个人资料、文件与公开页面的 TypeScript 全栈脚手架。',
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf4ed' },
    { media: '(prefers-color-scheme: dark)', color: '#232136' },
  ],
}

const themeInitScript = `
(() => {
  const storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
  const supported = new Set(['dawn', 'moon', 'system']);
  const stored = window.localStorage.getItem(storageKey);
  const setting = supported.has(stored) ? stored : ${JSON.stringify(DEFAULT_THEME_SETTING)};
  const activeTheme = setting === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches
        ? ${JSON.stringify(FALLBACK_DARK)}
        : ${JSON.stringify(FALLBACK_LIGHT)})
    : setting;

  document.documentElement.dataset.theme = activeTheme;
  document.documentElement.dataset.themeSetting = setting;
})();
`

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      className={`${mapleMono.variable} min-h-full antialiased`}
      data-scroll-behavior="smooth"
      data-theme={FALLBACK_LIGHT}
      data-theme-setting={DEFAULT_THEME_SETTING}
      lang="zh-CN"
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  )
}
