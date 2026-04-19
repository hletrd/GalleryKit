import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { NEXT_UPLOAD_BODY_SIZE_LIMIT } from './src/lib/upload-limits';

const withNextIntl = createNextIntlPlugin();

function parseImageBaseUrl(rawValue: string | undefined): URL | null {
  if (!rawValue) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error('IMAGE_BASE_URL must be an absolute http(s) URL, for example https://cdn.example.com');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('IMAGE_BASE_URL must use http or https');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('IMAGE_BASE_URL must not include credentials, query strings, or hashes');
  }

  return parsed;
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
const cspImgSrc = ["'self'", 'data:', 'blob:'];
if (imageBaseUrl) {
  cspImgSrc.push(imageBaseUrl.origin);
}

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['drizzle-orm', 'sharp'],
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    const cspValue = isDev
      ? [
          "default-src 'self'",
          "script-src 'unsafe-inline' 'unsafe-eval' 'self'",
          "style-src 'unsafe-inline' 'self'",
          `img-src ${cspImgSrc.join(' ')}`,
          "font-src 'self' data:",
          "connect-src 'self' ws: wss:",
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
          "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
          `img-src ${cspImgSrc.join(' ')}`,
          "font-src 'self' data:",
          "connect-src 'self' https://www.google-analytics.com",
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          "manifest-src 'self'",
        ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(!isDev ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }] : []),
          { key: 'Content-Security-Policy', value: cspValue },
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
