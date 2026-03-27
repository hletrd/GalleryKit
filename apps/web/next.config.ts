import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['drizzle-orm', 'sharp'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self';" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Keep this close to the app-level MAX_FILE_SIZE to reduce DoS blast radius.
      bodySizeLimit: '250mb',
    },
    // Allow large requests to pass through middleware
    proxyClientMaxBodySize: '250mb',
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    localPatterns: [
      {
        pathname: '/**',
      },
      {
        pathname: '/**',
        search: '?**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
