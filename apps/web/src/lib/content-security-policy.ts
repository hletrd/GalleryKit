export function parseCspImageBaseUrl(rawValue: string | undefined, environment: string = process.env.NODE_ENV || 'development'): URL | null {
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

  if (environment === 'production' && parsed.protocol !== 'https:') {
    throw new Error('IMAGE_BASE_URL must use https in production');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('IMAGE_BASE_URL must not include credentials, query strings, or hashes');
  }

  return parsed;
}

export function getCspImageSources(imageBaseUrl: URL | null): string[] {
  const sources = ["'self'", 'data:', 'blob:'];
  if (imageBaseUrl) {
    sources.push(imageBaseUrl.origin);
  }
  return sources;
}

export function buildContentSecurityPolicy({
  nonce,
  isDev = process.env.NODE_ENV === 'development',
  imageBaseUrl = parseCspImageBaseUrl(process.env.IMAGE_BASE_URL?.trim()),
}: {
  nonce?: string;
  isDev?: boolean;
  imageBaseUrl?: URL | null;
} = {}) {
  const imgSrc = getCspImageSources(imageBaseUrl).join(' ');

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

  const scriptSources = ["'self'", 'https://www.googletagmanager.com'];
  if (nonce) {
    scriptSources.unshift(`'nonce-${nonce}'`);
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    "connect-src 'self' https://www.google-analytics.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join('; ');
}
