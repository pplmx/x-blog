import type { NextConfig } from 'next';
import { networkInterfaces } from 'os';

function getLocalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const envOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS;

const nextConfig: NextConfig = {
  allowedDevOrigins: envOrigins ? envOrigins.split(',').map((s) => s.trim()) : [getLocalIP()],

  // Performance optimizations
  reactStrictMode: true,

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24, // 1 day
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
};

export default nextConfig;
