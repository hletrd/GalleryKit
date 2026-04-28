import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { LOCALES, DEFAULT_LOCALE } from '@/lib/constants';
import { buildContentSecurityPolicy } from '@/lib/content-security-policy';
import siteConfig from '@/site-config.json';

const intlMiddleware = createMiddleware({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: false
});

function getRequestWithHeaders(request: NextRequest, headers: Headers) {
  return new NextRequest(request.url, {
    headers,
    method: request.method,
  });
}

function applyProductionCsp(request: NextRequest, response: NextResponse): NextResponse {
  if (process.env.NODE_ENV === 'development') {
    return response;
  }

  const cspHeader = request.headers.get('Content-Security-Policy');
  const nonce = request.headers.get('x-nonce');
  if (!cspHeader || !nonce) {
    return response;
  }

  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('x-nonce', nonce);
  return response;
}

function withProductionCspRequest(request: NextRequest): NextRequest {
  if (process.env.NODE_ENV === 'development') {
    return request;
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', buildContentSecurityPolicy({
    nonce,
    isDev: false,
    googleAnalyticsId: siteConfig.google_analytics_id,
  }));
  return getRequestWithHeaders(request, requestHeaders);
}

// Matches /admin/... subpaths but NOT the login page itself (/admin exactly, or /admin with no trailing slash)
// Protected: /[locale]/admin/anything or /admin/anything (default locale, no prefix)
function isProtectedAdminRoute(pathname: string): boolean {
  for (const locale of LOCALES) {
    // e.g. /en/admin/dashboard or /en/admin/
    if (pathname.startsWith(`/${locale}/admin/`) || pathname === `/${locale}/admin`) {
      // The login page is exactly /[locale]/admin (no trailing slash, no subpath)
      // We protect everything under /[locale]/admin/ (with slash) but NOT /[locale]/admin itself
      if (pathname.startsWith(`/${locale}/admin/`)) {
        return true;
      }
    }
  }
  // Default locale (no prefix): /admin/...
  if (pathname.startsWith('/admin/')) {
    return true;
  }
  return false;
}

export default function middleware(request: NextRequest) {
  const cspRequest = withProductionCspRequest(request);
  const { pathname } = request.nextUrl;

  // Guard: if this is a protected admin sub-route and there's no session cookie, redirect to login
  if (isProtectedAdminRoute(pathname)) {
    const sessionCookie = request.cookies.get('admin_session');
    // Validate cookie presence and basic token format (timestamp:random:signature).
    // Full cryptographic validation happens in verifySessionToken() within server actions.
    const token = sessionCookie?.value;
    if (!token || token.split(':').length !== 3) {
      // Determine login page URL based on locale prefix in path
      let loginUrl: string;
      const localeMatch = pathname.match(/^\/([a-z]{2})\//);
      if (localeMatch && (LOCALES as readonly string[]).includes(localeMatch[1])) {
        loginUrl = `/${localeMatch[1]}/admin`;
      } else {
        loginUrl = '/admin';
      }
      const url = request.nextUrl.clone();
      url.pathname = loginUrl;
      return applyProductionCsp(cspRequest, NextResponse.redirect(url));
    }
  }

  return applyProductionCsp(cspRequest, intlMiddleware(cspRequest));
}

export const config = {
  // Match only internationalized pathnames.
  // NOTE: API routes (/api/*) are EXCLUDED from this middleware matcher.
  // Any new /api/admin/* route MUST implement its own auth check (e.g., isAdmin()).
  // The middleware cookie format check does NOT run for API routes.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
