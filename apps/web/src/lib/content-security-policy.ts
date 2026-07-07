const ALLOWED_IMAGE_BASE_PROTOCOLS = new Set(['http:', 'https:']);

export function parseCspImageBaseUrl(rawValue: string | undefined, environment: string = process.env.NODE_ENV || 'development'): URL | null {
  const value = rawValue?.trim();
  if (!value) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('IMAGE_BASE_URL must be an absolute http(s) URL, for example https://cdn.example.com');
  }

  if (!ALLOWED_IMAGE_BASE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('IMAGE_BASE_URL must use http or https');
  }

  if (environment === 'production' && parsed.protocol !== 'https:') {
    throw new Error('IMAGE_BASE_URL must use https in production');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('IMAGE_BASE_URL must not include credentials, query strings, or hashes');
  }

  return parsed;
}

export function sanitizeImageBaseUrl(rawValue: string | undefined, environment?: string): string {
  const parsed = parseCspImageBaseUrl(rawValue, environment);
  if (!parsed) {
    return '';
  }
  const pathPrefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathPrefix}`;
}

export function sanitizeImageBaseUrlSafely(rawValue: string | undefined, environment?: string): string {
  try {
    return sanitizeImageBaseUrl(rawValue, environment);
  } catch {
    return '';
  }
}

let hasLoggedCspBuildFailure = false;

/**
 * C2-37 (run-10 c2): buildContentSecurityPolicy's `imageBaseUrl` default
 * parameter parses IMAGE_BASE_URL synchronously via parseCspImageBaseUrl,
 * which throws on a malformed or credential-bearing value. proxy.ts calls
 * buildContentSecurityPolicy on every request, so an unvalidated runtime
 * env var can 500 the entire site. This wrapper degrades instead: on
 * failure it logs once per process and rebuilds the CSP without the image
 * base URL (images may 404 from the CDN — the site keeps serving).
 */
export function buildCspSafely(args: {
  nonce?: string;
  isDev?: boolean;
  googleAnalyticsId?: string | null;
} = {}): string {
  try {
    return buildContentSecurityPolicy(args);
  } catch (error) {
    if (!hasLoggedCspBuildFailure) {
      hasLoggedCspBuildFailure = true;
      console.error('[content-security-policy] failed to build CSP (likely a malformed IMAGE_BASE_URL); falling back without the image base URL:', error);
    }
    return buildContentSecurityPolicy({ ...args, imageBaseUrl: null });
  }
}

export function getCspImageSources(imageBaseUrl: URL | null): string[] {
  const sources = ["'self'", 'data:', 'blob:'];
  if (imageBaseUrl) {
    sources.push(imageBaseUrl.origin);
  }
  return sources;
}

function hasGoogleAnalyticsId(value: string | undefined | null): boolean {
  return /^(G-[A-Z0-9]+|UA-\d+-\d+)$/.test(value?.trim() ?? '');
}

/**
 * COR-R4C16-02: GA4 (gtag.js) source allowlist per Google's documented
 * CSP contract (developers.google.com/tag-platform/security/guides/csp,
 * verified 2026-06-11 — analytics tier only, NO advertising hosts).
 * GA4 routes `/g/collect` beacons through REGIONAL endpoints
 * (`region1.google-analytics.com` for EU data residency) and falls
 * back to image beacons when fetch/sendBeacon is blocked; the previous
 * literal `www.google-analytics.com` connect-src silently dropped all
 * EU visitors' beacons (CSP-blocked → analytics undercount with no
 * server-side signal). Wildcards on the LEFT of the hostname are valid
 * CSP syntax.
 */
const GA_SCRIPT_SOURCES = ['https://*.googletagmanager.com'] as const;
const GA_CONNECT_SOURCES = [
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
  'https://www.google.com',
] as const;
const GA_IMG_SOURCES = [
  'https://*.google-analytics.com',
  'https://*.googletagmanager.com',
] as const;
const OSM_TILE_IMG_SOURCES = [
  'https://a.tile.openstreetmap.org',
  'https://b.tile.openstreetmap.org',
  'https://c.tile.openstreetmap.org',
] as const;

export function buildContentSecurityPolicy({
  nonce,
  isDev = process.env.NODE_ENV === 'development',
  imageBaseUrl = parseCspImageBaseUrl(process.env.IMAGE_BASE_URL?.trim()),
  googleAnalyticsId = process.env.NEXT_PUBLIC_GA_ID,
}: {
  nonce?: string;
  isDev?: boolean;
  imageBaseUrl?: URL | null;
  googleAnalyticsId?: string | null;
} = {}) {
  const includeGoogleAnalytics = hasGoogleAnalyticsId(googleAnalyticsId);
  const imgSources = getCspImageSources(imageBaseUrl);
  imgSources.push(...OSM_TILE_IMG_SOURCES);
  if (includeGoogleAnalytics) {
    imgSources.push(...GA_IMG_SOURCES);
  }
  const imgSrc = imgSources.join(' ');

  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'unsafe-inline' 'unsafe-eval' 'self'",
      "style-src 'unsafe-inline' 'self'",
      `img-src ${imgSrc}`,
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
    ].join('; ');
  }

  const scriptSources = ["'self'"];
  if (includeGoogleAnalytics) {
    scriptSources.push(...GA_SCRIPT_SOURCES);
  }
  if (nonce) {
    scriptSources.unshift(`'nonce-${nonce}'`);
  }

  const connectSources = ["'self'"];
  if (includeGoogleAnalytics) {
    connectSources.push(...GA_CONNECT_SOURCES);
  }

  // Production still allows inline styles because Next/font, Tailwind runtime
  // style attributes, and Radix-style component sizing do not share the script
  // nonce path. Scripts remain nonce-only in production; this style allowance
  // should be revisited only with browser coverage that proves no hydration or
  // component styles regress.
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(' ')}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join('; ');
}
