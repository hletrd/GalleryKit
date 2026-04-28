import { test, expect } from '@playwright/test';

import { adminE2EEnabled, createAdminSessionCookie } from './helpers';

/**
 * C6R-RPL-08 / AGG6R-04 — end-to-end assertion that `requireSameOriginAdmin`
 * rejects requests with a spoofed cross-origin `Origin` header.
 *
 * Strategy:
 * - Use Playwright's `request` context to call a concrete admin API route with
 *   a bogus Origin header pointing at an attacker-controlled domain.
 * - The unauthenticated case must reject with 401/403 instead of passing due
 *   to a missing route. When admin E2E credentials are configured, a second
 *   authenticated request locks the same-origin guard to a definite 403.
 *
 * This test locks in the defense-in-depth that the framework-level CSRF
 * path is not the only guard: a regression that disabled the middleware
 * or the withAdminAuth wrapper would still have to defeat the
 * `hasTrustedSameOrigin` primitive in the server action layer.
 *
 * Because the test only hits a route that returns HTTP status (not a
 * server action which returns opaque base64 bundles), it is robust to
 * Next.js internal changes; the authenticated branch creates a short-lived
 * local E2E session instead of depending on browser Secure-cookie behavior.
 */

test.describe('Origin guard — admin API rejects cross-origin requests', () => {
    test('authenticated origin-guard coverage is configured in CI', () => {
        test.skip(process.env.CI !== 'true', 'Local runs may omit admin E2E credentials.');
        expect(adminE2EEnabled).toBe(true);
    });

    test('unauthenticated cross-origin API smoke returns 401/403 without proving the origin branch', async ({ request, baseURL }) => {
        if (!baseURL) {
            test.skip(true, 'baseURL not configured for this runner');
            return;
        }

        const response = await request.get(`${baseURL}/api/admin/db/download?file=nothing.sql`, {
            headers: {
                // Spoofed cross-origin request — no admin session cookie
                // and a bogus Origin. Even if some future refactor removed
                // the cookie check, the origin check must still reject.
                'Origin': 'https://attacker.example.com',
                'Referer': 'https://attacker.example.com/',
            },
        });

        // withAdminAuth returns 401 when no valid session cookie is present;
        // the same-origin guard may return 403. A 404 would mean the test is
        // passing because the route disappeared, not because the guard works.
        expect([401, 403]).toContain(response.status());
    });

    test('authenticated admin request with a spoofed cross-origin header returns 403', async ({ request, baseURL }) => {
        test.skip(!adminE2EEnabled, 'admin credentials are not configured for authenticated origin-guard E2E');
        if (!baseURL) {
            test.skip(true, 'baseURL not configured for this runner');
            return;
        }

        const cookieHeader = await createAdminSessionCookie();

        const response = await request.get(`${baseURL}/api/admin/db/download?file=nothing.sql`, {
            headers: {
                'Cookie': cookieHeader,
                'Origin': 'https://attacker.example.com',
                'Referer': 'https://attacker.example.com/',
            },
        });

        expect(response.status()).toBe(403);
    });

    test('HEAD / returns 200 from the real origin (sanity check)', async ({ request, baseURL }) => {
        if (!baseURL) {
            test.skip(true, 'baseURL not configured for this runner');
            return;
        }

        // Basic smoke: the server is reachable and the public homepage
        // responds. If this fails, the cross-origin test above is
        // meaningless (it might return 404 just because the server is
        // unreachable).
        const response = await request.head(`${baseURL}/`);
        expect([200, 301, 302, 307, 308]).toContain(response.status());
    });
});
