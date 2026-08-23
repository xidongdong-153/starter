import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@starter/contracts', '@starter/theme'],
  turbopack: {
    // 两个共享包的 package.json 里 `development` 条件指向 `src/index.ts`，源码内部按 NodeNext
    // 写成 `export * from './ai.js'`。Turbopack 不把 `.js` 映射到同名 `.ts`（Next 16.2.4 还没有
    // webpack 的 resolve.extensionAlias），解析会得到一个没有任何导出的模块，页面报 Build Error。
    // 这里让 web 直接读构建产物；改完共享包要跑 `pnpm --filter @starter/contracts build`。
    resolveAlias: {
      '@starter/contracts': './node_modules/@starter/contracts/dist/index.js',
      '@starter/theme': './node_modules/@starter/theme/dist/index.js',
    },
  },
}
export default nextConfig
