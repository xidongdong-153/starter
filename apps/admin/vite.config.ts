import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { parseAdminEnv } from './src/env.schema.ts'

/**
 * 从 node_modules 路径里取出包名，用于代码分割
 */
function getPackageName(id: string): string | null {
  const normalizedId = id.replace(/\\/g, '/')
  const nodeModulesMarker = '/node_modules/'
  const nodeModulesIndex = normalizedId.lastIndexOf(nodeModulesMarker)

  if (nodeModulesIndex === -1) return null

  const packagePath = normalizedId.slice(nodeModulesIndex + nodeModulesMarker.length)
  const [scopeOrName, maybeName] = packagePath.split('/')

  if (!scopeOrName) return null

  if (scopeOrName.startsWith('@') && maybeName) {
    return `${scopeOrName}/${maybeName}`
  }

  return scopeOrName
}

export default defineConfig(({ mode }) => {
  const viteEnv = {
    ...loadEnv(mode, import.meta.dirname, 'VITE_'),
    ...process.env,
  }

  const adminEnv = parseAdminEnv(viteEnv)

  return {
    build: {
      assetsDir: 'assets',
      chunkSizeWarningLimit: 1500,
      cssCodeSplit: true,
      emptyOutDir: true,
      minify: 'esbuild',
      outDir: 'dist',
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name || ''
            const ext = path.extname(info).slice(1)

            if (ext === 'css') {
              return 'css/[name]-[hash][extname]'
            }
            if (/^(?:png|jpe?g|svg|gif|webp|avif|ico)$/.test(ext)) {
              return 'images/[name]-[hash][extname]'
            }
            if (/^(?:woff2?|eot|ttf|otf)$/.test(ext)) {
              return 'fonts/[name]-[hash][extname]'
            }
            return 'assets/[name]-[hash][extname]'
          },
          chunkFileNames: 'js/[name]-[hash].js',
          entryFileNames: 'js/[name]-[hash].js',
          manualChunks: (id) => {
            const packageName = getPackageName(id)

            if (!packageName) return

            // React 运行时相关包放在一起，避免跨 chunk 循环依赖
            if (['react', 'react-dom', 'scheduler', 'react-is'].includes(packageName)) {
              return 'vendor-react'
            }
            // Ant Design 生态
            if (
              packageName === 'antd' ||
              packageName.startsWith('@ant-design/') ||
              packageName.startsWith('@rc-component/') ||
              packageName.startsWith('rc-')
            ) {
              return 'vendor-antd'
            }
            if (packageName === 'i18next' || packageName === 'react-i18next') {
              return 'vendor-i18n'
            }
            if (packageName === 'zustand') {
              return 'vendor-zustand'
            }
            if (packageName.startsWith('@tanstack/')) {
              return 'vendor-tanstack'
            }
          },
        },
      },
      sourcemap: mode === 'development',
      target: 'es2020',
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@admin': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: true,
      port: 2333,
      strictPort: true,
      proxy: {
        '/api': {
          changeOrigin: true,
          target: adminEnv.VITE_API_URL,
        },
        '/health': {
          changeOrigin: true,
          target: adminEnv.VITE_API_URL,
        },
      },
    },
  }
})
