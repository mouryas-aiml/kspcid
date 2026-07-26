import type { NextConfig } from 'next'

const basePath = process.env.CATALYST_CLIENT_HOSTING === '1' ? '/app' : ''

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
}

export default nextConfig
