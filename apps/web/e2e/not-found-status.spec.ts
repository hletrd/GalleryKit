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

    test('year below the MySQL DATETIME domain returns 404', async ({ request }) => {
        const res = await request.get('/en/year/0999');
        expect(res.status()).toBe(404);
    });

    test('maximum MySQL DATETIME year remains a valid empty archive', async ({ request }) => {
        const res = await request.get('/en/year/9999');
        expect(res.status()).toBe(200);
    });

    test('control: the home page still returns 200', async ({ request }) => {
        const res = await request.get('/en');
        expect(res.status()).toBe(200);
    });
});

/**
 * C3-05 (run-10 c3, TRC3-03 + DES3-01) — single, consistent robots signal on
 * 404 pages.
 *
 * The status-bearing 404 fix regressed the head metadata: the locale
 * layout's explicit `robots: { index: true, follow: true }` (elided by Next
 * on valid pages) rendered on 404 pages ALONGSIDE the framework-injected
 * `noindex`, shipping two conflicting robots directives. The explicit
 * default was removed; these assertions pin exactly one robots meta tag
 * (noindex) on 404 responses and none of the conflicting `index, follow`
 * form anywhere.
 */
test.describe('404 pages carry a single noindex robots signal', () => {
    const robotsTags = (html: string) =>
        html.match(/<meta\s+name="robots"[^>]*>/g) ?? [];

    for (const [label, url] of [
        ['nonexistent photo id', '/en/p/99999999'],
        ['nonexistent topic slug', '/en/nonexistent-topic-xyz'],
        ['arbitrary path', '/en/nonexistent-page-xyz-abc'],
        ['nonexistent collection (ko locale)', '/ko/c/nonexistent-collection-xyz'],
    ] as const) {
        test(`${label}: exactly one robots tag, noindex, no index-follow conflict`, async ({ request }) => {
            const res = await request.get(url);
            expect(res.status()).toBe(404);
            const html = await res.text();
            const tags = robotsTags(html);
            expect(tags).toHaveLength(1);
            expect(tags[0]).toContain('noindex');
            expect(html).not.toMatch(/<meta\s+name="robots"\s+content="index, follow"/);
        });
    }

    test('control: valid pages emit no robots meta tag at all (index/follow default is elided)', async ({ request }) => {
        const res = await request.get('/en');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(robotsTags(html)).toHaveLength(0);
    });
});
