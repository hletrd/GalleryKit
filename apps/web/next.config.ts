import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { NEXT_SERVER_ACTION_BODY_SIZE_LIMIT } from './src/lib/upload-limits';
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
const localImagePatterns: NonNullable<NonNullable<NextConfig['images']>['localPatterns']> = [
  { pathname: '/uploads/**' },
  { pathname: '/uploads/**', search: '?**' },
  { pathname: '/resources/**' },
  { pathname: '/resources/**', search: '?**' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    // The public `npm run build` wrapper sets this marker only after the
    // explicit typecheck gate passes. Direct `next build` keeps Next's native
    // TypeScript validation enabled so contributors cannot bypass type safety.
    ignoreBuildErrors: process.env.GALLERYKIT_TYPECHECKED === '1',
  },
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
          // AGG8F-05 / plan-235: append modern privacy directives. A photo
          // gallery has clear opt-out intent for Topics API, Attribution
          // Reporting, Private State Tokens, and Idle Detection. Browsers
          // treat unknown directives as no-ops, so this is purely additive
          // hardening. Keep this list aligned with apps/web/nginx/default.conf.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=(), attribution-reporting=(), private-state-token-redemption=(), private-state-token-issuance=(), idle-detection=()' },
          ...(!isDev ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }] : []),
          ...(isDev ? [{ key: 'Content-Security-Policy', value: devCspValue }] : []),
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Keep the framework parser aligned with the largest Server Action body
      // surface (currently DB restore at 250 MiB plus multipart overhead), not
      // the 2 GiB rolling upload batch budget. App-level checks still enforce
      // the smaller per-file upload cap and restore cap after auth/origin.
      bodySizeLimit: NEXT_SERVER_ACTION_BODY_SIZE_LIMIT,
    },
    proxyClientMaxBodySize: NEXT_SERVER_ACTION_BODY_SIZE_LIMIT,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    localPatterns: localImagePatterns,
    remotePatterns: buildRemotePattern(imageBaseUrl),
  },
};

export default withNextIntl(nextConfig);
