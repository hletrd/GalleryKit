import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function routeSource(route: 's' | 'g') {
    return readFileSync(resolve(__dirname, '..', 'app', '[locale]', '(public)', route, '[key]', 'page.tsx'), 'utf8');
}

describe('public share route lookup throttling', () => {
    it('rate-limits single-photo share page body before DB lookup', () => {
        const source = routeSource('s');
        const pageBody = source.slice(source.indexOf('export default async function'));

        // C4-AGG-01: rate limit is enforced once in the page body only, NOT in
        // generateMetadata. Both run in separate React render contexts, so
        // calling preIncrementShareAttempt in both would double-increment.
        expect(pageBody.indexOf('await isShareLookupRateLimited()')).toBeGreaterThan(-1);
        expect(pageBody.indexOf('await isShareLookupRateLimited()')).toBeLessThan(pageBody.indexOf('getImageByShareKeyCached(key)'));
    });

    it('rate-limits group share page body before DB lookup', () => {
        const source = routeSource('g');
        const pageBody = source.slice(source.indexOf('export default async function'));

        // C4-AGG-01: rate limit is enforced once in the page body only, NOT in
        // generateMetadata. Both run in separate React render contexts, so
        // calling preIncrementShareAttempt in both would double-increment.
        expect(pageBody.indexOf('await isShareLookupRateLimited()')).toBeGreaterThan(-1);
        expect(pageBody.indexOf('await isShareLookupRateLimited()')).toBeLessThan(pageBody.indexOf('getSharedGroupCached(key'));
    });

    it('does NOT rate-limit in generateMetadata for single-photo share (C4-AGG-01)', () => {
        const source = routeSource('s');
        const metadata = source.slice(source.indexOf('export async function generateMetadata'), source.indexOf('export default async function'));

        // C4-AGG-01: generateMetadata must NOT call isShareLookupRateLimited.
        // This prevents double-increment — the page body is the single
        // enforcement point.
        expect(metadata.indexOf('await isShareLookupRateLimited()')).toBe(-1);
    });

    it('does NOT rate-limit in generateMetadata for group share (C4-AGG-01)', () => {
        const source = routeSource('g');
        const metadata = source.slice(source.indexOf('export async function generateMetadata'), source.indexOf('export default async function'));

        // C4-AGG-01: generateMetadata must NOT call isShareLookupRateLimited.
        // This prevents double-increment — the page body is the single
        // enforcement point.
        expect(metadata.indexOf('await isShareLookupRateLimited()')).toBe(-1);
    });
});
