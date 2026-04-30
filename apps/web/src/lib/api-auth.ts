import { isAdmin } from '@/app/actions/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { hasTrustedSameOrigin } from '@/lib/request-origin';

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
};

/**
 * Wrap an API route handler with mandatory admin authentication and
 * same-origin provenance verification. All /api/admin/* routes MUST
 * use this wrapper or implement their own auth + origin checks.
 *
 * AGG9R-02: origin verification is now enforced centrally here so
 * every admin API route gets automatic CSRF defense matching the
 * `requireSameOriginAdmin()` posture used in server actions. Before
 * this fix, the wrapper only checked `isAdmin()` (cookie presence),
 * requiring each caller to add its own `hasTrustedSameOrigin` check.
 * A future admin API route added with only `withAdminAuth` would
 * have lacked origin verification.
 */
export function withAdminAuth<T extends unknown[]>(
    handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
    return async (...args: T) => {
        // AGG9R-02: verify request origin before checking auth cookie.
        // The first argument is always a NextRequest in API routes.
        const request = args[0] as NextRequest;
        if (request && 'headers' in request && typeof request.headers?.get === 'function') {
            if (!hasTrustedSameOrigin(request.headers)) {
                return NextResponse.json({ error: 'Unauthorized' }, {
                    status: 403,
                    headers: NO_STORE_HEADERS,
                });
            }
        }
        if (!(await isAdmin())) {
            const t = await getTranslations('serverActions');
            return NextResponse.json({ error: t('unauthorized') }, {
                status: 401,
                headers: NO_STORE_HEADERS,
            });
        }
        return handler(...args);
    };
}
