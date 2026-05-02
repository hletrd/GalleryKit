import { isAdmin } from '@/app/actions/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { hasTrustedSameOrigin } from '@/lib/request-origin';
import { verifyToken, tokenHasScope, type AdminTokenScope, type VerifiedToken } from '@/lib/admin-tokens';

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    // C16-LOW-08: prevent MIME-type sniffing on API route responses
    'X-Content-Type-Options': 'nosniff',
};

const TOKEN_HEADER = 'x-gallerykit-token';

export interface WithAdminAuthOptions {
    /**
     * If set, the wrapper additionally accepts a valid `X-GalleryKit-Token`
     * header carrying this scope as an alternative to the cookie session.
     * Token-authenticated requests bypass the same-origin check (CORS-style
     * integration is the point of PATs) but MUST present a valid token whose
     * stored scope set includes `allowTokenScope`. The verified token info is
     * passed as the LAST argument to the handler.
     *
     * The wrapper still satisfies the `lint:api-auth` gate because the
     * exported call site is literally `withAdminAuth(...)`.
     */
    allowTokenScope?: AdminTokenScope;
}

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
 *
 * US-P53: when the optional `allowTokenScope` is supplied via the second
 * positional argument, requests carrying a valid `X-GalleryKit-Token`
 * header may authenticate without a cookie or same-origin context. This
 * is required for non-browser integrations (e.g. the Lightroom plugin).
 */
export function withAdminAuth<T extends unknown[]>(
    handler: (...args: T) => Promise<Response>,
    options?: WithAdminAuthOptions,
): (...args: T) => Promise<Response> {
    return async (...args: T) => {
        const request = args[0] as NextRequest;
        const headers = (request && 'headers' in request && typeof request.headers?.get === 'function')
            ? request.headers
            : null;

        // US-P53: token path runs first so token-bearing requests bypass the
        // same-origin check (cross-origin clients like Lightroom Classic
        // cannot satisfy same-origin). The token's `scopes` set is the
        // authorization gate.
        if (options?.allowTokenScope && headers) {
            const presented = headers.get(TOKEN_HEADER);
            if (presented) {
                const verified = await verifyToken(presented);
                if (verified && tokenHasScope(verified.scopes, options.allowTokenScope)) {
                    const augmentedArgs = [...args, { token: verified }] as unknown as T;
                    const response = await handler(...augmentedArgs);
                    if (!response.headers.has('X-Content-Type-Options')) {
                        response.headers.set('X-Content-Type-Options', 'nosniff');
                    }
                    return response;
                }
                return NextResponse.json({ error: 'Unauthorized' }, {
                    status: 401,
                    headers: NO_STORE_HEADERS,
                });
            }
        }

        // AGG9R-02: verify request origin before checking auth cookie.
        if (headers) {
            if (!hasTrustedSameOrigin(headers)) {
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
        // C17-LOW-04: add nosniff to successful handler responses if not
        // already present. Error paths already set it via NO_STORE_HEADERS.
        const response = await handler(...args);
        if (!response.headers.has('X-Content-Type-Options')) {
            response.headers.set('X-Content-Type-Options', 'nosniff');
        }
        return response;
    };
}

export type { VerifiedToken };
