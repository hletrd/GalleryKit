import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['drizzle-orm', 'better-sqlite3', 'sharp'],
  experimental: {
    serverActions: {
      // Keep this close to the app-level MAX_FILE_SIZE to reduce DoS blast radius.
      bodySizeLimit: '250mb',
    },
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
