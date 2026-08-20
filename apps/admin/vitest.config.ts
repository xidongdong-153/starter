import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@admin': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    restoreMocks: true,
    setupFiles: ['./src/test/setup.ts'],
    // jsdom 下渲染 Antd 表单页面本身要 1 到 2 秒，`pnpm test` 与 api 测试并行时会被拖到
    // 默认的 5 秒上限之外。这里放宽到 15 秒，只影响超时判定，不影响断言。
    testTimeout: 15_000,
  },
})
