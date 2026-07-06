import { test, expect } from '@playwright/test';

/**
 * C2-04 (UX-03, run-10 c2) — real HTTP 404s on public not-found routes.
 *
 * The production instance served HTTP 200 for every not-found URL class
 * (soft 404): the page bodies threw notFound() inside the
 * [locale]/loading.tsx implicit Suspense boundary, AFTER the 200 shell had
 * already flushed. The status-bearing fix throws notFound() from
 * generateMetadata (resolved before streaming starts). These assertions pin
 * the status codes so a future loading-boundary or metadata refactor cannot
 * silently regress the contract search engines and monitoring rely on.
 */
test.describe('not-found routes return HTTP 404', () => {
    test('nonexistent photo id returns 404', async ({ request }) => {
        const res = await request.get('/en/p/99999999');
        expect(res.status()).toBe(404);
    });

    test('malformed photo id returns 404', async ({ request }) => {
        const res = await request.get('/en/p/not-a-number');
        expect(res.status()).toBe(404);
    });

    test('nonexistent topic slug returns 404', async ({ request }) => {
        const res = await request.get('/en/nonexistent-topic-xyz');
        expect(res.status()).toBe(404);
    });

    test('arbitrary nonexistent single-segment path returns 404', async ({ request }) => {
        const res = await request.get('/en/nonexistent-page-xyz-abc');
        expect(res.status()).toBe(404);
    });

    test('nonexistent smart-collection slug returns 404', async ({ request }) => {
        const res = await request.get('/en/c/nonexistent-collection-xyz');
        expect(res.status()).toBe(404);
    });

    test('invalid year returns 404', async ({ request }) => {
        const res = await request.get('/en/year/not-a-year');
        expect(res.status()).toBe(404);
    });

    test('control: the home page still returns 200', async ({ request }) => {
        const res = await request.get('/en');
        expect(res.status()).toBe(200);
    });
});
