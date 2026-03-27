import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

const intlMiddleware = createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'ko'],

  // Used when no locale matches
  defaultLocale: 'en',

  // Don't prefix the default locale
  localePrefix: 'as-needed'
});

// Locales supported (must match above)
const LOCALES = ['en', 'ko'];

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
      if (localeMatch && LOCALES.includes(localeMatch[1])) {
        loginUrl = `/${localeMatch[1]}/admin`;
      } else {
        loginUrl = '/admin';
      }
      const url = request.nextUrl.clone();
      url.pathname = loginUrl;
      return NextResponse.redirect(url);
    }
  }

  return intlMiddleware(request);
}

export const config = {
  // Match only internationalized pathnames
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
