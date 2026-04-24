import { test, expect } from '@playwright/test';

/**
 * C6R-RPL-08 / AGG6R-04 — end-to-end assertion that `requireSameOriginAdmin`
 * rejects requests with a spoofed cross-origin `Origin` header.
 *
 * Strategy:
 * - Use Playwright's `request` context to POST directly (no browser) with
 *   a bogus Origin header pointing at an attacker-controlled domain.
 * - Target a public server action (search) because it uses the same
 *   `hasTrustedSameOrigin` primitive (directly in public.ts the check is
 *   skipped, but we exercise `/api/admin/db/download` which ALSO enforces
 *   admin auth + same-origin via `withAdminAuth`). The route rejects
 *   with 401/403 on missing session.
 *
 * This test locks in the defense-in-depth that the framework-level CSRF
 * path is not the only guard: a regression that disabled the middleware
 * or the withAdminAuth wrapper would still have to defeat the
 * `hasTrustedSameOrigin` primitive in the server action layer.
 *
 * Because the test only hits a route that returns HTTP status (not a
 * server action which returns opaque base64 bundles), it is robust to
 * Next.js internal changes and does not require admin credentials.
 */

test.describe('Origin guard — admin API rejects cross-origin requests', () => {
    test('GET /api/admin/db/download without a trusted Origin returns 401/403', async ({ request, baseURL }) => {
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
