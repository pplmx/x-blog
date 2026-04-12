import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const isRemote = apiUrl && !apiUrl.includes('localhost') && !apiUrl.includes('127.0.0.1');

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: apiUrl || 'http://localhost:8000',
  },
  // 自动允许本地开发 origins，如果配置了远程则忽略
  ...(process.env.NODE_ENV === 'development' && !isRemote
    ? {
        allowedDevOrigins: [
          'localhost',
          'localhost:3000',
          '127.0.0.1',
          '127.0.0.1:3000',
        ],
      }
    : {}),
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
    // 如果配置了远程后端，不使用 rewrites
    // 本地开发默认使用 localhost:8000
    if (!isRemote) {
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