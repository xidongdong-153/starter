import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@starter/contracts', '@starter/theme'],
}
export default nextConfig
