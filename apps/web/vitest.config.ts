import { defineConfig } from 'vitest/config'

// Web 目前只测协议层纯函数，不测页面渲染，所以不装 jsdom 和 React 插件。
export default defineConfig({
  resolve: {
    alias: {
      // tsconfig 里 `@web/*` 映射的是包根 `./*`，不是 `src`。
      '@web': import.meta.dirname,
    },
  },
  test: {
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
})
