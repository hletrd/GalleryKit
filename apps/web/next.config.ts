import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { NEXT_UPLOAD_BODY_SIZE_LIMIT } from './src/lib/upload-limits';
import { buildContentSecurityPolicy, parseCspImageBaseUrl } from './src/lib/content-security-policy';

const withNextIntl = createNextIntlPlugin();

export function parseImageBaseUrl(rawValue: string | undefined, environment: string = process.env.NODE_ENV || 'development'): URL | null {
  return parseCspImageBaseUrl(rawValue, environment);
}

function buildRemotePattern(
  imageBaseUrl: URL | null
): NonNullable<NonNullable<NextConfig['images']>['remotePatterns']> {
  if (!imageBaseUrl) {
    return [];
  }

  const basePath = imageBaseUrl.pathname.replace(/\/+$/, '');
  return [{
    protocol: imageBaseUrl.protocol.slice(0, -1) as 'http' | 'https',
    hostname: imageBaseUrl.hostname,
    port: imageBaseUrl.port || '',
    pathname: `${basePath || ''}/**`,
  }];
}

const imageBaseUrl = parseImageBaseUrl(process.env.IMAGE_BASE_URL?.trim());

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['drizzle-orm', 'sharp'],
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';
    const devCspValue = buildContentSecurityPolicy({ isDev: true, imageBaseUrl });

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(!isDev ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }] : []),
          ...(isDev ? [{ key: 'Content-Security-Policy', value: devCspValue }] : []),
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Keep framework-level request parsing aligned with the app-level total batch cap.
      bodySizeLimit: NEXT_UPLOAD_BODY_SIZE_LIMIT,
    },
    proxyClientMaxBodySize: NEXT_UPLOAD_BODY_SIZE_LIMIT,
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
    remotePatterns: buildRemotePattern(imageBaseUrl),
  },
};

export default withNextIntl(nextConfig);
