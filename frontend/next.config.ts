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
};

export default nextConfig;
