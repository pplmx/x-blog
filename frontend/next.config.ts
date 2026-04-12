import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
  },
  allowedDevOrigins: ['local-origin.dev', 'local.x-blog.dev', '172.17.0.2', 'localhost'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24, // 1 day
  },
  async rewrites() {
    // 开发环境：反向代理到本地后端
    // 生产环境：通过 NEXT_PUBLIC_API_URL 配置
    if (apiUrl === 'http://localhost:8000') {
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:8000/api/:path*',
        },
      ];
    }
    return [];
  },
};

export default nextConfig;